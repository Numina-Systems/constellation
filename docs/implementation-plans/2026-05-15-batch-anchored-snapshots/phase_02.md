# Batch-Anchored Snapshots Implementation Plan

**Goal:** Build user messages with dynamic context attachment content blocks, composing snapshot results into Anthropic-compatible multi-block messages.
**Architecture:** Functional Core module with a pure function that takes raw user text and an optional snapshot result, returning a properly structured Anthropic message. No side effects, no state. Consumes `SnapshotResult` from Phase 1.
**Tech Stack:** Bun, TypeScript 5.7+, Anthropic SDK
**Scope:** Phase 2 of 4
**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### batch-anchored-snapshots.AC2: Attachment Composition
- **batch-anchored-snapshots.AC2.1 Success:** Dynamic context from all providers is collected into a single structured attachment block
- **batch-anchored-snapshots.AC2.2 Success:** Attachment block is prepended to the user message's content array as a `text` content block
- **batch-anchored-snapshots.AC2.3 Success:** User's actual message text remains the final content block in the array
- **batch-anchored-snapshots.AC2.4 Success:** Empty dynamic context (all providers return `undefined`) produces no attachment block
- **batch-anchored-snapshots.AC2.5 Failure:** Attachment content never appears in the system prompt string

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: User message composition function

**Verifies:** batch-anchored-snapshots.AC2.1, batch-anchored-snapshots.AC2.2, batch-anchored-snapshots.AC2.3, batch-anchored-snapshots.AC2.4

**Files:**
- Create: `src/agent/messages.ts`

**Implementation:**

Create `src/agent/messages.ts` with:

```typescript
// pattern: Functional Core
```

1. `buildUserMessage(text: string, snapshot: SnapshotResult | null): Message` — Pure function.

   Logic:
   - If `snapshot` is `null`, or `snapshot.mode === 'noop'`, or `snapshot.content === null`:
     - Return `{ role: 'user', content: text }` (plain string content, no attachment)
   - If `snapshot.mode === 'full'` or `snapshot.mode === 'delta'` and `snapshot.content` is non-null:
     - Build a content array with two `TextBlock` entries:
       1. `{ type: 'text', text: formatAttachment(snapshot.content, snapshot.mode) }` — the dynamic context attachment
       2. `{ type: 'text', text: text }` — the user's actual message
     - Return `{ role: 'user', content: [attachmentBlock, userBlock] }`

2. `formatAttachment(content: string, mode: SnapshotMode): string` — Internal helper. Wraps the snapshot content with a header indicating the snapshot type:
   - For `'full'`: `[Dynamic Context — Full Snapshot]\n\n${content}`
   - For `'delta'`: `[Dynamic Context — Updated Sections]\n\n${content}`

   The header helps the model understand whether it's seeing complete context or just changes. This is informational; the model has seen full context on the first turn and can reference conversation history for unchanged sections.

Import types from Phase 1:
```typescript
import type { SnapshotResult, SnapshotMode } from './snapshot.ts';
import type { Message } from '../model/types.ts';
```

The return type is `Message` from `src/model/types.ts`, which already supports `content: string | Array<ContentBlock>`. No new types needed.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): add user message composition with snapshot attachments`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: User message composition tests

**Verifies:** batch-anchored-snapshots.AC2.1, batch-anchored-snapshots.AC2.2, batch-anchored-snapshots.AC2.3, batch-anchored-snapshots.AC2.4, batch-anchored-snapshots.AC2.5

**Files:**
- Create: `src/agent/messages.test.ts`

**Implementation:**

Test file with `describe('AC2: Attachment Composition')`:

- **AC2.1 — full snapshot produces single attachment block:** Create a `SnapshotResult` with `mode: 'full'` and multi-section content. Call `buildUserMessage('hello', snapshot)`. Assert result has `content` array with exactly 2 elements. Assert first element is a `TextBlock` containing all dynamic context sections.

- **AC2.2 — attachment block is prepended:** Same setup as AC2.1. Assert `content[0].type === 'text'` and `content[0].text` starts with `[Dynamic Context`.

- **AC2.3 — user text is last content block:** Same setup as AC2.1. Assert `content[1].type === 'text'` and `content[1].text === 'hello'`.

- **AC2.4 — noop snapshot produces no attachment:** Create a `SnapshotResult` with `mode: 'noop'` and `content: null`. Call `buildUserMessage('hello', snapshot)`. Assert result has `content === 'hello'` (plain string, not array).

- **AC2.4 (variant) — null snapshot produces no attachment:** Call `buildUserMessage('hello', null)`. Assert `content === 'hello'`.

- **AC2.4 (variant) — full snapshot with null content produces no attachment:** Create `SnapshotResult` with `mode: 'full'` and `content: null` (all providers returned undefined). Assert `content === 'hello'`.

- **AC2.5 — attachment content never in system prompt:** This is an integration-level AC verified in Phase 3/4. For this phase, add a focused test: call `buildUserMessage` and verify the returned message has `role: 'user'` (not `'system'`), confirming dynamic context is routed to the user message.

- **Delta snapshot includes only changed sections:** Create a `SnapshotResult` with `mode: 'delta'` and content containing one section. Call `buildUserMessage`. Assert attachment block text contains `[Dynamic Context — Updated Sections]` and includes only the changed section content.

- **Attachment header distinguishes full from delta:** Call `buildUserMessage` with full snapshot, assert header contains `Full Snapshot`. Call with delta snapshot, assert header contains `Updated Sections`.

Test helpers: Create `SnapshotResult` objects directly as literals — they're plain readonly objects, no factory needed.

```typescript
const fullSnapshot: SnapshotResult = {
  mode: 'full',
  content: '## Recall\nSome recalled context\n\n## Memory\nSome memory',
  hashes: new Map([['recall', 123n], ['memory', 456n]]),
  changedProviders: ['recall', 'memory'],
};
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun test src/agent/messages.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add user message composition tests for attachment blocks`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export update

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add message composition export to the agent barrel:

```typescript
export { buildUserMessage } from './messages.ts';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): export buildUserMessage from agent barrel`
<!-- END_TASK_3 -->
