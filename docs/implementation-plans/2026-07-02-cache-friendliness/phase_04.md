# Cache-Friendliness Phase 4: Persist Composed User Messages; Consume Snapshots Only When Deliverable

**Goal:** Make conversation replay byte-identical to what was sent: compose the snapshot attachment as a single string, persist it back onto the user-message row, and only consume snapshot state when the content can actually be delivered.

**Architecture:** Today the user message is persisted as plain text (src/agent/agent.ts:193-197) before the loop; `buildUserMessage` composes `[attachment, text]` content blocks at request time (src/agent/messages.ts:42-74) and the composed form is never persisted, so next turn's `buildMessages` replays the plain string — a guaranteed provider cache miss at that message. Separately, `computeSnapshot` runs every round (src/agent/agent.ts:343) even when the last message can't carry an attachment (tool rounds), consuming provider hashes whose content is then discarded. This phase: (D3) composes a single string and UPDATEs the persisted row + in-memory history entry; (D4) moves `computeSnapshot` inside the deliverable branch, guarded by a per-turn flag that also prevents double-wrapping on the overflow-recovery retry path.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `bun:test`, PostgreSQL (messages table, `content TEXT`).

**Scope:** Phase 4 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`. Assumes Phases 1-3 are merged (in particular Phase 3, so `messages[0]` is stable and this fix is observable).

**Codebase verified:** 2026-07-02 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC4: Replay is byte-identical
- **cache-friendliness.AC4.1 Success:** When a snapshot attachment is composed onto a user message, the persisted message content is updated to the exact composed string, and the next turn's `buildMessages` reproduces it byte-for-byte.
- **cache-friendliness.AC4.2 Success:** A dynamic-provider change occurring during a tool round (last message not a plain user string) is not consumed; it is delivered as full/delta content on the next composable user message.
- **cache-friendliness.AC4.3 Success:** Composed user messages are single strings (no content-block arrays), persistable in the existing `content` column without schema change.

---

## Context for the implementor

**Verified current state:**
- User message persisted once, plain, before the round loop: `src/agent/agent.ts:193-197` via the local `persistMessage` helper (~lines 711-740, INSERT only). The INSERT returns the new row id (`RETURNING id` style — verify the exact SQL in `persistMessage` and how/whether the id is currently captured).
- In-memory `history: Array<ConversationMessage>` is what `buildMessages(history)` reads each round; entries are `ConversationMessage` (`src/agent/types.ts:43-52`, `content: string`, `id: string`).
- Composition: `src/agent/agent.ts:341-350`; `buildUserMessage`: `src/agent/messages.ts:42-74` (returns content-block array for full/delta — the thing AC4.3 removes). Only consumer is agent.ts:348; tests in `src/agent/messages.test.ts`.
- Overflow recovery (`src/agent/agent.ts:403-436`): on `CONTEXT_OVERFLOW`, compacts, `snapshotState.reset()`, `roundCount--`, `continue` — the round re-runs and would re-compose the (already composed) last user message without a guard.
- `PersistenceProvider` (src/persistence/types.ts:8-16) exposes raw `query()` — no update helper exists; `MessageStore` is read-oriented. Migrations are append-only and immutable; NO schema change is needed (content stays TEXT — that's the point of D3's single-string composition).
- Checkpoint restore compares message IDs only, never content (`src/agent/checkpoint-restore.ts:103-120`) — updating a row's content is safe.
- Compactor does not re-parse or exact-match user message content — safe.
- Snapshot anchoring: `forceFullSnapshot = isFirstRound` (`roundCount === 1`), so every turn's first composition is a full snapshot. `snapshotState.reset()` sites: agent.ts:216, 428, 561.
- Mock persistence in `src/agent/agent.test.ts:31-95` routes SQL by `sql.includes(...)` — it has no `UPDATE messages` branch yet (Task 4 adds one).
- Testing conventions: hand-rolled fakes, `bun:test`, AC-prefixed names, `(unit)` marker, tracker-captured `ModelRequest`s.

**Design decisions:**
- **Single-string composition (D3/AC4.3):** `buildUserMessage` returns `{role: 'user', content: attachmentText + '\n\n' + userText}`. No content-block arrays, no schema migration, byte-identical replay from the TEXT column.
- **Per-turn `snapshotComposed` flag (D4):** composition (and `computeSnapshot`) happens at most once per turn, only when the last message is a plain-string user message. The flag also makes the overflow-recovery retry safe: the retried round sees the flag set and sends the already-composed content from history as-is (no double-wrap). Provider changes that occur later in the turn are consumed on the NEXT turn's composition — and since the next turn's first round forces a full snapshot, nothing is lost.
- **Update both stores:** after composing, UPDATE the DB row (by the id captured from `persistMessage`) and mutate the matching in-memory `history` entry, so intra-turn rebuilds (rounds 2+) and cross-turn replays both reproduce the sent bytes.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: buildUserMessage composes a single string

**Verifies:** cache-friendliness.AC4.3

**Files:**
- Modify: `src/agent/messages.ts`
- Modify: `src/agent/messages.test.ts`

**Step 1: Update the existing tests first**

Rewrite the full/delta assertions in `src/agent/messages.test.ts`: for a full snapshot with content `C` and user text `T`, `buildUserMessage(T, snapshot)` returns `{role: 'user', content: '[Dynamic Context — Full Snapshot]\n\n' + C + '\n\n' + T}` — a plain string, `typeof content === 'string'`. Same for delta with the `[Dynamic Context — Updated Sections]` header. The null/noop/no-content cases are unchanged (plain `{role: 'user', content: T}`).

Add: `it('cache-friendliness.AC4.3: composed messages are single strings', ...)` asserting `typeof result.content === 'string'` for full and delta modes.

Run: `bun test src/agent/messages.test.ts`
Expected: FAIL (current implementation returns a block array).

**Step 2: Implement**

In `buildUserMessage` (src/agent/messages.ts:42-74), replace the content-array branch:

```typescript
  if ((snapshot.mode === 'full' || snapshot.mode === 'delta') && snapshot.content !== null) {
    return {
      role: 'user',
      content: `${formatAttachment(snapshot.content, snapshot.mode)}\n\n${text}`,
    };
  }
