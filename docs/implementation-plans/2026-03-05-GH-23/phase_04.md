# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Implement hybrid search for the `memory_blocks` table as a pluggable SearchDomain.

**Architecture:** Factory function `createMemorySearchDomain()` accepting `PersistenceProvider`, implementing the `SearchDomain` interface from Phase 2. Runs keyword and/or vector searches as SQL CTEs within a single query, following the existing `postgres-store.ts` patterns for vector handling and result mapping.

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, pgvector, tsvector, bun:test

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH-23.AC1: Search tool provides correct results across modes and domains
- **GH-23.AC1.1 Success:** Hybrid mode returns results combining keyword matches and semantic similarity
- **GH-23.AC1.2 Success:** Keyword mode returns results matching exact terms without generating embeddings
- **GH-23.AC1.3 Success:** Semantic mode returns results by vector similarity without running tsquery
- **GH-23.AC1.4 Success:** Memory domain search respects tier filter (core/working/archival)

### GH-23.AC4: Time filtering works across all domains
- **GH-23.AC4.1 Success:** Start time filter excludes results created before the specified time
- **GH-23.AC4.2 Success:** End time filter excludes results created after the specified time

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement memory search domain

**Files:**
- Create: `src/search/domains/memory.ts`

**Implementation:**

Create `src/search/domains/memory.ts` with `// pattern: Imperative Shell` annotation.

Export a factory function `createMemorySearchDomain(persistence: PersistenceProvider): SearchDomain` that returns an object implementing the `SearchDomain` interface with `name: 'memory'`.

The `search()` method builds SQL dynamically based on the search `mode`:

**For `mode: 'hybrid'`** — run both keyword and vector CTEs in a single query:

```sql
WITH keyword_results AS (
  SELECT id, content, tier, label, created_at,
         ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
  FROM memory_blocks
  WHERE search_vector @@ plainto_tsquery('english', $1)
    AND owner = $2
    [AND tier = $N]
    [AND created_at >= $N]
    [AND created_at <= $N]
  ORDER BY score DESC
  LIMIT $N
),
vector_results AS (
  SELECT id, content, tier, label, created_at,
         (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
  FROM memory_blocks
  WHERE embedding IS NOT NULL
    AND owner = $2
    [AND tier = $N]
    [AND created_at >= $N]
    [AND created_at <= $N]
  ORDER BY score DESC
  LIMIT $N
)
SELECT * FROM keyword_results
UNION ALL
SELECT * FROM vector_results
```

**For `mode: 'keyword'`** — only the keyword CTE (no embedding needed):

```sql
SELECT id, content, tier, label, created_at,
       ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
FROM memory_blocks
WHERE search_vector @@ plainto_tsquery('english', $1)
  AND owner = $2
  [AND tier = $N]
  [AND created_at >= $N]
  [AND created_at <= $N]
ORDER BY score DESC
LIMIT $N
```

**For `mode: 'semantic'`** — only the vector CTE (no tsquery):

```sql
SELECT id, content, tier, label, created_at,
       (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
FROM memory_blocks
WHERE embedding IS NOT NULL
  AND owner = $2
  [AND tier = $N]
  [AND created_at >= $N]
  [AND created_at <= $N]
ORDER BY score DESC
LIMIT $N
```

Key implementation details:
- Import `toSql` from `pgvector/utils` — same pattern as `src/memory/postgres-store.ts:8`
- Vector embedding is inlined in SQL with `::vector` cast (not a bind parameter) — same pattern as existing `searchByEmbedding()`
- Build parameters array dynamically as filters are added, tracking `$N` position
- `owner` filter is required — memory blocks are always scoped to an owner. The `DomainSearchParams` doesn't have an `owner` field currently, so the factory should accept `owner: string` as a second parameter: `createMemorySearchDomain(persistence, owner)`
- Map SQL rows to `DomainSearchResult` with `domain: 'memory'` and `metadata: { tier, label, role: null, conversationId: null }`
- `created_at` string → `Date` conversion in result mapping

Also update barrel exports: add `export { createMemorySearchDomain } from './domains/memory.ts'` to `src/search/index.ts`.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(search): implement memory search domain with hybrid query modes`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Memory search domain integration tests

**Verifies:** GH-23.AC1.1, GH-23.AC1.2, GH-23.AC1.3, GH-23.AC1.4, GH-23.AC4.1, GH-23.AC4.2

**Files:**
- Create: `src/search/domains/memory.test.ts` (integration)

**Testing:**

Create `src/search/domains/memory.test.ts` with `// pattern: Imperative Shell` annotation.

Follow existing integration test patterns from `src/memory/manager.test.ts` and `src/skill/postgres-store.test.ts`:
- Hardcoded DB connection: `postgresql://constellation:constellation@localhost:5432/constellation`
- `beforeAll`: connect, run migrations, clean up
- `afterEach`: truncate `memory_blocks` table
- `afterAll`: disconnect
- Use random owner string for test isolation

Insert test data: memory blocks with known content, embeddings (use deterministic seeded embedding generator from `src/integration/test-helpers.ts`), and specific tiers and timestamps.

Tests must verify each AC listed above:
- **GH-23.AC1.1:** Insert blocks with embeddings and keyword-rich content. Search in hybrid mode. Verify results include matches from both keyword and vector search (a block matching the query text AND having a similar embedding should appear).
- **GH-23.AC1.2:** Search in keyword mode. Verify results match text content. Verify no embedding is needed in the params (embedding: null).
- **GH-23.AC1.3:** Search in semantic mode with an embedding. Verify results are sorted by vector similarity. Verify blocks without the query text but with similar embeddings still appear.
- **GH-23.AC1.4:** Insert blocks across core/working/archival tiers. Search with tier filter set. Verify only blocks matching the specified tier are returned.
- **GH-23.AC4.1:** Insert blocks with different `created_at` timestamps. Search with `startTime` set. Verify blocks created before `startTime` are excluded.
- **GH-23.AC4.2:** Search with `endTime` set. Verify blocks created after `endTime` are excluded.

**Verification:**

Run: `bun test src/search/domains/memory.test.ts`
Expected: All tests pass (requires running PostgreSQL)

**Commit:** `test(search): add memory search domain integration tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
