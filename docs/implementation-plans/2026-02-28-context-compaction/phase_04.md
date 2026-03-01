# Context Compaction Implementation Plan — Phase 4

**Goal:** Add depth-based recursive re-summarization when summary batches accumulate beyond the clip window, and expose a `deleteBlock` method on `MemoryManager` for batch replacement.

**Architecture:** Extends the `compress()` method in `compactor.ts` to detect when accumulated batches exceed the clip window threshold. Oldest low-depth batches are grouped and re-summarized into a single higher-depth batch that replaces them. Requires listing archival blocks by label prefix (client-side filter on `list('archival')`) and deleting old blocks (new `deleteBlock` on `MemoryManager`).

**Tech Stack:** TypeScript, MemoryManager/MemoryStore (archival block management)

**Scope:** 7 phases from original design (phase 4 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-compaction.AC2: Recursive re-summarization compresses accumulated batches
- **context-compaction.AC2.1 Success:** When total summary batches exceed `clip_first + clip_last + buffer`, oldest batches are re-summarized
- **context-compaction.AC2.2 Success:** Re-summarized batches have depth incremented (depth 0 → depth 1, etc.)
- **context-compaction.AC2.3 Success:** Re-summarized batch replaces the source batches in archival memory
- **context-compaction.AC2.4 Edge:** Multiple compaction cycles produce progressively higher-depth batches

---

## Codebase Gap: MemoryManager lacks deleteBlock

Investigation found that `MemoryStore` has `deleteBlock(id: string): Promise<void>` but `MemoryManager` does not expose it. The compactor needs to delete old summary batches during re-summarization.

**Resolution:** Add `deleteBlock` to the `MemoryManager` interface and implementation. This is a minimal addition that follows the existing delegation pattern.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add deleteBlock to MemoryManager interface and implementation

**Files:**
- Modify: `src/memory/manager.ts:19-43` (add to interface)
- Modify: `src/memory/manager.ts` (add implementation in createMemoryManager)
- Modify: `src/memory/index.ts` (if deleteBlock needs to be re-exported — likely already covered by MemoryManager type export)

**Implementation:**

Add to the `MemoryManager` interface (after `list` method, around line 38):
```typescript
deleteBlock(id: string): Promise<void>;
```

Add implementation in the `createMemoryManager` factory function. The implementation should:
1. Delegate to `store.deleteBlock(id)`
2. Log the deletion event via `store.logEvent()` with event_type `'delete'`

This follows the same delegation pattern as other `MemoryManager` methods.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass. Existing tests still pass (new method is additive).

```bash
bun test
```

Expected: 116 pass, 3 DB-dependent fail (unchanged from baseline).

**Commit:** `feat(memory): add deleteBlock to MemoryManager interface`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add getCompactionBatches helper to compactor

**Files:**
- Modify: `src/compaction/compactor.ts`

**Implementation:**

Add a helper function inside the compactor factory (or as a module-level function) that lists existing compaction batches for a conversation:

```typescript
async function getCompactionBatches(conversationId: string): Promise<Array<{ id: string; batch: SummaryBatch }>>
```

This function:
1. Calls `memory.list('archival')` to get all archival blocks
2. Filters by `label.startsWith(`compaction-batch-${conversationId}`)
3. Parses each block's content to extract `SummaryBatch` metadata

**Batch metadata storage:** The `archiveBatch()` function from Phase 3 stores summary content via `memory.write()`. For re-summarization, we need to know the batch's depth, timestamp range, and message count. Store this as a structured header in the archived content:

```
[depth:0|start:2026-02-28T10:00:00Z|end:2026-02-28T11:30:00Z|count:20]
{actual summary content}
```

Add a `parseBatchMetadata()` pure function that extracts these fields from the content string, and update `archiveBatch()` (from Phase 3) to prepend this header when writing.

**Note:** This modification to `archiveBatch()` changes the format of archived batch content. Phase 3 Task 3 tests that assert on archived batch content (e.g., verifying the label format or content structure) may need updating to account for the new metadata header prefix. The implementer should adjust any Phase 3 assertions that check exact content strings.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): add batch metadata format and listing helper`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Implement shouldResummarize and resummarizeBatches

**Files:**
- Modify: `src/compaction/compactor.ts`

**Implementation:**

Add two internal functions:

1. **`shouldResummarize(batchCount, config)`** — Pure function. Returns `true` when `batchCount > config.clipFirst + config.clipLast + buffer` where `buffer` is a reasonable constant (e.g., 2). This means re-summarization triggers when there are more batches than the clip window can show plus a small buffer.

2. **`resummarizeBatches(batches, conversationId)`** — Async function. Takes the list of existing compaction batches (from `getCompactionBatches`), groups the oldest ones (those outside the clip window), re-summarizes them into a single higher-depth batch:
   - Select batches to re-summarize: all batches except the last `config.clipLast` (keep recent ones intact)
   - Actually, re-summarize the batches that would be omitted in the clip-archive — the ones between `clipFirst` and the end minus `clipLast`
   - Concatenate their contents into a single prompt
   - Call summarization model to produce a condensed summary
   - New batch has `depth = max(source depths) + 1`, timestamp range spanning all source batches, message count summed
   - Archive the new batch
   - Delete the source batches from memory via `memory.deleteBlock()`

3. **Update `compress()`** — After the initial summarization pass (Phase 3 logic), call `getCompactionBatches()` to check total batch count. If `shouldResummarize()` returns true, call `resummarizeBatches()`. Then rebuild the clip-archive with the updated batch list.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): add recursive re-summarization`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for batch metadata parsing

**Verifies:** context-compaction.AC2.2 (depth tracking)

**Files:**
- Modify: `src/compaction/compactor.test.ts` (add test suite)

**Testing:**

Test `parseBatchMetadata()`:
- Parses valid metadata header and extracts depth, startTime, endTime, messageCount
- Handles content with no metadata header (returns defaults: depth 0, current time, count 0)
- Handles malformed metadata gracefully

Test `archiveBatch()` output includes the metadata header format.

**Verification:**

```bash
bun test src/compaction/compactor.test.ts
```

Expected: All tests pass.

**Commit:** `test(compaction): add batch metadata parsing tests`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for recursive re-summarization

**Verifies:** context-compaction.AC2.1, context-compaction.AC2.2, context-compaction.AC2.3, context-compaction.AC2.4

**Files:**
- Modify: `src/compaction/compactor.test.ts` (add test suite)

**Testing:**

Create a mock scenario where the compactor already has accumulated batches (mock `memory.list('archival')` to return existing compaction batch blocks).

Tests must verify:

- **context-compaction.AC2.1:** Re-summarization triggers when batch count exceeds `clipFirst + clipLast + buffer`. Test: set clipFirst=2, clipLast=2, create 7 batches → re-summarization triggers. Create 4 batches → no re-summarization.

- **context-compaction.AC2.2:** New batch has `depth = max(source depths) + 1`. Test: re-summarize three depth-0 batches → new batch is depth 1. Re-summarize a depth-0 and a depth-1 → new batch is depth 2.

- **context-compaction.AC2.3:** Source batches are deleted from memory after re-summarization. Verify `memory.deleteBlock()` called with correct IDs. Verify new batch created with `memory.write()`.

- **context-compaction.AC2.4:** Simulate multiple compaction cycles producing progressively higher depths. First round: 10 depth-0 batches → re-summarization produces depth-1. Second round: accumulated depth-0 + depth-1 → re-summarization produces depth-2.

**Verification:**

```bash
bun test src/compaction/compactor.test.ts
```

Expected: All tests pass.

**Commit:** `test(compaction): add recursive re-summarization tests`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
