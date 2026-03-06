# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Wire up SearchStore with domain fan-out and RRF merge, and create the agent-facing search tool.

**Architecture:** `createSearchStore()` factory accepting `EmbeddingProvider`, managing registered `SearchDomain` instances. Fan-out to domains via `Promise.all()`, merge via RRF. Search tool follows builtin tool patterns: factory function returning `Array<Tool>`, dependencies injected via closure.

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, pgvector, bun:test

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
- **GH-23.AC1.5 Success:** Conversation domain search respects role filter (user/assistant/system/tool)
- **GH-23.AC1.6 Failure:** Query with no matches returns empty results, not an error
- **GH-23.AC1.7 Failure:** Invalid mode/domain/role/tier values are rejected with clear error message
- **GH-23.AC1.8 Edge:** Limit is clamped to 1-50 range regardless of input

### GH-23.AC2: RRF fusion produces correctly ranked unified results
- **GH-23.AC2.1 Success:** Results appearing in both keyword and vector results rank higher than results in only one
- **GH-23.AC2.2 Success:** Results from different domains are interleaved by RRF score, not grouped by domain
- **GH-23.AC2.3 Edge:** Results appearing in only one search mode still appear in output with appropriate lower score

### GH-23.AC4: Time filtering works across all domains
- **GH-23.AC4.1 Success:** Start time filter excludes results created before the specified time
- **GH-23.AC4.2 Success:** End time filter excludes results created after the specified time
- **GH-23.AC4.3 Success:** Combined start + end time creates a bounded time window
- **GH-23.AC4.4 Edge:** Omitting time filters returns results regardless of creation time

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement SearchStore with domain fan-out and RRF merge

**Files:**
- Create: `src/search/postgres-store.ts`

**Implementation:**

Create `src/search/postgres-store.ts` with `// pattern: Imperative Shell` annotation.

Export a factory function:

```typescript
export function createSearchStore(embeddingProvider: EmbeddingProvider): SearchStore
```

The returned object implements `SearchStore`:

**`registerDomain(domain: SearchDomain)`:**
- Store domain in internal `Map<SearchDomainName, SearchDomain>`
- Reject duplicate domain names

**`search(params: SearchParams)`:**

1. **Generate embedding if needed:** If `mode` is `'semantic'` or `'hybrid'`, call `embeddingProvider.embed(params.query)` to get the query embedding. If `mode` is `'keyword'`, skip embedding generation (set to null). Wrap embedding generation in try/catch — if it fails, fall back to keyword-only mode (log warning, proceed without embedding).

2. **Resolve target domains:** Use `params.domains` to select which registered domains to query. If a requested domain isn't registered, skip it (don't error).

3. **Fan-out to domains:** Call `Promise.all()` on target domains' `search()` methods, passing the `DomainSearchParams` (which includes the generated embedding or null).

4. **Merge with RRF:** Pass all domain result arrays to `mergeWithRRF()` from `src/search/rrf.ts`. This produces a unified, ranked list.

5. **Apply limit:** Slice the merged results to `params.limit`.

6. **Return results.**

Also update barrel exports in `src/search/index.ts`: add `export { createSearchStore } from './postgres-store.ts'`.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(search): implement SearchStore with domain fan-out and RRF merge`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: SearchStore unit tests

**Verifies:** GH-23.AC1.6, GH-23.AC2.1, GH-23.AC2.2, GH-23.AC4.4

**Files:**
- Create: `src/search/postgres-store.test.ts` (unit — uses mock domains, no DB)

**Testing:**

Create `src/search/postgres-store.test.ts` with `// pattern: Imperative Shell` annotation.

Create mock `SearchDomain` implementations that return predetermined results. Create a mock `EmbeddingProvider` using the pattern from `src/integration/test-helpers.ts`.

Tests must verify:
- **GH-23.AC1.6:** Search with a query that matches nothing in any mock domain. Verify empty array returned, no error.
- **GH-23.AC2.1:** Register two mock domains that return overlapping results. Verify overlapping results score higher after RRF merge.
- **GH-23.AC2.2:** Register mock memory and conversations domains with different results. Verify output is sorted by RRF score and interleaves domains.
- **GH-23.AC4.4:** Search without time filters. Verify all results returned regardless of creation time.

Additional tests:
- Embedding provider failure falls back to keyword mode
- Unregistered domain in params.domains is silently skipped

**Verification:**

Run: `bun test src/search/postgres-store.test.ts`
Expected: All tests pass

**Commit:** `test(search): add SearchStore unit tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Implement search tool

**Files:**
- Create: `src/tool/builtin/search.ts`

**Implementation:**

Create `src/tool/builtin/search.ts` with `// pattern: Imperative Shell` annotation.

Export a factory function following the existing tool factory pattern (like `createWebTools` in `src/tool/builtin/web.ts`):

