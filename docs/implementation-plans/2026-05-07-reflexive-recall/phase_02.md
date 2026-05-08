# Reflexive Recall Implementation Plan

**Goal:** Multi-query search with deduplication, domain filtering, and token-budgeted ranking.

**Architecture:** Pure Functional Core module that takes a `DecompositionResult`, fans out to `SearchStore.search()` for each query/entity, deduplicates by result ID, ranks via RRF, and trims to a token budget using `estimateTokens()`.

**Tech Stack:** TypeScript, Bun, existing SearchStore/RRF infrastructure

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-05-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC2: Retrieval
- **reflexive-recall.AC2.1 Success:** Each semantic query returns up to 5 results via `SearchStore.search({ mode: 'hybrid' })`
- **reflexive-recall.AC2.2 Success:** Named entities return results via `SearchStore.search({ mode: 'keyword' })` (limit 3 per entity)
- **reflexive-recall.AC2.3 Success:** Results from multiple queries are merged and ranked by RRF score

### reflexive-recall.AC3: Domain and Tier Filtering
- **reflexive-recall.AC3.1 Success:** Memory domain results with tier `core`, `working`, and `archival` appear in results
- **reflexive-recall.AC3.2 Success:** Conversation domain results appear in results
- **reflexive-recall.AC3.3 Failure:** Results with tier `core` that are already in the system prompt (via `buildSystemPrompt`) are deduplicated out

### reflexive-recall.AC4: Token Budget
- **reflexive-recall.AC4.1 Success:** Total recalled content is <= configurable budget (default 4096 tokens)
- **reflexive-recall.AC4.2 Success:** If a single fragment exceeds remaining budget, it is truncated not dropped
- **reflexive-recall.AC4.3 Edge:** Zero matching documents produces no system prompt section

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Retrieval module implementation

**Verifies:** reflexive-recall.AC2.1, reflexive-recall.AC2.2, reflexive-recall.AC2.3, reflexive-recall.AC3.1, reflexive-recall.AC3.2, reflexive-recall.AC3.3, reflexive-recall.AC4.1, reflexive-recall.AC4.2, reflexive-recall.AC4.3

**Files:**
- Create: `src/recall/retrieve.ts`
- Test: `src/recall/retrieve.test.ts` (unit)

**Implementation:**

Create `src/recall/retrieve.ts` with pattern annotation `// pattern: Functional Core`.

Export one main function:

```typescript
import type { SearchStore } from '@/search/store.js';
import type { SearchResult } from '@/search/types.js';
import type { DecompositionResult, RecallFragment, RecallResult } from './types.js';
import { estimateTokens } from '@/agent/context.js';

export type RetrieveOptions = {
  readonly decomposition: DecompositionResult;
  readonly searchStore: SearchStore;
  readonly tokenBudget: number;
  readonly coreLabels?: ReadonlyArray<string>;
};

export async function retrieveContext(options: RetrieveOptions): Promise<RecallResult>
```

Logic:
1. For each `decomposition.queries` entry, call `searchStore.search()` with:
   - `query`: the query string
   - `mode: 'hybrid'`
   - `domains: ['memory', 'conversations']`
   - `embedding: null` (SearchStore's `postgres-store.ts:31` generates embeddings internally via its injected `EmbeddingProvider` when `embedding` param is null and mode is hybrid/semantic — verified in codebase investigation)
   - `limit: 5`
   - `startTime: null`, `endTime: null`, `role: null`, `tier: null`

2. For each `decomposition.entities` entry, call `searchStore.search()` with:
   - `query`: the entity string
   - `mode: 'keyword'`
   - `domains: ['memory', 'conversations']`
   - `embedding: null`
   - `limit: 3`
   - Same nulls for other params

3. Collect all results into a flat array. Deduplicate by `id` — when duplicates exist, keep the one with the highest `score`.

4. Sort by score descending.

5. Filter out results where `metadata.label` matches any entry in `coreLabels` (these are already in the system prompt — AC3.3).

6. Map `SearchResult` to `RecallFragment`:
   - `id` → `result.id`
   - `label` → `result.metadata.label ?? 'unknown'`
   - `domain` → `result.domain`
   - `content` → `result.content`
   - `score` → `result.score`
   - `source` → `'semantic'` for results from query searches, `'entity'` for entity searches
   - `tier` → `result.metadata.tier`

7. Trim to token budget:
   - Iterate fragments in score order
   - For each fragment, call `estimateTokens(fragment.content)`
   - If fragment fits within remaining budget, include it fully
   - If fragment exceeds remaining budget but budget > 0, truncate content to fit (character estimate: `remainingBudget * 4` characters) — AC4.2
   - If budget is exhausted, stop

8. Return `RecallResult` with:
   - `fragments`: trimmed array
   - `totalTokens`: sum of estimated tokens across included fragments
   - `queryCount`: total number of search calls made
   - `elapsed`: 0 (timing is handled by orchestrator in Phase 3)

**Important details:**
- To track `source` ('semantic' vs 'entity'), tag results before deduplication. If the same result appears in both semantic and entity searches, prefer 'semantic' as the source (it was found via richer search).
- Use `Promise.all()` to run all search calls concurrently for performance.
- If `decomposition.queries` is empty AND `decomposition.entities` is empty, return immediately with empty fragments (AC4.3).

**Testing:**

Mock `SearchStore` as a plain object with a `search` method that returns predetermined results based on the query/mode passed in.

Tests must verify:
- reflexive-recall.AC2.1: Call with 2 semantic queries, verify search is called with `mode: 'hybrid'` and `limit: 5` for each
- reflexive-recall.AC2.2: Call with 2 entities, verify search is called with `mode: 'keyword'` and `limit: 3` for each
- reflexive-recall.AC2.3: Results from multiple queries merged correctly — provide overlapping results and verify deduplication (highest score wins)
- reflexive-recall.AC3.1: Include memory domain results with different tiers in mock, verify all appear in output
- reflexive-recall.AC3.2: Include conversation domain results, verify they appear
- reflexive-recall.AC3.3: Pass `coreLabels: ['personality']`, mock a result with `metadata.label: 'personality'`, verify it's filtered out
- reflexive-recall.AC4.1: Set tokenBudget to 100, provide fragments that total 200+ tokens, verify output stays within budget
- reflexive-recall.AC4.2: Set tokenBudget to 50, provide one fragment of ~200 tokens, verify it's truncated (not dropped) and content is shorter
- reflexive-recall.AC4.3: Provide empty decomposition (no queries, no entities), verify empty fragments returned

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun test src/recall/retrieve.test.ts`
Expected: All tests pass

**Commit:** `feat(recall): implement retrieval pipeline with dedup and token budget`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/recall/index.ts`

**Implementation:**

Add the retrieval export to the barrel:

```typescript
export { retrieveContext } from './retrieve.js';
export type { RetrieveOptions } from './retrieve.js';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): export retrieval module from barrel`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
