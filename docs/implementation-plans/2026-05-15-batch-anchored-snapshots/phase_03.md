# Batch-Anchored Snapshots Implementation Plan

**Goal:** Remove dynamic context provider output from the system prompt so that the system prompt is stable between turns when tools and persona haven't changed.
**Architecture:** Modify the existing `buildSystemPrompt` function to stop accepting context providers entirely. The system prompt becomes solely the output of `memory.buildSystemPrompt()` (persona and core memory). All context providers are now classified as dynamic and will be routed to user message attachments in Phase 4. Provider classification types are added to `src/agent/types.ts` for use in the composition root.
**Tech Stack:** Bun, TypeScript 5.7+, Anthropic SDK
**Scope:** Phase 3 of 4
**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### batch-anchored-snapshots.AC1: System Prompt Stability
- **batch-anchored-snapshots.AC1.1 Success:** System prompt content hash is identical between consecutive turns when tools and persona haven't changed
- **batch-anchored-snapshots.AC1.2 Success:** Adding/removing a tool changes the system prompt hash (expected cache bust)
- **batch-anchored-snapshots.AC1.3 Success:** Changing memory content does NOT change the system prompt hash
- **batch-anchored-snapshots.AC1.4 Success:** Changing recall results does NOT change the system prompt hash
- **batch-anchored-snapshots.AC1.5 Edge:** First turn with no dynamic context produces a user message with no attachments

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add provider classification types

**Verifies:** None (type-only, compiler verifies)

**Files:**
- Modify: `src/agent/types.ts`

**Implementation:**

Add the following types to `src/agent/types.ts`:

```typescript
export type ProviderClassification = 'stable' | 'dynamic';

export type ClassifiedProvider = {
  readonly name: string;
  readonly provider: ContextProvider;
  readonly classification: ProviderClassification;
};
```

These types are used by the composition root (`src/index.ts`) in Phase 4 to classify providers. The `name` field is the key used in the snapshot hash map (e.g., `'recall'`, `'memory'`, `'scheduling'`).

Update `AgentDependencies` to accept classified providers alongside the existing unclassified array:

```typescript
export type AgentDependencies = {
  // ... existing fields ...
  contextProviders?: ReadonlyArray<ContextProvider>;
  classifiedProviders?: ReadonlyArray<ClassifiedProvider>;
  // ... existing fields ...
};
```

