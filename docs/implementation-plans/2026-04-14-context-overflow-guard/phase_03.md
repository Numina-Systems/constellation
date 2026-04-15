# Context Overflow Guard Implementation Plan — Phase 3

**Goal:** Make compaction summarisation resilient to timeouts with retries and progressively smaller chunks.

**Architecture:** A retry loop wraps `summarizeChunk` in the compactor. On timeout, chunk size is halved and the attempt retried with exponential backoff. The loop is separate from `callWithRetry` in `src/model/retry.ts` because it restructures input (halves chunk size) between attempts. `CompactionConfig` gains `timeout` and `maxRetries` fields; `timeout` flows through to `ModelRequest.timeout` on summarisation calls.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-overflow-guard.AC2: Compaction retries with chunk reduction
- **context-overflow-guard.AC2.1 Success:** Compaction retries on timeout error with exponential backoff
- **context-overflow-guard.AC2.2 Success:** Chunk size is halved on each retry attempt
- **context-overflow-guard.AC2.3 Success:** Chunk size never goes below a minimum floor (2 messages)
- **context-overflow-guard.AC2.4 Failure:** Non-retryable errors (auth, 400) fail immediately without retry
- **context-overflow-guard.AC2.5 Success:** Compaction timeout is passed through to `ModelRequest.timeout` on summarisation calls
- **context-overflow-guard.AC2.6 Edge:** Retry exhaustion returns original history unchanged (existing graceful degradation preserved)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `timeout` and `maxRetries` to `CompactionConfig` and config schema

**Verifies:** None (type/config-only change)

**Files:**
- Modify: `src/compaction/types.ts:51-59`
- Modify: `src/config/schema.ts:113-114`

**Implementation:**

In `src/compaction/types.ts:51-59`, add two new fields to `CompactionConfig`:

```typescript
export type CompactionConfig = {
  readonly chunkSize: number;
  readonly keepRecent: number;
  readonly maxSummaryTokens: number;
  readonly clipFirst: number;
  readonly clipLast: number;
  readonly prompt: string | null;
  readonly scoring?: ImportanceScoringConfig;
  readonly timeout?: number;
  readonly maxRetries?: number;
};
```

In `src/config/schema.ts`, add two fields to `SummarizationConfigSchema` after `content_length_weight` (around line 113):

```typescript
content_length_weight: z.number().nonnegative().default(1.0),
compaction_timeout: z.number().int().positive().default(120000),
compaction_max_retries: z.number().int().nonnegative().default(2),
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes.

**Commit:** `feat(compaction): add timeout and maxRetries to CompactionConfig`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Thread timeout through to summarisation `ModelRequest`

**Verifies:** context-overflow-guard.AC2.5

**Files:**
- Modify: `src/compaction/compactor.ts:529-548` (summarizeChunk function)

**Implementation:**

In `summarizeChunk` at `src/compaction/compactor.ts:529-548`, the function builds a `ModelRequest` via `buildSummarizationRequest` and calls `model.complete(request)`. Thread the config timeout onto the request:

```typescript
async function summarizeChunk(
  chunk: ReadonlyArray<ConversationMessage>,
  existingSummary: string,
  systemPrompt: string | null,
): Promise<string> {
  const request = buildSummarizationRequest({
    systemPrompt,
    previousSummary: existingSummary || null,
    messages: chunk,
    modelName,
    maxTokens: config.maxSummaryTokens,
  });

  const requestWithTimeout: ModelRequest = config.timeout != null
    ? { ...request, timeout: config.timeout }
    : request;

  const response = await model.complete(requestWithTimeout);
  const summary = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return summary;
}
```

Import `ModelRequest` type from `../model/types.js` if not already imported.

**Testing:**

AC2.5: Test that when `config.timeout` is set, the `ModelRequest` passed to `model.complete()` includes `timeout`. Use a mock `ModelProvider` that captures the request. Tests live in `src/compaction/compactor.test.ts` (created in Task 3 — this test can be written there alongside the retry tests).

**Verification:**

Run: `bun run build`
Expected: Type-check passes.

**Commit:** `feat(compaction): thread timeout to summarisation ModelRequest`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Add retry loop with chunk-size halving to `compress`

**Verifies:** context-overflow-guard.AC2.1, context-overflow-guard.AC2.2, context-overflow-guard.AC2.3, context-overflow-guard.AC2.4, context-overflow-guard.AC2.6

**Files:**
- Modify: `src/compaction/compactor.ts:600-627` (chunk summarisation loop)
- Test: `src/compaction/compactor.test.ts` (unit — new file)

**Implementation:**

Replace the simple `for (const chunk of chunks)` loop at `src/compaction/compactor.ts:606-627` with a retry-aware loop. The retry logic wraps each individual chunk's summarisation call, not the entire pipeline.

**Two-layer retry interaction:** Each model adapter already wraps its SDK call in `callWithRetry` (3 retries, exponential backoff at the same chunk size). This handles transient network blips. The compaction retry loop here is a *structural* retry — it catches the timeout that escapes `callWithRetry` (after its 3 attempts exhaust) and retries with a smaller chunk. The two layers are complementary:
- **Model-level retry** (`callWithRetry`): same request, same chunk, handles transient failures
- **Compaction-level retry** (`summarizeChunkWithRetry`): smaller chunk, handles structural overload where the chunk is too large for the model's processing time

This means a timeout on a large chunk will first try 3 times at the same size (model-level), then halve and try again (compaction-level). This is intentional — transient timeouts should be retried before restructuring.

Extract a helper function `summarizeChunkWithRetry` inside `createCompactor`:

```typescript
const MIN_CHUNK_SIZE = 2;
const INITIAL_BACKOFF_MS = 1000;

