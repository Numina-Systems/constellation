# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Implement the Reciprocal Rank Fusion (RRF) algorithm as a pure function for merging ranked results across search domains.

**Architecture:** Pure function taking per-domain ranked results and producing a unified scored list. RRF score formula: `1 / (k + rank)` summed across lists, where `k=60` is a smoothing constant.

**Tech Stack:** TypeScript 5.7+ (strict mode), bun:test

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH-23.AC2: RRF fusion produces correctly ranked unified results
- **GH-23.AC2.1 Success:** Results appearing in both keyword and vector results rank higher than results in only one
- **GH-23.AC2.2 Success:** Results from different domains are interleaved by RRF score, not grouped by domain
- **GH-23.AC2.3 Edge:** Results appearing in only one search mode still appear in output with appropriate lower score

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement RRF merge function

**Files:**
- Create: `src/search/rrf.ts`

**Implementation:**

Create `src/search/rrf.ts` with `// pattern: Functional Core` annotation.

Export a function `mergeWithRRF` that:

1. Accepts an array of domain result lists: `ReadonlyArray<ReadonlyArray<DomainSearchResult>>`
2. Accepts a smoothing constant `k` (default: 60)
3. For each domain result list, assign ranks (1-based) based on the order of results (which are pre-sorted by domain-local score)
4. For each unique result (keyed by `id`), compute RRF score: sum of `1 / (k + rank)` across all lists the result appears in
5. Sort by RRF score descending
6. Return `ReadonlyArray<SearchResult>` with the RRF score as the `score` field

Key logic:
- Results are identified by `id` — a result appearing in multiple lists (e.g., keyword and vector results from the same domain, or results from different domains) gets scores summed
- Results appearing in only one list still get a score (`1 / (k + rank)`) — they just score lower than results in multiple lists
- The output is a flat list sorted by RRF score, interleaving domains naturally

Also export the barrel from `src/search/index.ts` — add `export { mergeWithRRF } from './rrf.ts'`.

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(search): implement RRF merge function`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: RRF merge unit tests

**Verifies:** GH-23.AC2.1, GH-23.AC2.2, GH-23.AC2.3

**Files:**
- Create: `src/search/rrf.test.ts`

**Testing:**

Create `src/search/rrf.test.ts` with `// pattern: Functional Core` annotation.

Follow existing test patterns: `import { describe, it, expect } from 'bun:test'`, acceptance criteria naming in describe blocks.

Tests must verify each AC listed above:
- **GH-23.AC2.1:** Create two result lists (simulating keyword and vector results) with overlapping items. Verify that items appearing in both lists have higher RRF scores than items appearing in only one.
- **GH-23.AC2.2:** Create results from different domains (memory and conversations). Verify the output is sorted by RRF score, not grouped by domain — a conversations result can appear between two memory results if its score warrants it.
- **GH-23.AC2.3:** Create results that only appear in one list. Verify they still appear in the merged output with a valid (lower) score.

Additional edge cases to test:
- Empty input (no result lists) returns empty array
- Single result list returns all results with appropriate RRF scores
- Duplicate IDs across lists are correctly merged (scores summed)

**Verification:**

Run: `bun test src/search/rrf.test.ts`
Expected: All tests pass

**Commit:** `test(search): add RRF merge unit tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
