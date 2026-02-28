# Context Compaction Implementation Plan — Phase 7

**Goal:** End-to-end verification of the compaction pipeline with a real summarization model (ollama) and real PostgreSQL.

**Architecture:** Integration test in `src/integration/` that creates a real compactor with ollama-backed `ModelProvider`, real PostgreSQL persistence, and mock embeddings. Verifies that compaction produces coherent summaries, the clip-archive format is correct, and archived batches are retrievable via semantic search.

**Tech Stack:** TypeScript, Bun test, PostgreSQL, Ollama (openai-compat)

**Scope:** 7 phases from original design (phase 7 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase is an integration test — verifies end-to-end behaviour across all ACs.

**Verifies (integration-level):** context-compaction.AC1.1 through AC1.8, context-compaction.AC3.1 through AC3.4, context-compaction.AC4.1 through AC4.3

---

<!-- START_TASK_1 -->
### Task 1: Create compaction integration test

**Verifies:** context-compaction.AC1.1, context-compaction.AC1.2, context-compaction.AC1.3, context-compaction.AC1.4, context-compaction.AC1.5, context-compaction.AC1.6, context-compaction.AC1.8, context-compaction.AC3.1, context-compaction.AC3.3, context-compaction.AC4.1, context-compaction.AC4.2, context-compaction.AC4.3

**Files:**
- Create: `src/integration/compaction.test.ts`

**Implementation:**

Create `src/integration/compaction.test.ts` following the patterns from `src/integration/e2e.test.ts`.

**Test infrastructure:**
- Connect to PostgreSQL using same connection string as e2e tests: `postgresql://constellation:constellation@localhost:5432/constellation`
- Run migrations in `beforeAll`
- Use `createMockEmbeddingProvider()` from `src/integration/test-helpers.ts` for embeddings
- Create real `MemoryManager` with real PostgreSQL store and mock embeddings
- Cleanup tables in `afterEach` (same TRUNCATE pattern as e2e: messages, memory_blocks, memory_events, pending_mutations)
- Disconnect in `afterAll`

**Ollama model provider:**
- Create via `createOpenAICompatAdapter` with config:
  - `provider: 'openai-compat'`
  - `name: process.env['OLLAMA_MODEL'] ?? 'qwen3:1.7b'` (env-configurable; design used `olmo-3:7b-think` but any small model works for integration tests)
  - `api_key: 'ollama'` (non-empty string; ollama ignores it)
  - `base_url: process.env['OLLAMA_ENDPOINT'] ? process.env['OLLAMA_ENDPOINT'] + '/v1' : 'http://192.168.1.6:11434/v1'`

**Ollama skip pattern** (from `src/embedding/ollama.test.ts`):
- Wrap real ollama calls in try-catch
- If error message includes connection failure keywords, log `"Skipping integration test: Ollama server not available"` and return
- If any other error, rethrow

**Test setup:**
1. Create a `PersistenceProvider` and connect
2. Create a `MemoryManager` with real store + mock embedding
3. Seed some conversation messages (15-20 messages simulating a multi-turn conversation with tool use)
4. Insert messages into the `messages` table directly via persistence.query
5. Create a `Compactor` with:
   - The ollama `ModelProvider`
   - The real `MemoryManager`
   - The real `PersistenceProvider`
   - `CompactionConfig` with small `chunkSize` (5) and `keepRecent` (3) for testability
   - A `getPersona` function that returns a test persona string

**Test cases:**

1. **"compacts conversation history and produces summary batches"**
   - Create 15 messages in the messages table (with conversation_id, role='user'/'assistant' alternating, content with distinct context)
   - Call `compactor.compress(history, conversationId)`
   - Assert: `result.messagesCompressed > 0`
   - Assert: `result.batchesCreated > 0`
   - Assert: `result.tokensEstimateBefore > result.tokensEstimateAfter`
   - Assert: `result.history.length < 15` (compressed)
   - Assert: first message in result.history has role='system' and content includes `[Context Summary`
   - Assert: last messages in result.history are the original `keepRecent` messages (preserved verbatim)

2. **"archives summary batches to archival memory"**
   - After compaction, query archival memory blocks
   - Assert: blocks exist with labels matching `compaction-batch-{conversationId}-*`
   - Assert: each block has non-empty content

3. **"produces coherent summaries"**
   - Create messages with specific, identifiable content (e.g., "User decided to use PostgreSQL", "Agent found a bug in the auth module")
   - After compaction, check that the summary content mentions key decisions/events
   - This is a soft assertion — check that summary is non-empty and longer than a trivial response

4. **"clip-archive format is correct"**
   - After compaction, check the system message at start of history
   - Assert: contains `[Context Summary`
   - Assert: contains section headers (`## Earliest context`, `## Recent context`)
   - Assert: contains batch markers with depth and timestamp info

**Verification:**

```bash
bun test src/integration/compaction.test.ts
```

Expected: Tests pass when both PostgreSQL and Ollama are available. Tests skip gracefully when Ollama is not reachable. Tests fail (not skip) when PostgreSQL is not running (same as other integration tests).

**Commit:** `test(integration): add end-to-end compaction test with ollama`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Full verification — build and all tests

**Files:**
- No new files — operational verification only

**Implementation:**

Run the full build and test suite:

```bash
bun run build
```

Expected: Type-checks pass with no errors.

```bash
bun test
```

Expected: All unit tests pass. Integration tests pass or skip based on service availability (PostgreSQL, Ollama).

Verify the full test count has increased from baseline:
- Baseline: 116 pass, 3 DB-dependent fail
- Expected: 116+ unit pass + new compaction tests pass, same 3 DB-dependent fail (unchanged)

**Commit:** No commit — verification only.

<!-- END_TASK_2 -->