async function summarizeChunkWithRetry(
  messages: ReadonlyArray<ConversationMessage>,
  existingSummary: string,
  systemPrompt: string | null,
  currentChunkSize: number,
): Promise<string> {
  const maxRetries = config.maxRetries ?? 2;
  let chunkSize = currentChunkSize;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Re-chunk with current size if we've reduced it
      const subChunks = attempt === 0
        ? [messages]
        : chunkMessages(messages, chunkSize);

      let summary = existingSummary;
      for (const subChunk of subChunks) {
        summary = await summarizeChunk(subChunk, summary, systemPrompt);
      }
      return summary;
    } catch (error) {
      lastError = error;

      // Non-retryable errors fail immediately
      if (error instanceof ModelError && !error.retryable) {
        throw error;
      }

      // Only retry on timeout specifically
      if (!(error instanceof ModelError && error.code === 'timeout')) {
        throw error;
      }

      // Halve chunk size, respect floor
      chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));

      // Exponential backoff (skip on last attempt)
      if (attempt < maxRetries) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}
```

Then in the main loop (line 606), replace `summarizeChunk` with `summarizeChunkWithRetry`:

```typescript
for (const chunk of chunks) {
  const summaryText = await summarizeChunkWithRetry(
    chunk,
    accumulatedSummary,
    systemPrompt,
    config.chunkSize,
  );
  accumulatedSummary = summaryText;
  // ... rest of batch creation unchanged ...
}
```

Import `ModelError` from `../model/types.js`.

The existing catch block at lines 705-719 already handles pipeline-level failures by returning original history — this provides AC2.6 (retry exhaustion falls through to the outer catch).

**Testing:**

Tests must verify each AC:
- context-overflow-guard.AC2.1: Mock model that throws `ModelError('timeout', true)` on first call, succeeds on second. Verify retry happened with backoff delay.
- context-overflow-guard.AC2.2: Mock model that throws timeout twice. Verify the second retry uses halved chunk size (check via captured request content length or mock that inspects message count).
- context-overflow-guard.AC2.3: Set initial chunk size to 3, mock that always times out. Verify chunk size floors at 2 and doesn't go below.
- context-overflow-guard.AC2.4: Mock model that throws `ModelError('auth', false)`. Verify single call, no retry.
- context-overflow-guard.AC2.6: Mock model that always throws timeout, exhaust retries. Verify `compress` returns original history unchanged (outer catch handles it).

Create `src/compaction/compactor.test.ts`. Use a mock `ModelProvider` object with a `complete` method that can be configured to throw or return controlled responses. Follow project patterns: `describe`/`it` from `bun:test`, no external mocking library.

The compactor also requires `MemoryManager` and `PersistenceProvider` — create minimal mock implementations that satisfy the interface for the test (write operations can be no-ops, read operations return empty results).

**Verification:**

Run: `bun test src/compaction/compactor.test.ts`
Expected: All tests pass.

**Commit:** `feat(compaction): add retry loop with chunk-size halving on timeout`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify full test suite

**Verifies:** No regression from compaction changes.

**Files:** None (verification only)

**Verification:**

Run: `bun test`
Expected: All non-DB tests pass. No regressions.

Run: `bun run build`
Expected: Type-check passes.

**Commit:** No commit needed — verification step.

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