```

Update the module doc comment (it currently says "attachment blocks prepended").

**Step 3: Verify and commit**

Run: `bun test src/agent/messages.test.ts && bun run build`
Expected: all pass, clean type-check.

```bash
git add src/agent/messages.ts src/agent/messages.test.ts
git commit -m "refactor(agent): compose snapshot attachments as single-string user messages"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Capture the persisted user-message id and add an update helper

**Verifies:** (foundation for cache-friendliness.AC4.1)

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

1. Read the `persistMessage` helper (~lines 711-740). If it does not already return the inserted row's id, make it return it (`RETURNING id` is already in the INSERT per the persistence patterns — surface it as the return value). Update the user-message persist call (~line 193) to capture it: `const userMessageId = await persistMessage({...})`.
2. Verify how the user message enters the in-memory `history` array after persistence (immediately after line 193-197). The `ConversationMessage` entry must carry `id === userMessageId`. If the current code appends an entry without the id, fix it to include the returned id. If history is instead re-loaded from persistence, no change is needed — confirm and note which.
3. Add a sibling helper next to `persistMessage`, matching its SQL style:

```typescript
  async function updateMessageContent(messageId: string, content: string): Promise<void> {
    await deps.persistence.query('UPDATE messages SET content = $1 WHERE id = $2', [
      content,
      messageId,
    ]);
  }
```

**Verification:**
Run: `bun run build`
Expected: no type errors (helper may be temporarily unused — if the linter/compiler objects to unused symbols, wire Task 3 in the same commit).
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Compose once per turn, persist what was sent, consume snapshots only when deliverable

**Verifies:** cache-friendliness.AC4.1, cache-friendliness.AC4.2 (tested in Task 5)

**Files:**
- Modify: `src/agent/agent.ts:341-350` (and the flag declaration near `recallExecuted` / `overflowRecoveryAttempted`, ~lines 230-238)

**Implementation:**

1. Declare `let snapshotComposed = false;` alongside the other per-turn flags before the round loop.
2. Replace the current composition block (lines 341-350):

```typescript
      // Compose snapshot onto the latest user message — at most once per turn,
      // and only when the last message can carry the attachment. Provider hashes
      // are consumed only here, so changes during tool rounds surface next turn.
      const lastMessage = finalMessages[finalMessages.length - 1];
      if (
        !snapshotComposed &&
        lastMessage &&
        lastMessage.role === 'user' &&
        typeof lastMessage.content === 'string'
      ) {
        snapshotComposed = true;
        const isFirstRound = roundCount === 1;
        const snapshotResult = snapshotState.computeSnapshot(dynamicProviders, isFirstRound);
        const composedUserMessage = buildUserMessage(lastMessage.content, snapshotResult);
        if (composedUserMessage.content !== lastMessage.content) {
          finalMessages = [...finalMessages.slice(0, -1), composedUserMessage];
          const composedContent = composedUserMessage.content as string;
          await updateMessageContent(userMessageId, composedContent);
          const historyEntry = history.find((m) => m.id === userMessageId);
          if (historyEntry) {
            historyEntry.content = composedContent;
          }
        }
      }
```

