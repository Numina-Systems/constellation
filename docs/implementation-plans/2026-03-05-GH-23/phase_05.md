# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Implement hybrid search for the `messages` table as a pluggable SearchDomain.

**Architecture:** Factory function `createConversationSearchDomain()` accepting `PersistenceProvider`, implementing the `SearchDomain` interface. Mirrors the memory search domain pattern (Phase 4) but queries the `messages` table with role filtering instead of tier filtering. Messages are not owner-scoped (unlike memory blocks) — they're scoped by `conversation_id`, but the search domain searches across all conversations.

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
- **GH-23.AC1.5 Success:** Conversation domain search respects role filter (user/assistant/system/tool)

### GH-23.AC4: Time filtering works across all domains
- **GH-23.AC4.1 Success:** Start time filter excludes results created before the specified time
- **GH-23.AC4.3 Success:** Combined start + end time creates a bounded time window

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement conversation search domain

**Files:**
- Create: `src/search/domains/conversations.ts`

**Implementation:**

Create `src/search/domains/conversations.ts` with `// pattern: Imperative Shell` annotation.

Export a factory function `createConversationSearchDomain(persistence: PersistenceProvider): SearchDomain` that returns an object implementing `SearchDomain` with `name: 'conversations'`.

The `search()` method builds SQL dynamically based on the search `mode`, following the same CTE pattern as the memory search domain:

**For `mode: 'hybrid'`** — run both keyword and vector CTEs:

```sql
WITH keyword_results AS (
  SELECT id, conversation_id, role, content, created_at,
         ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
  FROM messages
  WHERE search_vector @@ plainto_tsquery('english', $1)
    [AND role = $N]
    [AND created_at >= $N]
    [AND created_at <= $N]
  ORDER BY score DESC
  LIMIT $N
),
vector_results AS (
  SELECT id, conversation_id, role, content, created_at,
         (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
  FROM messages
  WHERE embedding IS NOT NULL
    [AND role = $N]
    [AND created_at >= $N]
    [AND created_at <= $N]
  ORDER BY score DESC
  LIMIT $N
)
SELECT * FROM keyword_results
UNION ALL
SELECT * FROM vector_results
```

**For `mode: 'keyword'`** and **`mode: 'semantic'`** — same single-CTE pattern as memory domain.

Key differences from memory domain:
- Messages table has no `owner` column — no owner filtering needed
- Role filter (`AND role = $N`) replaces tier filter
- Result metadata includes `conversationId` and `role` instead of `tier` and `label`
- Map results to `DomainSearchResult` with `domain: 'conversations'` and `metadata: { tier: null, label: null, role, conversationId }`

Import `toSql` from `pgvector/utils` for vector serialization — same pattern as memory domain.

Also update barrel exports: add `export { createConversationSearchDomain } from './domains/conversations.ts'` to `src/search/index.ts`.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(search): implement conversation search domain with hybrid query modes`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Conversation search domain integration tests

**Verifies:** GH-23.AC1.1, GH-23.AC1.2, GH-23.AC1.3, GH-23.AC1.5, GH-23.AC4.1, GH-23.AC4.3

**Files:**
- Create: `src/search/domains/conversations.test.ts` (integration)

**Testing:**

Create `src/search/domains/conversations.test.ts` with `// pattern: Imperative Shell` annotation.

Follow existing integration test patterns:
- Hardcoded DB connection: `postgresql://constellation:constellation@localhost:5432/constellation`
- `beforeAll`: connect, run migrations, clean up
- `afterEach`: truncate `messages` table
- `afterAll`: disconnect

Insert test messages directly via SQL (not through `persistMessage()`) with known content, embeddings, roles, and timestamps. Use the deterministic seeded embedding generator pattern from `src/integration/test-helpers.ts`.

Note: since Phase 7 adds embedding generation at insert time, but Phase 5 precedes Phase 7, test data must be inserted with explicit embedding values via SQL INSERT (including the `embedding` column added by migration 007).

Tests must verify each AC listed above:
- **GH-23.AC1.1:** Insert messages with embeddings and keyword-rich content. Search in hybrid mode. Verify results include matches from both keyword and vector search.
- **GH-23.AC1.2:** Search in keyword mode with `embedding: null`. Verify results match text content without requiring embeddings.
- **GH-23.AC1.3:** Search in semantic mode with an embedding vector. Verify results sorted by vector similarity.
- **GH-23.AC1.5:** Insert messages with different roles (user/assistant/system/tool). Search with role filter set. Verify only messages matching the specified role are returned.
- **GH-23.AC4.1:** Insert messages with different `created_at` timestamps. Search with `startTime` set. Verify messages before `startTime` are excluded.
- **GH-23.AC4.3:** Search with both `startTime` and `endTime` set. Verify only messages within the bounded time window are returned.

**Verification:**

Run: `bun test src/search/domains/conversations.test.ts`
Expected: All tests pass (requires running PostgreSQL)

**Commit:** `test(search): add conversation search domain integration tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
