# Context Compaction Implementation Plan — Phase 3

**Goal:** Implement the core compaction pipeline — split, chunk, summarize, archive, delete old messages, and build the clip-archive view message.

**Architecture:** `createCompactor()` factory function in `src/compaction/compactor.ts` returns a `Compactor` interface. Dependencies injected: `ModelProvider` (for summarization), `MemoryManager` (for archival writes), `PersistenceProvider` (for message deletion), `CompactionConfig` (tuning parameters), and model name. The compactor orchestrates the full pipeline and returns a `CompactionResult` with the compressed history.

**Tech Stack:** TypeScript, PostgreSQL (message deletion), ModelProvider (LLM summarization)

**Scope:** 7 phases from original design (phase 3 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-compaction.AC1: Compaction pipeline compresses conversation history
- **context-compaction.AC1.1 Success:** When token estimate exceeds `context_budget * model_max_tokens`, old messages are compressed into summary batches
- **context-compaction.AC1.2 Success:** Messages are chunked into groups of `chunk_size` before summarization
- **context-compaction.AC1.3 Success:** Each chunk is summarized with the existing summary as context (fold-in pattern)
- **context-compaction.AC1.4 Success:** Summary batches include depth, timestamp range, and original message count
- **context-compaction.AC1.5 Success:** Old messages are deleted from the `messages` table after compression
- **context-compaction.AC1.6 Success:** Last `keep_recent` messages are preserved verbatim
- **context-compaction.AC1.7 Failure:** If summarization model call fails, original history is returned unchanged
- **context-compaction.AC1.8 Edge:** First compaction (no existing summary) produces valid batches with depth 0

### context-compaction.AC3: Clip-archive view presents compressed history
- **context-compaction.AC3.1 Success:** Clip-archive shows first `clip_first` and last `clip_last` summary batches
- **context-compaction.AC3.2 Success:** Omitted batches between first and last are indicated with count and `memory_read` hint
- **context-compaction.AC3.3 Success:** Clip-archive is inserted as a system-role message at the start of compressed history
- **context-compaction.AC3.4 Edge:** When total batches <= `clip_first + clip_last`, all batches are shown (no omission separator)

### context-compaction.AC4: Summary batches are archived for semantic retrieval
- **context-compaction.AC4.1 Success:** Each summary batch is written to archival memory tier
- **context-compaction.AC4.2 Success:** Archived batches are labelled with `compaction-batch-{conversationId}-{timestamp}`
- **context-compaction.AC4.3 Success:** Archived batches are retrievable via `memory_read` semantic search

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Implement createCompactor factory and internal helper functions

**Files:**
- Create: `src/compaction/compactor.ts`
- Modify: `src/compaction/index.ts` (add re-export of `createCompactor`)

**Implementation:**

Create `src/compaction/compactor.ts` with `// pattern: Imperative Shell` annotation (it performs I/O: LLM calls, DB deletes, memory writes).

Define the factory function and its dependencies type:

```typescript
type CreateCompactorOptions = {
  readonly model: ModelProvider;
  readonly memory: MemoryManager;
  readonly persistence: PersistenceProvider;
  readonly config: CompactionConfig;
  readonly modelName: string;
  readonly getPersona: () => Promise<string>;
};
```

The factory `createCompactor(options: CreateCompactorOptions): Compactor` returns an object implementing the `Compactor` interface.

**Internal helper functions** (not exported, defined inside the factory closure or as module-level pure functions):

1. **`splitHistory(history, keepRecent)`** — Pure function. Returns `{ toCompress: ReadonlyArray<ConversationMessage>, toKeep: ReadonlyArray<ConversationMessage> }`. If first message is a prior compaction summary (role='system' and content starts with `[Context Summary`), extract it separately as `priorSummary`.

2. **`chunkMessages(messages, chunkSize)`** — Pure function. Breaks array into groups of `chunkSize`. Last chunk may be smaller.

3. **`formatMessagesForPrompt(messages)`** — Pure function. Converts `ReadonlyArray<ConversationMessage>` to a string: `"role: content\n"` for each message. Used as the `{messages}` placeholder value.

4. **`summarizeChunk(chunk, existingSummary, persona, template)`** — Async. Calls `model.complete()` with the interpolated summarization prompt. Returns the summary text string. Uses `interpolatePrompt` from `prompt.ts`.

   The `ModelRequest` should use:
   - `messages`: single user message containing the interpolated prompt
   - `model`: `modelName` from options
   - `max_tokens`: `config.maxSummaryTokens`
   - `temperature`: `0` (deterministic summarization)
   - No `system` or `tools`

   Extract text from response: `response.content.filter(b => b.type === 'text').map(b => b.text).join('')`

5. **`archiveBatch(batch, conversationId)`** — Async. Calls `memory.write(label, content, 'archival', reason)` with label format `compaction-batch-{conversationId}-{timestamp}` where timestamp is `batch.endTime.toISOString()`.

6. **`buildClipArchive(batches, config, totalMessagesCompressed)`** — Pure function. Returns the clip-archive string content. Format per design:
   - Header: `[Context Summary — N messages compressed across M compaction cycles]`
   - `## Earliest context` section with first `clipFirst` batches
   - Omission separator if applicable: `[... N earlier summaries omitted, searchable via memory_read ...]`
   - `## Recent context` section with last `clipLast` batches
   - Each batch formatted as: `[Batch N — depth D, startTime to endTime]\n{content}`
   - When total batches <= `clipFirst + clipLast`, show all without omission separator

7. **`estimateTokens(text)`** — Pure function. Uses the same heuristic as existing code in `src/agent/context.ts`: `Math.ceil(text.length / 4)`. Import from `@/agent/context` if it's exported, otherwise duplicate the one-liner.

**The `compress()` method** orchestrates the full pipeline:

1. Split history into `toCompress` and `toKeep` using `keepRecent`
2. Extract prior summary if first message is a compaction summary
3. If `toCompress` is empty or has insufficient messages, return original history unchanged (no-op)
4. Chunk `toCompress` into groups of `chunkSize`
5. For each chunk, call `summarizeChunk()` with fold-in pattern (each call gets the previous summary as `existingSummary`)
6. Build `SummaryBatch` objects with depth=0, timestamp range from chunk's first/last `created_at`, and message count
7. Archive each batch via `archiveBatch()`
8. Delete old messages: `DELETE FROM messages WHERE id = ANY($1)` using IDs from `toCompress`
9. Build clip-archive message content via `buildClipArchive()`
10. Insert clip-archive as a system message in persistence: `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'system', $3)`
11. Build the `ConversationMessage` object for the clip-archive
12. Calculate token estimates before/after
13. Return `CompactionResult` with `[clipArchiveMessage, ...toKeep]`

**Error handling:** Wrap the entire pipeline in try/catch. If any step fails (especially the summarization model call), log the error and return the original history unchanged as a `CompactionResult` with zero stats. This satisfies AC1.7.

**Getting persona for prompt:** The compactor needs the agent's persona for the `{persona}` placeholder. Add `getPersona` as a dependency — a function `() => Promise<string>` that reads the `core:persona` memory block. The composition root will provide this (e.g., `async () => { const blocks = await memory.list('core'); return blocks.find(b => b.label === 'core:persona')?.content ?? ''; }`).

**Design refinement note:** `getPersona` is not in the original design's `Compactor` interface. It's injected via the factory function (`CreateCompactorOptions`), not the port interface, which is the correct pattern for this codebase — the `Compactor` port stays clean while the factory receives its dependencies.

Update `src/compaction/index.ts` to re-export `createCompactor` and `CreateCompactorOptions`.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): implement core compaction pipeline`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for pure helper functions (splitHistory, chunkMessages, buildClipArchive, formatMessagesForPrompt)

**Verifies:** context-compaction.AC1.2, context-compaction.AC1.6, context-compaction.AC3.1, context-compaction.AC3.2, context-compaction.AC3.4

**Files:**
- Create: `src/compaction/compactor.test.ts`

**Implementation:**

Export the pure helper functions from `compactor.ts` for testing (or test them indirectly through `compress()`). Since the project convention favors factory-function closures, consider making `splitHistory`, `chunkMessages`, `buildClipArchive`, and `formatMessagesForPrompt` module-level exports (they're pure functions with no closure dependencies).

**Testing:**

Tests must verify:

- **context-compaction.AC1.2:** `chunkMessages` divides messages into groups of `chunkSize`. Test: 10 messages with chunkSize=3 produces 4 chunks (3,3,3,1). Empty input produces empty output. chunkSize larger than message count produces single chunk.

- **context-compaction.AC1.6:** `splitHistory` preserves last `keepRecent` messages in `toKeep`. Test: 10 messages with keepRecent=5 → toCompress has 5, toKeep has 5. If history.length <= keepRecent → toCompress is empty.

- **context-compaction.AC3.1:** `buildClipArchive` shows first `clipFirst` and last `clipLast` batches. Test: 6 batches with clipFirst=2, clipLast=2 → shows batches 1-2 and 5-6.

- **context-compaction.AC3.2:** `buildClipArchive` omission separator includes count and memory_read hint. Test: 6 batches with clipFirst=2, clipLast=2 → separator mentions "2 earlier summaries omitted" and "memory_read".

- **context-compaction.AC3.4:** `buildClipArchive` shows all when total <= clipFirst + clipLast. Test: 3 batches with clipFirst=2, clipLast=2 → all 3 shown, no separator.

- `splitHistory` detects prior compaction summary (role='system', content starts with `[Context Summary`).

- `formatMessagesForPrompt` converts messages to `"role: content\n"` format.

Create `ConversationMessage` test fixtures using a helper function that generates messages with sequential IDs, timestamps, and content.

Follow project testing patterns: `describe`/`it` from `bun:test`, hand-written test data factories.

**Verification:**

```bash
bun test src/compaction/compactor.test.ts
```

Expected: All tests pass.

**Commit:** `test(compaction): add tests for pure compaction helper functions`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for compress() pipeline (mocked dependencies)

**Verifies:** context-compaction.AC1.1, context-compaction.AC1.3, context-compaction.AC1.4, context-compaction.AC1.5, context-compaction.AC1.7, context-compaction.AC1.8, context-compaction.AC4.1, context-compaction.AC4.2

**Files:**
- Modify: `src/compaction/compactor.test.ts` (add test suite)

**Testing:**

Create mock implementations of `ModelProvider`, `MemoryManager`, and `PersistenceProvider` following the project's hand-written mock factory pattern (see `src/agent/agent.test.ts` for reference).

The mock `ModelProvider.complete()` should return configurable text responses. The mock `MemoryManager.write()` should record calls for assertion. The mock `PersistenceProvider.query()` should record SQL calls for assertion.

Tests must verify:

- **context-compaction.AC1.1:** Given history exceeding token budget, `compress()` produces summary batches and returns compressed history shorter than original.

- **context-compaction.AC1.3:** Each chunk's summarization call receives the previous summary as `existingSummary` (fold-in pattern). Verify by checking that the model was called N times for N chunks, and each call's prompt includes the prior summary text.

- **context-compaction.AC1.4:** Returned `SummaryBatch` objects include correct depth (0), timestamp range matching chunk boundaries, and message count.

- **context-compaction.AC1.5:** Old message IDs are passed to `DELETE FROM messages WHERE id = ANY($1)`. Verify the SQL call was made with correct IDs.

- **context-compaction.AC1.7:** When model.complete() throws, compress() returns original history unchanged with zero stats.

- **context-compaction.AC1.8:** First compaction (no prior summary in history) produces valid depth-0 batches. The first summarization call gets empty string as existingSummary.

- **context-compaction.AC4.1:** Each summary batch triggers a `memory.write()` call with tier='archival'.

- **context-compaction.AC4.2:** Archived batch labels follow format `compaction-batch-{conversationId}-{timestamp}`.

**Verification:**

```bash
bun test src/compaction/compactor.test.ts
```

Expected: All tests pass.

**Commit:** `test(compaction): add compress() pipeline tests with mocked dependencies`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
