# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Add tsvector and embedding columns to support hybrid search queries across memory blocks and conversations.

**Architecture:** PostgreSQL migration adding generated tsvector columns with GIN indexes for full-text search, and an embedding column to the messages table for semantic search. Follows existing append-only migration pattern.

**Tech Stack:** PostgreSQL 17, pgvector, tsvector/GIN indexes, GENERATED ALWAYS AS STORED columns

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase is infrastructure only. No acceptance criteria are directly tested — verification is operational (migration runs, build passes).

**Verifies:** None

---

<!-- START_TASK_1 -->
### Task 1: Create migration 007_hybrid_search.sql

**Files:**
- Create: `src/persistence/migrations/007_hybrid_search.sql`

**Step 1: Create the migration file**

Create `src/persistence/migrations/007_hybrid_search.sql` with the following SQL:

```sql
-- Add full-text search infrastructure to memory_blocks and messages tables.
--
-- memory_blocks: add generated tsvector column + GIN index (embedding column already exists)
-- messages: add embedding column + generated tsvector column + GIN index

-- memory_blocks: generated tsvector from content
ALTER TABLE memory_blocks
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX idx_memory_blocks_search_vector
  ON memory_blocks USING GIN (search_vector);

-- messages: embedding column for semantic search (dimensionless, matching memory_blocks pattern)
ALTER TABLE messages
  ADD COLUMN embedding vector;

-- messages: generated tsvector from content
ALTER TABLE messages
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX idx_messages_search_vector
  ON messages USING GIN (search_vector);
```

Key decisions:
- `coalesce(content, '')` prevents NULL propagation in the generated column expression
- `vector` without dimension specifier matches the existing `memory_blocks.embedding` column pattern — dimensions are inferred from the first vector inserted, allowing embedding model flexibility
- GIN indexes on tsvector columns enable efficient full-text search with `@@` operator and `ts_rank()` scoring
- `GENERATED ALWAYS AS ... STORED` keeps `search_vector` in sync with `content` automatically on every INSERT/UPDATE — no application-layer involvement needed

**Step 2: Verify migration runs**

Requires a running PostgreSQL instance (`docker compose up -d`).

Run: `bun run migrate`
Expected: Migration 007_hybrid_search applied successfully (logged output shows migration name)

**Step 3: Verify build passes**

Run: `bun run build`
Expected: `tsc --noEmit` completes with no errors (migration is SQL only, no TypeScript changes)

**Step 4: Commit**

```bash
git add src/persistence/migrations/007_hybrid_search.sql
git commit -m "feat(db): add migration 007 for hybrid search tsvector and message embeddings"
```
<!-- END_TASK_1 -->
