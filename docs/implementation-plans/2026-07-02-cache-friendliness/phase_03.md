# Cache-Friendliness Phase 3: Route Working Memory Through the Snapshot Pipeline

**Goal:** Remove the working-memory prepend from `buildMessages` so the conversation message list derives solely from history; deliver working-memory blocks via the snapshot pipeline instead.

**Architecture:** `buildMessages` (src/agent/context.ts:38-46) currently prepends working-memory blocks as a user message at index 0 — every working-memory write rewrites `messages[0]` and invalidates the whole conversation prefix. This phase removes the prepend and adds a `WorkingMemoryContextState` holder + `dynamic` provider (same pattern as recall and Phase 2's skills). Because `ContextProvider` is synchronous and `getWorkingBlocks()` is async, the agent loop refreshes the holder each round before snapshot composition.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `bun:test`.

**Scope:** Phase 3 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`. Depends on Phase 2's provider-wiring pattern but does not require Phase 2's code.

**Codebase verified:** 2026-07-02 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC3: Working memory out of the message prefix
- **cache-friendliness.AC3.1 Success:** `buildMessages` output contains no working-memory message; its content derives solely from conversation history.
- **cache-friendliness.AC3.2 Success:** Working-memory blocks appear in the dynamic-context attachment; after a working-memory write, the next composition includes the updated working-memory content while all previously-sent messages are byte-unchanged. (Snapshot state is anchored per turn — the first round of each turn forces a full snapshot — so the update arrives as part of the next full snapshot, not necessarily a delta.)
- **cache-friendliness.AC3.3 Success:** With no working-memory blocks, no working-memory section appears anywhere in the request.

---

## Context for the implementor

**Verified current state:**
- The prepend: `src/agent/context.ts:38-46` — `memory.getWorkingBlocks()`, formatted as `[Working Memory Context]\n## label\ncontent...`, pushed as the first user message.
- `buildMessages(history, memory)` is consumed only by `src/agent/agent.ts:322`. After removing the prepend, the `memory` parameter is unused — drop it and update the call site.
- `getWorkingBlocks` is also used by `src/reflexion/prediction-context.ts` — do NOT touch that; it's a separate provider.
- `MemoryBlock` type: `src/memory/types.ts` (has `label` and `content` fields — verify exact shape before writing the formatter).
- Provider pattern: `src/recall/context.ts:45-60`; registration: `src/index.ts:1104-1170`; `ClassifiedProvider` in `src/agent/types.ts:71-79`.
- Testing conventions: hand-rolled fakes, `bun:test`, AC-prefixed names, `(unit)` marker. `createMockMemoryManager()` in `src/agent/agent.test.ts:98-151` returns `[]` from `getWorkingBlocks()` by default — override per test to return blocks.

**Design decisions (from design doc D2):**
- Holder + formatter live in a new file `src/memory/context.ts` (domain-owned, like recall's `src/recall/context.ts`).
- The agent refreshes the holder every round (`setBlocks(await deps.memory.getWorkingBlocks())`) before `computeSnapshot` runs. This costs the same DB read `buildMessages` used to do — no new I/O.
- Empty blocks → provider returns `undefined` → no section (AC3.3).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Working-memory context provider in src/memory/context.ts

**Verifies:** (foundation for cache-friendliness.AC3.2, AC3.3; tested in Task 2)

**Files:**
- Create: `src/memory/context.ts`
- Modify: `src/memory/index.ts` (barrel export)

**Implementation:**

```typescript
// pattern: Functional Core

/**
 * Context provider for working-memory blocks.
 * Formats working blocks into a snapshot-pipeline section; the agent loop
 * refreshes the block list each round before snapshot composition.
 */

import type { ContextProvider } from '@/agent/types.js';
import type { MemoryBlock } from './types.ts';

export type WorkingMemoryContextState = {
  setBlocks(blocks: ReadonlyArray<MemoryBlock>): void;
};

export function formatWorkingMemorySection(
  blocks: ReadonlyArray<MemoryBlock>,
): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((block) => `### ${block.label}\n${block.content}`).join('\n\n');
}

export function createWorkingMemoryContextProvider(): ContextProvider & WorkingMemoryContextState {
  let currentBlocks: ReadonlyArray<MemoryBlock> = [];

  const provider = (() => formatWorkingMemorySection(currentBlocks)) as ContextProvider &
    WorkingMemoryContextState;

  provider.setBlocks = (blocks: ReadonlyArray<MemoryBlock>) => {
    currentBlocks = blocks;
  };

  return provider;
}
```

Match the import style used by `src/recall/context.ts` (path alias vs relative — copy what that file does). Export both symbols from `src/memory/index.ts`.

Note the section content uses `###` headings because the snapshot pipeline wraps each provider's output under a `## <provider-name>` heading (`formatSnapshotContent`, src/agent/snapshot.ts:47-51) — same nesting convention as recall's `### [label | domain]` fragments.

**Verification:**
Run: `bun run build`
Expected: no type errors.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Provider unit tests

**Verifies:** cache-friendliness.AC3.3 (empty → undefined), formatter contract for AC3.2

**Files:**
- Create: `src/memory/context.test.ts`

**Testing:**
- `formatWorkingMemorySection([])` returns `undefined`.
- Two blocks format as `### label1\ncontent1\n\n### label2\ncontent2`.
- Provider returns `undefined` before `setBlocks` and after `setBlocks([])`; returns the formatted section after `setBlocks([block])`.

Functional Core style, no mocks. Header: `// pattern: Functional Core`.

**Verification:**
Run: `bun test src/memory/context.test.ts`
Expected: all pass.

**Commit:** `feat(memory): add working-memory snapshot context provider`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Remove the prepend from buildMessages; refresh the holder in the agent loop

**Verifies:** cache-friendliness.AC3.1 (tested in Task 5)

**Files:**
- Modify: `src/agent/context.ts` — delete lines 38-46 (the `getWorkingBlocks` fetch and the `[Working Memory Context]` push); change the signature to `buildMessages(history: ReadonlyArray<ConversationMessage>): Promise<Array<Message>>` (drop the now-unused `memory` parameter and its import if unused elsewhere in the file); update the doc comment (it currently says "Prepends working memory blocks as context").
- Modify: `src/agent/types.ts` — add optional `workingMemoryContextState?: WorkingMemoryContextState` to `AgentDependencies`.
- Modify: `src/agent/agent.ts` — update the call at line 322 to `buildMessages(history)`; immediately before the snapshot composition block (~line 341), refresh the holder:

```typescript
      if (deps.workingMemoryContextState) {
        deps.workingMemoryContextState.setBlocks(await deps.memory.getWorkingBlocks());
      }
```

**Verification:**
Run: `bun run build`
Expected: no type errors.
Run: `bun test src/agent/`
Expected: existing tests pass. If any existing test asserts the `[Working Memory Context]` message (check `src/agent/context.test.ts` and `agent.test.ts`), rewrite it to assert the new behaviour: no working-memory message in `buildMessages` output (the snapshot-delivery assertions land in Task 5).
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Composition root wiring

**Verifies:** cache-friendliness.AC3.2 wiring (tested at unit level in Task 5)

**Files:**
- Modify: `src/index.ts`

**Implementation:**

1. Create the holder next to the other context providers (~line 735):

```typescript
  const workingMemoryContextProvider = createWorkingMemoryContextProvider();
```

2. Register in `classifiedProviders` (src/index.ts:1104-1170, recall pattern):

```typescript
  classifiedProviders.push({
    name: 'working-memory',
    provider: workingMemoryContextProvider,
    classification: 'dynamic',
  });
```

3. Pass `workingMemoryContextState: workingMemoryContextProvider` in the `AgentDependencies` object.

**Verification:**
Run: `bun run build && bun test`
Expected: clean type-check; full suite passes (DB-gated tests per their env guards).
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Agent-level unit tests for AC3

**Verifies:** cache-friendliness.AC3.1, cache-friendliness.AC3.2, cache-friendliness.AC3.3

**Files:**
- Modify: `src/agent/agent.test.ts` (and `src/agent/context.test.ts` for the buildMessages assertion if that's where buildMessages tests live)

**Testing:**

Wire deps like index.ts: `createWorkingMemoryContextProvider()` passed as `workingMemoryContextState` and registered in `classifiedProviders` as `{ name: 'working-memory', classification: 'dynamic' }`. Use a mutable fake memory manager whose `getWorkingBlocks` returns a test-controlled array.

- **cache-friendliness.AC3.1 (unit):** With `getWorkingBlocks` returning one block, run a turn and assert NO message in `tracker.requests[0].messages` contains `[Working Memory Context]`, and `messages[0]` is the first history message (not a working-memory message). Also assert `buildMessages(history)` output directly in context tests: history in → same-length message list out, no prepended message.
- **cache-friendliness.AC3.2 (unit):** Turn 1 with block A; mutate the fake to return block A′ (changed content); turn 2. Assert: turn 2's LAST message attachment contains A′'s content under the `## working-memory` section; and every message in turn 2's request that was also present in turn 1's request is byte-identical (`JSON.stringify` equality over the shared prefix, excluding turn 1's final composed user message — attachment composition of the final message is Phase 4's subject).
- **cache-friendliness.AC3.3 (unit):** `getWorkingBlocks` returns `[]`; assert the string `working-memory` appears nowhere in `JSON.stringify(tracker.requests[0])`.

**Verification:**
Run: `bun test src/agent/ src/memory/context.test.ts`
Expected: all pass.

**Commit:** `feat(agent,memory): deliver working memory via snapshot pipeline, not message prefix`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update subsystem docs

**Verifies:** None (documentation hygiene)

**Files:**
- Modify: `src/agent/CLAUDE.md` — "Working memory blocks are prepended to the message context" guarantee becomes snapshot-pipeline delivery; note the `buildMessages(history)` signature change and the new dependency.
- Modify: `src/memory/CLAUDE.md` — add `createWorkingMemoryContextProvider` / `formatWorkingMemorySection` / `WorkingMemoryContextState` to the exposed API; update "Used by".

**Step 1: Make both edits; update "Last verified" dates.**

**Step 2: Commit**

```bash
git add src/agent/CLAUDE.md src/memory/CLAUDE.md
git commit -m "docs: update agent/memory contracts for snapshot-delivered working memory"
```
<!-- END_TASK_6 -->
