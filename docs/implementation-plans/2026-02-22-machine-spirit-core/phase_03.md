# Machine Spirit Core Implementation Plan - Phase 3: Memory System

**Goal:** Three-tier memory system (Core/Working/Archival) with permission-gated access, semantic search via pgvector, event sourcing, and pending mutations for Familiar-permissioned blocks.

**Architecture:** `MemoryStore` port handles persistence (CRUD, search, events, mutations). `MemoryManager` orchestrates tiers, enforces permissions, manages context window budgets, generates embeddings on write, and queues mutations for Familiar blocks. Both depend only on port interfaces from prior phases.

**Tech Stack:** pg + pgvector for storage and semantic search, EmbeddingProvider from Phase 2, PersistenceProvider from Phase 1, Bun test runner

**Scope:** 8 phases from original design (this is phase 3 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phase 1 provides persistence layer with memory_blocks, memory_events, pending_mutations tables. Phase 2 provides EmbeddingProvider port.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC1: Stateful agent daemon maintains conversation state and three-tier memory
- **machine-spirit-core.AC1.3 Success:** Core memory blocks are always present in the system prompt sent to the model
- **machine-spirit-core.AC1.4 Success:** Working memory blocks load into context and can be swapped in/out by the agent
- **machine-spirit-core.AC1.5 Success:** Archival memory blocks are retrievable via semantic search (pgvector)
- **machine-spirit-core.AC1.6 Success:** Memory writes generate embeddings and persist to Postgres
- **machine-spirit-core.AC1.7 Success:** Every memory mutation is recorded in the event log with old/new content
- **machine-spirit-core.AC1.8 Failure:** Writing to a ReadOnly block returns an error to the agent
- **machine-spirit-core.AC1.9 Success:** Writing to a Familiar block queues a pending mutation instead of applying immediately
- **machine-spirit-core.AC1.10 Success:** Approved Familiar mutations apply the change and notify the agent
- **machine-spirit-core.AC1.11 Success:** Rejected Familiar mutations notify the agent with the familiar's feedback

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Memory types

**Verifies:** None (types only)

**Files:**
- Create: `src/memory/types.ts`

**Implementation:**

Define the memory domain types:

- `MemoryTier`: `'core' | 'working' | 'archival'`
- `MemoryPermission`: `'readonly' | 'familiar' | 'append' | 'readwrite'`
- `MemoryBlock`: `{ id, owner, tier, label, content, embedding (Array<number> | null), permission, pinned, created_at, updated_at }`
- `MemoryEvent`: `{ id, block_id, event_type ('create' | 'update' | 'delete' | 'archive'), old_content (string | null), new_content (string | null), created_at }`
- `PendingMutation`: `{ id, block_id, proposed_content, reason (string | null), status ('pending' | 'approved' | 'rejected'), feedback (string | null), created_at, resolved_at (Date | null) }`
- `MemorySearchResult`: `{ block: MemoryBlock, similarity: number }`
- `MemoryWriteResult`: discriminated union — `{ applied: true, block: MemoryBlock }` or `{ applied: false, mutation: PendingMutation }` (for Familiar blocks) or `{ applied: false, error: string }` (for ReadOnly blocks)

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add memory system types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: MemoryStore port interface

**Verifies:** None (types only)

**Files:**
- Create: `src/memory/store.ts`

**Implementation:**

Define the `MemoryStore` port — the interface for memory persistence. This file contains ONLY the port interface, not any implementation.

```typescript
type MemoryStore = {
  // CRUD
  getBlock(id: string): Promise<MemoryBlock | null>;
  getBlocksByTier(owner: string, tier: MemoryTier): Promise<Array<MemoryBlock>>;
  getBlockByLabel(owner: string, label: string): Promise<MemoryBlock | null>;
  createBlock(block: Omit<MemoryBlock, 'created_at' | 'updated_at'>): Promise<MemoryBlock>;
  updateBlock(id: string, content: string, embedding: Array<number> | null): Promise<MemoryBlock>;
  deleteBlock(id: string): Promise<void>;

  // Semantic search
  searchByEmbedding(
    owner: string,
    embedding: Array<number>,
    limit: number,
    tier?: MemoryTier,
  ): Promise<Array<MemorySearchResult>>;

  // Event sourcing
  logEvent(event: Omit<MemoryEvent, 'id' | 'created_at'>): Promise<MemoryEvent>;
  getEvents(blockId: string): Promise<Array<MemoryEvent>>;

  // Pending mutations
  createMutation(mutation: Omit<PendingMutation, 'id' | 'created_at' | 'resolved_at'>): Promise<PendingMutation>;
  getPendingMutations(owner?: string): Promise<Array<PendingMutation>>;
  resolveMutation(id: string, status: 'approved' | 'rejected', feedback?: string): Promise<PendingMutation>;
};
```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add MemoryStore port interface`
<!-- END_TASK_2 -->

<!-- START_TASK_2B -->
### Task 2B: PostgreSQL MemoryStore implementation

**Verifies:** None (adapter implementation, tested via integration in Task 4)

**Files:**
- Create: `src/memory/postgres-store.ts`

**Implementation:**

Create `createPostgresMemoryStore(persistence: PersistenceProvider): MemoryStore` factory function in a SEPARATE file from the port interface. This implements the MemoryStore port using SQL queries against the tables from Phase 1 migrations.

Key implementation notes:
- `searchByEmbedding` uses pgvector's `<=>` cosine distance operator with `ORDER BY embedding <=> $vector LIMIT $limit`
- Use `pgvector.toSql()` to convert embedding arrays to pgvector format for queries
- `logEvent` and `createMutation` generate IDs using `crypto.randomUUID()` (or a ULID library if added to dependencies)
- All timestamps use `NOW()` in SQL
- Import `MemoryStore` from `./store.ts` (the port) and `PersistenceProvider` from `../persistence/types.ts`

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add PostgreSQL MemoryStore implementation`
<!-- END_TASK_2B -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: MemoryManager implementation

**Verifies:** machine-spirit-core.AC1.3, machine-spirit-core.AC1.4, machine-spirit-core.AC1.6, machine-spirit-core.AC1.7, machine-spirit-core.AC1.8, machine-spirit-core.AC1.9, machine-spirit-core.AC1.10, machine-spirit-core.AC1.11

**Files:**
- Create: `src/memory/manager.ts`

**Implementation:**

Create `createMemoryManager(store: MemoryStore, embedding: EmbeddingProvider, owner: string): MemoryManager`.

The `MemoryManager` type:

```typescript
type MemoryManager = {
  // Context building
  getCoreBlocks(): Promise<Array<MemoryBlock>>;
  getWorkingBlocks(): Promise<Array<MemoryBlock>>;
  buildSystemPrompt(): Promise<string>;

  // Memory operations (permission-enforced)
  read(query: string, limit?: number, tier?: MemoryTier): Promise<Array<MemorySearchResult>>;
  write(label: string, content: string, tier?: MemoryTier, reason?: string): Promise<MemoryWriteResult>;
  list(tier?: MemoryTier): Promise<Array<MemoryBlock>>;

  // Mutation management
  getPendingMutations(): Promise<Array<PendingMutation>>;
  approveMutation(mutationId: string): Promise<MemoryBlock>;
  rejectMutation(mutationId: string, feedback: string): Promise<PendingMutation>;
};
```

Key behaviours:

**Permission enforcement in `write`:**
- `readonly`: Return `{ applied: false, error: 'block is read-only' }`
- `familiar`: Queue a `PendingMutation` via store, return `{ applied: false, mutation }`. Do NOT update the block.
- `append`: Append content to existing block (concatenate with newline separator), generate embedding, persist, log event
- `readwrite`: Update content directly, generate embedding, persist, log event

**For new blocks (label not found):**
- Default tier is `working`, default permission is `readwrite`
- Generate embedding, create block via store, log `create` event

**For existing blocks:**
- Look up by label and owner
- Check permission before modifying
- Log `update` event with old_content and new_content

**`buildSystemPrompt`:**
- Fetches all Core blocks for the owner
- Concatenates them with headers: `## {label}\n{content}`
- This string goes into the system prompt (AC1.3)

**`getCoreBlocks` / `getWorkingBlocks`:**
- Simple delegation to `store.getBlocksByTier`

**`approveMutation`:**
- Load the mutation, verify status is `pending`
- Apply the change to the block (update content + embedding)
- Mark mutation as `approved` with `resolved_at = NOW()`
- Log `update` event
- Return the updated block

**`rejectMutation`:**
- Load the mutation, verify status is `pending`
- Mark as `rejected` with feedback and `resolved_at = NOW()`
- Return the mutation (agent can read the feedback)

**Embedding generation:**
- Every `write` that actually modifies content calls `embedding.embed(content)` before persisting
- If embedding provider fails, store with `null` embedding and log a warning (graceful degradation per design's error handling)
- Wrap the `embedding.embed()` call in a try/catch — on error, set `embedding = null` and continue with the write

**Known gaps — embedding resilience:**
- Blocks stored with `null` embeddings will not appear in semantic search results. A future slice could add a background job to re-embed blocks with null embeddings when the provider recovers.
- When no embeddings are available, the system has no keyword fallback search. This is acceptable for the initial implementation since semantic search is the primary retrieval mechanism for archival memory.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add MemoryManager with permission enforcement`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Memory system tests

**Verifies:** machine-spirit-core.AC1.3, machine-spirit-core.AC1.4, machine-spirit-core.AC1.5, machine-spirit-core.AC1.6, machine-spirit-core.AC1.7, machine-spirit-core.AC1.8, machine-spirit-core.AC1.9, machine-spirit-core.AC1.10, machine-spirit-core.AC1.11

**Files:**
- Test: `src/memory/manager.test.ts` (integration — requires Postgres)

**Testing:**

These are integration tests against a real PostgreSQL instance (Docker). The test setup should:
- Connect to the test database (use a separate database or schema to avoid polluting development data)
- Run migrations
- Create a `MemoryStore` backed by real Postgres
- Create a mock `EmbeddingProvider` that returns deterministic vectors (e.g., hash-based or fixed vectors)
- Clean up between tests (truncate tables)

Tests must verify each AC listed above:

- **machine-spirit-core.AC1.3:** Create core blocks, call `buildSystemPrompt()`, verify all core blocks appear in the returned string with their labels and content
- **machine-spirit-core.AC1.4:** Create working blocks, call `getWorkingBlocks()`, verify they're returned. Write a new working block, verify it appears. Delete/archive a working block, verify it's removed from the list.
- **machine-spirit-core.AC1.5:** Create archival blocks with embeddings, call `read()` with a query, verify results are returned ordered by similarity. Verify core/working blocks are NOT returned when tier is filtered to archival.
- **machine-spirit-core.AC1.6:** Call `write()` with new content, verify the block is persisted with a non-null embedding. Verify the mock embedding provider was called.
- **machine-spirit-core.AC1.7:** Call `write()` to create and then update a block. Query `getEvents()` for that block. Verify events include `create` and `update` with correct old_content and new_content.
- **machine-spirit-core.AC1.8:** Create a block with `readonly` permission. Call `write()` targeting that label. Verify the result is `{ applied: false, error: ... }` containing "read-only". Verify the block content is unchanged.
- **machine-spirit-core.AC1.9:** Create a block with `familiar` permission. Call `write()` targeting that label. Verify the result is `{ applied: false, mutation: ... }`. Verify the block content is unchanged. Verify a pending mutation exists in the store.
- **machine-spirit-core.AC1.10:** After AC1.9 creates a pending mutation, call `approveMutation()`. Verify the block content is updated to the proposed content. Verify the mutation status is `approved`.
- **machine-spirit-core.AC1.11:** Create another `familiar` block, write to it (creating a pending mutation), then call `rejectMutation()` with feedback. Verify the block content is unchanged. Verify the mutation status is `rejected` with the feedback string.
- **Embedding failure graceful degradation:** Create a MemoryManager with a mock EmbeddingProvider that throws on `embed()`. Call `write()` with new content. Verify the block is created successfully with `null` embedding. Verify the block is NOT returned by `read()` (semantic search skips null-embedding blocks).

**Verification:**
Run: `docker compose up -d && bun test src/memory/manager.test.ts`
Expected: All tests pass

**Commit:** `test: add memory system integration tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
