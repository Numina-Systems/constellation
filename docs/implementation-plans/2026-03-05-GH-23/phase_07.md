# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Generate embeddings for messages at insert time, following the MemoryManager pattern with graceful null fallback on failure.

**Architecture:** Add optional `EmbeddingProvider` to agent dependency bag. Modify `persistMessage()` to generate embeddings for user/assistant messages and include them in the INSERT query. System and tool messages get null embeddings. Embedding failures don't block message persistence.

**Tech Stack:** TypeScript 5.7+, pgvector, bun:test

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH-23.AC3: Message embeddings are generated and backfilled
- **GH-23.AC3.1 Success:** New user messages are persisted with embeddings
- **GH-23.AC3.2 Success:** New assistant messages are persisted with embeddings
- **GH-23.AC3.3 Failure:** Embedding provider failure does not block message persistence (null embedding stored)
- **GH-23.AC3.5 Edge:** System and tool role messages are stored with null embeddings (not embedded)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add EmbeddingProvider to agent dependency bag

**Files:**
- Modify: `src/agent/types.ts:48-61` (AgentDependencies type)

**Implementation:**

Add `embedding?: EmbeddingProvider` to the `AgentDependencies` type in `src/agent/types.ts`. It should be optional (the agent can function without it — embeddings just won't be generated for messages).

Add the import for `EmbeddingProvider` from `@/embedding`.

**Verification:**

Run: `bun run build`
Expected: No errors (optional field, no existing code breaks)

**Commit:** `feat(agent): add optional EmbeddingProvider to agent dependency bag`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Modify persistMessage() to generate and store embeddings

**Files:**
- Modify: `src/agent/agent.ts:308-328` (persistMessage function)

**Implementation:**

Inside the `createAgent()` closure in `src/agent/agent.ts`, add a helper function following the exact pattern from `src/memory/manager.ts:65-75`:

```typescript
async function generateMessageEmbedding(text: string): Promise<Array<number> | null> {
  if (!deps.embedding) return null;
  try {
    return await deps.embedding.embed(text);
  } catch (error) {
    console.warn('embedding provider failed for message, storing with null embedding', error);
    return null;
  }
}
```

Modify `persistMessage()`:

1. Add embedding generation based on role — before the INSERT query:
   - If role is `'user'` or `'assistant'`: call `await generateMessageEmbedding(msg.content)` to get the embedding
   - If role is `'system'` or `'tool'`: set embedding to null (these don't embed well per design)

2. Update the INSERT query to include the `embedding` column:
   ```sql
   INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at)
   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
   RETURNING id
   ```

3. Add the embedding value to the params array. Use `toSql(embedding)` from `pgvector/utils` when the embedding is non-null, or `null` when it is null. The embedding parameter is a bind parameter as a string (matching the existing pattern where vector values are inlined). Alternatively, since `persistMessage` uses parameterized queries (not inline SQL like `searchByEmbedding`), the embedding can be passed as a formatted vector string: `embedding ? toSql(embedding) : null`.

Import `toSql` from `pgvector/utils` at the top of agent.ts.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(agent): generate embeddings for user/assistant messages at insert time`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Message embedding tests

**Verifies:** GH-23.AC3.1, GH-23.AC3.2, GH-23.AC3.3, GH-23.AC3.5

**Files:**
- Modify: `src/agent/agent.test.ts` (add new describe block)

**Testing:**

Add a new describe block to the existing `src/agent/agent.test.ts`.

The existing tests use a `createMockPersistenceProvider()` that intercepts SQL queries. Extend it or create a new test setup that:
- Provides a mock `EmbeddingProvider` (using `createMockEmbeddingProvider()` pattern from `src/integration/test-helpers.ts`)
- Captures the parameters passed to INSERT INTO messages queries so tests can assert on the embedding value

Tests must verify each AC listed above:
- **GH-23.AC3.1:** Send a user message. Verify the INSERT params include a non-null embedding value.
- **GH-23.AC3.2:** Process a response. Verify the assistant message INSERT includes a non-null embedding.
- **GH-23.AC3.3:** Provide a mock EmbeddingProvider that throws. Send a message. Verify the INSERT still happens (message persisted) with null embedding. Verify no exception propagates.
- **GH-23.AC3.5:** Verify tool role messages are inserted with null embedding (not embedded). System messages similarly get null.

**Verification:**

Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(agent): add message embedding generation tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Wire EmbeddingProvider to agent at composition root

**Files:**
- Modify: `src/index.ts:718-738` (main agent createAgent call)
- Modify: `src/index.ts:747-766` (bluesky agent createAgent call)

**Implementation:**

The `embedding` variable already exists in `src/index.ts` (created around line 450 as `const embedding = createEmbeddingProvider(config.embedding)`). Add `embedding,` to both `createAgent()` call sites:

1. Main REPL agent call at line ~718
2. Bluesky agent call at line ~747

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat: wire EmbeddingProvider to agent instances at composition root`

<!-- END_TASK_4 -->
