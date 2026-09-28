# Cache-Friendliness Phase 5: Close the Diagnostics Blind Spot

**Goal:** Make cache-bust diagnostics hash the full message list so a rewrite of the previously-last message (the composed-vs-replayed class of bust) is detectable.

**Architecture:** `computeMessagePrefixState` (src/agent/cache-diagnostics.ts:38-67) sets `prefixLength = messages.length - 1`, excluding the last message from hashing. Because of that, the pre-Phase-4 compose/replay mismatch was structurally invisible: the composed message was never hashed on the call that sent it, so its replayed (different) form was never compared against anything. This phase hashes ALL messages and changes the comparison to "the previous full list must be a hash-prefix of the current list". Phase 4 must land first — it removes the one legitimate every-turn mismatch, so this detector doesn't warn-storm.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `bun:test`. Pure Functional Core change.

**Scope:** Phase 5 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`. Requires Phase 4 merged.

**Codebase verified:** 2026-07-02 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC5: Diagnostics detect last-message recomposition
- **cache-friendliness.AC5.1 Success:** If the message that was last in the previous request differs in the current request (e.g. composed vs replayed content), `checkForCacheBust` emits a `message_prefix` event.
- **cache-friendliness.AC5.2 Success:** Append-only growth (previous messages byte-identical, new messages appended) emits no `message_prefix` event.
- **cache-friendliness.AC5.3 Success:** `message_prefix` events remain suppressed when `compactionOccurred` is set.

---

## Context for the implementor

**Verified current state:**
- `src/agent/cache-diagnostics.ts:38-67`: `computeMessagePrefixState` — `prefixLength = messages.length - 1`, `slice(0, prefixLength)`, per-message `Bun.hash(JSON.stringify(msg))`.
- Comparison logic: lines 194-227 — shrink check (`currentPrefixState.prefixLength < previousPrefixState.prefixLength`) plus overlap hash comparison over `min(prev, cur)` prefix lengths.
- Existing tests (`src/agent/cache-diagnostics.test.ts`): "appending a new message does NOT produce event" (lines ~200-222) — appends msg3 to [msg1, msg2] and expects no event; "edited message in prefix produces event" (~175-198). Both remain valid under the new semantics; the append test currently passes because of overlap comparison, and continues to pass because append-only growth leaves the previous full list as an unchanged prefix.
- Suppression: `isDimensionSuppressed` (lines 3-18) — `message_prefix` suppressed when `flags.compactionOccurred` or `flags.isFirstTurn`. Unchanged.
- This file is `// pattern: Functional Core` — tests need no mocks.
- The `MessagePrefixState` type (lines 103-107) keeps its shape; only the semantics of `prefixLength`/`messageHashes` change (now covering the full list). Rename fields only if it stays a file-local type — it is (not exported) — so rename `prefixLength` → `messageCount` for honesty.

**Semantics to implement (D5):**
- Hash every message: `messageHashes.length === messages.length`.
- Bust iff the previous FULL list is not a hash-prefix of the current list:
  - `current.length < previous.length` → bust (shrink), OR
  - any `previousHashes[i] !== currentHashes[i]` for `i < previous.length` → bust.
- Everything else (system_prompt, tools, beta_headers dimensions; suppression; event payload shape using `totalSize`) unchanged.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Write the failing test — last-message rewrite is detected

**Verifies:** cache-friendliness.AC5.1

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Step 1: Write the failing test**

Follow the existing test structure in the file (build `CheckForCacheBustOptions` with fixed `systemPrompt`, `tools`, `flags`). Sequence:

1. Call 1: messages `[m1, m2]` (m2 is "the last message", e.g. a composed user message). First call records state, returns `[]`.
2. Call 2: messages `[m1, m2', m3]` where `m2'` differs from `m2` (e.g. the replayed uncomposed form) and `m3` is a new assistant message. Flags all false.
3. Assert exactly one event with `dimension === 'message_prefix'`.

