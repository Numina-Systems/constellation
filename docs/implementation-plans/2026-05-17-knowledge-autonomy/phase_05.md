# Knowledge Autonomy Implementation Plan — Phase 5: Vector Index Migration

**Goal:** HNSW index on memory block embeddings for efficient similarity search

**Architecture:** Single SQL migration adding an HNSW index using pgvector's `vector_cosine_ops` operator class. Accelerates all existing cosine distance queries (`<=>` operator) in memory search, skill search, and conversation search domains.

**Tech Stack:** PostgreSQL 17, pgvector 0.7+ (HNSW support)

**Scope:** 7 phases from original design (phase 5 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements:

### knowledge-autonomy.AC4: Archivist
- **knowledge-autonomy.AC4.7 Success:** HNSW vector index improves similarity search performance

---

<!-- START_TASK_1 -->
### Task 1: HNSW index migration

**Files:**
- Create: `src/persistence/migrations/013_hnsw_vector_index.sql`

**Implementation:**

```sql
-- HNSW vector index for efficient cosine similarity search on memory block embeddings.
-- Requires pgvector >= 0.5.0 (project uses pgvector/pgvector:pg17 which ships 0.7+).
--
-- The embedding column has no explicit dimension constraint (001_initial_schema.sql comment:
-- "pgvector will infer dimension from the first vector written"). HNSW indexes on
-- untyped vector columns work in pgvector 0.7+ — the index inherits the dimension
-- from existing data.
--
-- If no embeddings exist yet, the index is created empty and populates as vectors
-- are inserted. If the embedding model changes (different dimensions), existing
-- vectors and this index must be rebuilt.

CREATE INDEX IF NOT EXISTS idx_memory_blocks_embedding_hnsw
    ON memory_blocks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Also index skill_embeddings for skill retrieval performance
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_embedding_hnsw
    ON skill_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

Design notes:
- `vector_cosine_ops` matches the `<=>` (cosine distance) operator used across the codebase: `src/memory/postgres-store.ts:269`, `src/skill/postgres-store.ts:53`, `src/search/domains/memory.ts:106,181`, `src/search/domains/conversations.ts:101,174`
- `m = 16` and `ef_construction = 64` are pgvector defaults — good balance of build time vs query quality for moderate dataset sizes
- `IF NOT EXISTS` for idempotency (matches existing migration conventions)
- The `messages` table also has an `embedding` column (added in 007_hybrid_search.sql), but conversation search is less performance-critical than memory/skill search. Add an index for it only if query performance becomes a concern.
- No code changes needed — existing queries already use `<=>` which the planner routes through the HNSW index automatically

**Verification:**

Run: `bun run migrate`
Expected: Migration applies without errors

Run: `bun run build`
Expected: Type-check passes (no code changes)

Run: `bun test`
Expected: All tests still pass (no code changes)

**Commit:** `feat(persistence): add HNSW vector indexes for memory and skill embeddings`

<!-- END_TASK_1 -->