The `classifiedProviders` field is optional. When present, it replaces `contextProviders` for system prompt construction and snapshot computation. When absent, the agent falls back to the existing `contextProviders` behavior (all providers in system prompt, no snapshots). This ensures backward compatibility during the transition.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): add provider classification types to AgentDependencies`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Modify buildSystemPrompt to exclude dynamic providers

**Verifies:** batch-anchored-snapshots.AC1.1, batch-anchored-snapshots.AC1.3, batch-anchored-snapshots.AC1.4

**Files:**
- Modify: `src/agent/context.ts`

**Implementation:**

Modify `buildSystemPrompt` signature to accept `ClassifiedProvider` array:

```typescript
export async function buildSystemPrompt(
  memory: MemoryManager,
  classifiedProviders?: ReadonlyArray<ClassifiedProvider>,
): Promise<string>;
```

Updated logic:
1. Call `memory.buildSystemPrompt()` for the base prompt (persona, core memory blocks)
2. If `classifiedProviders` is provided:
   - Filter to only `classification === 'stable'` providers
   - Evaluate each stable provider and append non-undefined results with `\n\n`
3. If `classifiedProviders` is not provided (backward compat): no providers appended (the old `contextProviders` parameter is removed from this function's signature)

Wait — the codebase investigation shows `buildSystemPrompt` is called in `agent.ts` with `contextProviders`. We need to maintain backward compat during the transition. Better approach:

Change the signature to accept an optional `ReadonlyArray<ClassifiedProvider>` as the second parameter. In the current flow (before Phase 4 wires things up), the agent passes nothing for this parameter, and `buildSystemPrompt` returns just `memory.buildSystemPrompt()`. The old `contextProviders` parameter is removed from `buildSystemPrompt` — callers that were passing unclassified providers will need updating in Phase 4.

Actually, the cleanest approach: `buildSystemPrompt` drops the second parameter entirely. It only returns `memory.buildSystemPrompt()`. The agent loop currently passes `deps.contextProviders` to it — that call site is updated to stop passing providers. This is a two-line change in `agent.ts` (remove the second argument). All providers become dynamic by default, routed through snapshots in Phase 4.

Final implementation:

```typescript
export async function buildSystemPrompt(
  memory: MemoryManager,
): Promise<string> {
  return memory.buildSystemPrompt();
}
```

Remove the `contextProviders` parameter and the loop that appended provider output.

Update **ALL THREE** call sites in `agent.ts` that invoke `buildSystemPrompt` with `contextProviders`:

1. **Preliminary overhead estimation** (line ~123): `buildSystemPrompt(deps.memory, deps.contextProviders)` → `buildSystemPrompt(deps.memory)`
2. **In-loop system prompt** (line ~143): `buildSystemPrompt(memory, deps.contextProviders)` → `buildSystemPrompt(memory)`
3. **Post-recall rebuild** (line ~166, if present): same change

```typescript
// Before (all three sites):
const systemPrompt = await buildSystemPrompt(memory, deps.contextProviders);
// After (all three sites):
const systemPrompt = await buildSystemPrompt(memory);
```

This is safe because Phase 4 will wire dynamic providers through snapshot state instead. Between Phase 3 and Phase 4 being applied, dynamic context will temporarily not appear (it won't be in the system prompt OR the user message). This is acceptable because phases are applied sequentially within a single branch — the intermediate state is never deployed.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes (no callers pass a second argument anymore)

**Commit:** `refactor(agent): remove dynamic providers from system prompt construction`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (task 3) -->
<!-- START_TASK_3 -->
### Task 3: System prompt stability tests

**Verifies:** batch-anchored-snapshots.AC1.1, batch-anchored-snapshots.AC1.3, batch-anchored-snapshots.AC1.4, batch-anchored-snapshots.AC1.5

**Files:**
- Create: `src/agent/context-stability.test.ts`

**Implementation:**

Separate test file focused on system prompt stability (the existing `context.ts` tests, if any, cover the utility functions like `shouldCompress` and `truncateOldest`).

Test setup: Create a mock `MemoryManager` with a stub `buildSystemPrompt()` that returns a fixed persona string. This is the same pattern used elsewhere in the codebase — plain object implementing the interface.

```typescript
const mockMemory = {
  buildSystemPrompt: async () => 'You are a test agent. Your name is Test.',
  // ... other required fields stubbed as needed
} as MemoryManager;
```

**`describe('AC1: System Prompt Stability')`:**

- **AC1.1 — system prompt hash stable between turns:** Call `buildSystemPrompt(mockMemory)` twice. Hash both results with `Bun.hash()`. Assert hashes are identical.

- **AC1.3 — changing memory content does not change system prompt hash:** This AC is about dynamic context providers (recall, memory snapshots) NOT affecting the system prompt. Since `buildSystemPrompt` no longer accepts providers, this is structurally guaranteed. Test by confirming `buildSystemPrompt` returns only the memory manager's base prompt — no extra content appended.

- **AC1.4 — changing recall results does not change system prompt hash:** Same structural guarantee as AC1.3. Test by calling `buildSystemPrompt` and asserting the result does NOT contain any recall-related content (e.g., does not contain `[Recalled Context]` or similar markers).

- **AC1.5 — first turn with no dynamic context produces plain user message:** Call `buildUserMessage('hello', null)` (from Phase 2). Assert result is `{ role: 'user', content: 'hello' }`. Import `buildUserMessage` from `./messages.ts`.

**Note on AC1.2:** Tool definitions are passed separately in `ModelRequest.tools`, not in the system prompt string. The system prompt hash is unaffected by tool changes — Anthropic's cache key includes tools separately. AC1.2 is about the overall cache identity (system + tools), which is verified at the integration level in Phase 4. For this phase, we confirm the system prompt string itself is stable.

**Note on dependencies:** The AC1.5 test imports `buildUserMessage` from Phase 2. Phase 3 is not independent of Phase 2 — the AC1.5 test requires Phase 2 to be completed first. Phases are applied sequentially so this is not a blocker, but the dependency should be acknowledged.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun test src/agent/context-stability.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add system prompt stability tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_4 -->
### Task 4: Update agent CLAUDE.md

**Verifies:** None (documentation)

**Files:**
- Modify: `src/agent/CLAUDE.md`

**Implementation:**

Update the agent module's CLAUDE.md to reflect that `buildSystemPrompt` no longer accepts context providers:

- In **Contracts > Exposes**: Update `buildSystemPrompt` description to note it only includes memory manager output (no context providers)
- In **Contracts > Guarantees**: Update the bullet about `contextProviders` being called during system prompt construction — note that this is replaced by snapshot-based attachment in `buildUserMessage`
- In **Key Files**: Add `snapshot.ts` and `messages.ts` entries

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes (documentation only)

**Commit:** `docs(agent): update CLAUDE.md for system prompt separation`
<!-- END_TASK_4 -->