Name: `it('cache-friendliness.AC5.1: rewrite of the previously-last message produces a message_prefix event', ...)`.

Also add the append-only control now (AC5.2), if not already covered verbatim:
`it('cache-friendliness.AC5.2: append-only growth produces no message_prefix event', ...)` — call 1 `[m1, m2]`, call 2 `[m1, m2, m3]` (m2 byte-identical), assert no events.

**Step 2: Run to verify the AC5.1 test fails**

Run: `bun test src/agent/cache-diagnostics.test.ts -t "AC5.1"`
Expected: FAIL — current code never hashed `m2` on call 1, so the rewrite is invisible.

The AC5.2 test should already pass (control).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Hash the full message list

**Verifies:** cache-friendliness.AC5.1, cache-friendliness.AC5.2

**Files:**
- Modify: `src/agent/cache-diagnostics.ts:38-67` (`computeMessagePrefixState`) and the comparison block (~194-227)

**Implementation:**

1. `computeMessagePrefixState`: drop the `- 1` — hash all messages. Rename the local type field `prefixLength` → `messageCount` (file-local `MessagePrefixState`, not exported). `totalSize` now sums all serialized messages.
2. Comparison block: previous-full-list-is-prefix-of-current:

```typescript
      if (previousPrefixState) {
        let prefixChanged = false;

        if (currentPrefixState.messageCount < previousPrefixState.messageCount) {
          prefixChanged = true;
        } else {
          for (let i = 0; i < previousPrefixState.messageCount; i++) {
            if (
              previousPrefixState.messageHashes[i] !== currentPrefixState.messageHashes[i]
            ) {
              prefixChanged = true;
              break;
            }
          }
        }

        if (prefixChanged && !isDimensionSuppressed('message_prefix', flags)) {
          // unchanged event construction (previousSize/currentSize/delta/turn)
        }
      }
```

3. Update the function's doc comments to describe the new semantics (previous request's full message list must be a prefix of the current request's).

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: AC5.1 and AC5.2 pass; existing "edited message in prefix" test passes; existing "appending does NOT produce event" test passes.
Run: `bun run build`
Expected: clean.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Suppression regression test, full-suite check, commit

**Verifies:** cache-friendliness.AC5.3

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Step 1: Add the suppression test**

`it('cache-friendliness.AC5.3: last-message rewrite is suppressed when compactionOccurred', ...)` — same sequence as AC5.1 but call 2 passes `flags: { compactionOccurred: true }`; assert no `message_prefix` event. (Check whether an equivalent suppression test already exists — if it covers only prefix edits, add this last-message variant anyway; it exercises the new hash coverage.)

**Step 2: Run agent + diagnostics suites**

Run: `bun test src/agent/`
Expected: all pass. In particular, `agent.test.ts` turns must NOT log new `cache bust detected` warnings for normal multi-round/multi-turn flows — Phase 4 made replay byte-identical, so full-list hashing sees append-only growth. If agent tests now surface `message_prefix` warnings, that is a REAL replay mismatch the earlier phases missed: stop and investigate the differing message (compare `JSON.stringify` of the two requests' message lists) rather than loosening the detector.

**Step 3: Commit**

```bash
git add src/agent/cache-diagnostics.ts src/agent/cache-diagnostics.test.ts
git commit -m "feat(agent): detect last-message rewrites in cache diagnostics"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update subsystem docs

**Verifies:** None (documentation hygiene)

**Files:**
- Modify: `src/agent/CLAUDE.md` — the cache-diagnostics guarantee now reads: message_prefix dimension hashes the full message list; the previous request's messages must replay as a byte-identical prefix of the current request.

**Step 1: Edit; update "Last verified" date.**

**Step 2: Commit**

```bash
git add src/agent/CLAUDE.md
git commit -m "docs: document full-prefix cache diagnostics semantics"
```
<!-- END_TASK_4 -->
