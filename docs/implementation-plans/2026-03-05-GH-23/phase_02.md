# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Define the SearchStore port, SearchDomain interface, and all shared types for the search module.

**Architecture:** Port/adapter pattern matching existing MemoryStore, EmbeddingProvider, and DataSource interfaces. Types in `types.ts`, port interface in `store.ts`, barrel exports in `index.ts`.

**Tech Stack:** TypeScript 5.7+ (strict mode)

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase is infrastructure only (types and interfaces). No acceptance criteria are directly tested — verification is operational (build passes, types importable from `@/search`).

**Verifies:** None

---

<!-- START_TASK_1 -->
### Task 1: Create search module types

**Files:**
- Create: `src/search/types.ts`

**Step 1: Create the types file**

Create `src/search/types.ts` following the existing patterns from `src/memory/types.ts` and `src/embedding/types.ts`:

- Use `type` declarations (not `interface`) for data shapes
- Use string literal unions for modes and domain names
- Use `ReadonlyArray` for array parameters
- Use `readonly` on object properties
- Follow `// pattern: Functional Core` annotation

Types to define:

1. `SearchMode` — string literal union: `'semantic' | 'keyword' | 'hybrid'`
2. `SearchDomainName` — string literal union: `'memory' | 'conversations'`
3. `SearchParams` — query parameters accepted by SearchStore:
   - `query: string` (required)
   - `mode: SearchMode` (required — default applied at tool layer, not type layer)
   - `domains: ReadonlyArray<SearchDomainName>` (required — resolved from `'all'` at tool layer)
   - `embedding: ReadonlyArray<number> | null` (pre-generated query embedding, null for keyword-only)
   - `limit: number` (required — clamped at tool layer)
   - `startTime: Date | null` (optional time filter)
   - `endTime: Date | null` (optional time filter)
   - `role: string | null` (conversations-only filter)
   - `tier: string | null` (memory-only filter)
4. `DomainSearchParams` — same as SearchParams but passed to individual domains (same shape — domains ignore irrelevant filters)
5. `DomainSearchResult` — raw result from a single domain before RRF merge:
   - `id: string`
   - `domain: SearchDomainName`
   - `content: string`
   - `score: number` (domain-local relevance score)
   - `metadata: SearchResultMetadata`
   - `createdAt: Date`
6. `SearchResultMetadata` — domain-specific metadata:
   - `tier: string | null` (memory domain)
   - `label: string | null` (memory domain)
   - `role: string | null` (conversations domain)
   - `conversationId: string | null` (conversations domain)
7. `SearchResult` — final result after RRF merge:
   - `domain: SearchDomainName`
   - `id: string`
   - `content: string`
   - `score: number` (RRF score)
   - `metadata: SearchResultMetadata`
   - `createdAt: Date`
8. `SearchDomain` — pluggable domain interface:
   - `readonly name: SearchDomainName`
   - `search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>>`

Reference `src/memory/types.ts` for the style: pure `type` declarations, `ReadonlyArray`, discriminated unions, `null` for absent values.

**Step 2: Verify build**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/search/types.ts
git commit -m "feat(search): add search module type definitions"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create SearchStore port interface

**Files:**
- Create: `src/search/store.ts`

**Step 1: Create the port interface file**

Create `src/search/store.ts` following the pattern from `src/memory/store.ts`:

- `// pattern: Functional Core` annotation
- Import types from `./types.ts`
- Define `SearchStore` as an `interface` (it's a port/class contract, matching `MemoryStore` pattern)
- Two methods:
  - `search(params: SearchParams): Promise<ReadonlyArray<SearchResult>>`
  - `registerDomain(domain: SearchDomain): void`

**Step 2: Verify build**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/search/store.ts
git commit -m "feat(search): add SearchStore port interface"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create barrel exports

**Files:**
- Create: `src/search/index.ts`

**Step 1: Create the barrel file**

Create `src/search/index.ts` following the pattern from `src/memory/index.ts` and `src/embedding/index.ts`:

- `// pattern: Functional Core` annotation
- Export all types from `./types.ts` using `export type { ... }`
- Export `SearchStore` interface from `./store.ts` using `export type { SearchStore }`

Types first, then interfaces — matching the memory module's barrel pattern.

**Step 2: Verify build and import**

Run: `bun run build`
Expected: No errors. Types are importable via `@/search` path alias.

**Step 3: Commit**

```bash
git add src/search/index.ts
git commit -m "feat(search): add barrel exports for search module"
```
<!-- END_TASK_3 -->