```typescript
export function createSearchTools(searchStore: SearchStore): Array<Tool>
```

Define the `search` tool:

**Definition:**
- `name: 'search'`
- `description`: Describe hybrid search across memory and conversations
- `parameters`:
  - `query` (string, required) — search query
  - `mode` (string, optional, enum: `['semantic', 'keyword', 'hybrid']`) — default `'hybrid'`
  - `domain` (string, optional, enum: `['memory', 'conversations', 'all']`) — default `'all'`
  - `limit` (number, optional) — default 10, clamped 1-50
  - `start_time` (string, optional) — ISO 8601 timestamp
  - `end_time` (string, optional) — ISO 8601 timestamp
  - `role` (string, optional, enum: `['user', 'assistant', 'system', 'tool']`) — conversations only
  - `tier` (string, optional, enum: `['core', 'working', 'archival']`) — memory only

**Handler logic:**
1. Extract params with defaults (mode → 'hybrid', domain → 'all', limit → 10)
2. Clamp limit to 1-50 range: `Math.max(1, Math.min(50, limit))`
3. Resolve `domain: 'all'` to `['memory', 'conversations']` array; single domain to `[domain]`
4. Parse ISO 8601 time strings to Date objects (null if not provided)
5. Build `SearchParams` and call `searchStore.search(params)`
6. Format results as JSON: array of `{ domain, id, content (truncated to 500 chars), score, metadata, created_at }`
7. Return `{ success: true, output: JSON.stringify(formatted, null, 2) }`
8. Catch errors: return `{ success: false, output: '', error: message }`

Note: The registry's dispatch validates enum values before the handler is called (see `src/tool/registry.ts:114-126`), so the handler doesn't need to validate mode/domain/role/tier enums. AC1.7 is covered by the registry's built-in enum validation.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(search): add search tool definition`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Search tool unit tests

**Verifies:** GH-23.AC1.7, GH-23.AC1.8

**Files:**
- Create: `src/tool/builtin/search.test.ts` (unit)

**Testing:**

Create `src/tool/builtin/search.test.ts` with `// pattern: Functional Core` annotation.

Create a mock `SearchStore` that records the `SearchParams` it receives and returns canned results.

Tests must verify:
- **GH-23.AC1.7:** Register the search tool in a real `ToolRegistry` (from `createToolRegistry()`). Call `dispatch('search', { query: 'test', mode: 'invalid' })`. Verify the registry returns an error result with a clear message about invalid enum value. (This tests the registry's enum validation, not the handler.)
- **GH-23.AC1.8:** Call the handler with `limit: 0`, `limit: -5`, `limit: 100`, `limit: 25`. Verify the `SearchParams` passed to the mock store have limit clamped to 1, 1, 50, 25 respectively.

Additional tests:
- Default values: call with only `query`, verify mode defaults to 'hybrid', domains resolves to ['memory', 'conversations'], limit defaults to 10
- `domain: 'all'` resolves to both domain names
- Time string parsing: verify ISO 8601 strings are converted to Date objects
- Content truncation: mock results with long content, verify output truncates to 500 chars

**Verification:**

Run: `bun test src/tool/builtin/search.test.ts`
Expected: All tests pass

**Commit:** `test(search): add search tool unit tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Full integration test across domains

**Verifies:** GH-23.AC1.1, GH-23.AC1.2, GH-23.AC1.3, GH-23.AC1.4, GH-23.AC1.5, GH-23.AC4.1, GH-23.AC4.2, GH-23.AC4.3

**Files:**
- Create: `src/search/search.integration.test.ts` (integration)

**Testing:**

Create `src/search/search.integration.test.ts` with `// pattern: Imperative Shell` annotation.

Full end-to-end test using real PostgreSQL, real SearchStore, real domains:
- `beforeAll`: connect, run migrations, create SearchStore, register both domains, seed test data in both `memory_blocks` and `messages` tables
- `afterEach`: truncate both tables
- `afterAll`: disconnect

Use `createMockEmbeddingProvider()` from `src/integration/test-helpers.ts` for deterministic embeddings.

Tests must verify the full fan-out + RRF merge pipeline:
- **GH-23.AC1.1-AC1.3:** Search across both domains in each mode (hybrid, keyword, semantic). Verify results include both memory blocks and messages.
- **GH-23.AC1.4:** Search with tier filter. Verify only memory results with matching tier appear (conversations results unaffected by tier filter).
- **GH-23.AC1.5:** Search with role filter. Verify only conversation results with matching role appear (memory results unaffected by role filter).
- **GH-23.AC4.1-AC4.3:** Search with time filters. Verify results from both domains respect time boundaries.

**Verification:**

Run: `bun test src/search/search.integration.test.ts`
Expected: All tests pass (requires running PostgreSQL)

**Commit:** `test(search): add full integration test across search domains`

<!-- END_TASK_5 -->