Notes:
- The existing `const isFirstRound = roundCount === 1;` at line 342 moves inside the block (or stays where it is — just don't compute the snapshot outside the guard).
- `history.find` by id is correct even after compaction rewrote `history` (the latest user message survives compaction; if it ever doesn't, the `if (historyEntry)` guard makes it a no-op).
- The `!snapshotComposed` guard prevents double-wrapping when the overflow-recovery path retries the round (agent.ts:403-436): the retried request replays the already-composed content from history, byte-identical.
- `ConversationMessage.content` mutation: if the type is deeply readonly, adjust by replacing the array element instead (`history[idx] = { ...historyEntry, content: composedContent }`).

**Verification:**
Run: `bun run build && bun test src/agent/`
Expected: type-check clean; existing tests pass except any that asserted content-block-array requests (update those to the single-string form).
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Teach the mock persistence provider about UPDATE

**Verifies:** (test infrastructure for AC4.1)

**Files:**
- Modify: `src/agent/agent.test.ts` (`createMockPersistenceProvider`, lines 31-95)

**Implementation:**

Add a branch to the mock's `query()` router:

```typescript
    if (sql.includes('UPDATE messages')) {
      const [content, id] = params ? Array.from(params) : [];
      for (const list of messages.values()) {
        const msg = list.find((m) => m.id === id);
        if (msg) {
          msg.content = content as string;
        }
      }
      return [];
    }
```

Place it before the generic SELECT/INSERT branches so `sql.includes('messages')` style matching elsewhere doesn't shadow it.

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: all pass (no behaviour change yet — the branch is exercised by Task 5).
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Agent-level unit tests for AC4

**Verifies:** cache-friendliness.AC4.1, cache-friendliness.AC4.2

**Files:**
- Modify: `src/agent/agent.test.ts`

**Testing:**

Wire a controllable dynamic provider into deps: `let providerValue = 'alpha'; let providerCalls = 0;` with `classifiedProviders: [{ name: 'test-ctx', provider: () => { providerCalls++; return providerValue; }, classification: 'dynamic' }]`.

- **cache-friendliness.AC4.1 (unit):** Turn 1 (single-round response). Assert: (a) the last message of `tracker.requests[0].messages` is a string containing `[Dynamic Context — Full Snapshot]`, `## test-ctx`, `alpha`, and the raw user text; (b) the mock persistence's stored user message content EQUALS that sent string (fetch it from the mock's in-memory map — expose the map or reuse `capturedInserts` plus the UPDATE branch's effect via `getConversationHistory()` on a fresh agent with the same conversation id); (c) run turn 2 on the same agent and assert the message at turn 1's last index inside `tracker.requests[1].messages` is byte-identical (`JSON.stringify` equality) to what turn 1 sent.
- **cache-friendliness.AC4.2 (unit):** Two-round turn (mock model responds `tool_use` then `end_turn`, with a registered no-op tool). During the tool round, mutate `providerValue = 'beta'`. Assert: (a) `providerCalls === 1` after the turn — the provider was NOT evaluated on the tool round (snapshot not consumed); (b) run another turn and assert its composed attachment contains `beta` (`## test-ctx` section carries the updated value).
- Regression guard: a turn where the provider returns `undefined` throughout composes nothing — last message content is exactly the raw user text, and the persisted content is unchanged plain text (no UPDATE side effects; assert no `[Dynamic Context` substring).

**Verification:**
Run: `bun test src/agent/agent.test.ts -t "AC4"`
Expected: all pass.
Run: `bun test src/agent/ && bun run build`
Expected: all pass, clean type-check.

**Commit:** `feat(agent): persist composed user messages for byte-identical replay`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update subsystem docs

**Verifies:** None (documentation hygiene)

**Files:**
- Modify: `src/agent/CLAUDE.md` — document: composed user messages are persisted as sent (replay byte-identical); snapshot state is consumed only when deliverable; `buildUserMessage` returns single-string content.

**Step 1: Edit and update the "Last verified" date.**

**Step 2: Commit**

```bash
git add src/agent/CLAUDE.md
git commit -m "docs: update agent contract for persisted snapshot composition"
```
<!-- END_TASK_6 -->
