# Reflexive Recall Implementation Plan

**Goal:** Wire decomposition and retrieval into a single `performRecall()` entry point with guard conditions and fallback behavior.

**Architecture:** Imperative Shell orchestrator in a named file (`src/recall/orchestrator.ts`), keeping `index.ts` as a pure barrel export. Follows the pattern from `src/compaction/compactor.ts` and `src/reflexion/trace-recorder.ts`.

**Tech Stack:** TypeScript, Bun, existing ModelProvider/SearchStore/TraceRecorder infrastructure

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-05-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC5: Fallback Cascade
- **reflexive-recall.AC5.1 Success:** Utility model failure falls back to raw message as single hybrid search query
- **reflexive-recall.AC5.2 Success:** Malformed JSON from utility model triggers same fallback
- **reflexive-recall.AC5.3 Success:** Embedding failure degrades `SearchStore` hybrid search to keyword-only (existing SearchStore behavior)
- **reflexive-recall.AC5.4 Success:** Both utility model and embeddings down still returns keyword results

### reflexive-recall.AC6: Guard Conditions
- **reflexive-recall.AC6.1 Success:** `recall_enabled=false` skips recall entirely (default behavior)
- **reflexive-recall.AC6.2 Success:** Messages < 10 chars skip recall
- **reflexive-recall.AC6.3 Success:** Missing embedding provider skips recall (returns null)
- **reflexive-recall.AC6.4 Success:** Missing summarization model config skips decomposition (falls back to raw query)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Orchestrator implementation

**Verifies:** reflexive-recall.AC5.1, reflexive-recall.AC5.2, reflexive-recall.AC5.3, reflexive-recall.AC5.4, reflexive-recall.AC6.1, reflexive-recall.AC6.2, reflexive-recall.AC6.3, reflexive-recall.AC6.4

**Files:**
- Create: `src/recall/orchestrator.ts`

**Implementation:**

Create `src/recall/orchestrator.ts` with pattern annotation `// pattern: Imperative Shell`.

Define the dependencies type and export the main function:

```typescript
import type { ModelProvider } from '@/model/types.js';
import type { SearchStore } from '@/search/store.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { TraceRecorder } from '@/reflexion/types.js';
import type { RecallResult } from './types.js';
import { decomposeMessage } from './decompose.js';
import { retrieveContext } from './retrieve.js';

export type RecallDeps = {
  readonly searchStore: SearchStore;
  readonly embedding: EmbeddingProvider | null;
  readonly model: ModelProvider | null;
  readonly modelName: string | null;
  readonly tokenBudget: number;
  readonly traceRecorder?: TraceRecorder;
  readonly owner?: string;
  readonly conversationId?: string;
  readonly coreLabels?: ReadonlyArray<string>;
};

export async function performRecall(
  message: string,
  deps: RecallDeps,
): Promise<RecallResult | null>
```

Logic for `performRecall()`:

1. **Guard conditions** (return `null` immediately):
   - If `!deps.embedding` → return null (AC6.3)
   - If `message.length < 10` → return null (AC6.2)
   - Note: `recall_enabled` check is handled by the caller (agent loop) — the orchestrator is only called when enabled

2. **Decomposition with fallback:**
   - If `deps.model && deps.modelName`:
     - Try `decomposeMessage(message, deps.model, deps.modelName)`
     - If `decomposeMessage` returns empty queries AND empty entities (this signals model failure — see Phase 1), fall back to raw message query (AC5.1, AC5.2)
   - If `!deps.model || !deps.modelName` (AC6.4):
     - Skip decomposition, use raw message as single query

   - **Fallback decomposition:** `{ queries: [message], entities: [] }`

3. **Retrieval:**
   - Call `retrieveContext({ decomposition, searchStore: deps.searchStore, tokenBudget: deps.tokenBudget, coreLabels: deps.coreLabels })`
   - Note: AC5.3 (embedding failure degrades hybrid to keyword) is handled internally by SearchStore — no special handling needed here
   - AC5.4 (both model and embeddings down): model failure → raw query fallback; embedding failure within SearchStore → keyword-only. Both paths still produce results.

4. **Timing:**
   - Record `startTime = performance.now()` at start of function
   - Calculate `elapsed = performance.now() - startTime` before returning
   - Set `result.elapsed` to the measured time

5. **Trace recording** (fire-and-forget, BEFORE the null-check return):

   **Critical: Trace must fire regardless of whether recall produces fragments (AC8.2).** Record the trace AFTER retrieval completes but BEFORE checking if fragments are empty and returning null.

   ```typescript
   // Record trace before deciding whether to return null
   const elapsed = performance.now() - startTime;
   if (deps.traceRecorder && deps.owner && deps.conversationId) {
     deps.traceRecorder.record({
       owner: deps.owner,
       conversationId: deps.conversationId,
       toolName: 'recall',
       input: { message: message.slice(0, 100), queryCount: result.queryCount },
       outputSummary: `${result.fragments.length} fragments, ${result.totalTokens} tokens`,
       durationMs: elapsed,
       success: true,
       error: null,
     });
   }
   ```

6. **Return** the `RecallResult` with correct `elapsed` value, or `null` if no results found (empty fragments after retrieval). The trace has already been recorded at this point regardless of outcome.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): implement orchestrator with guard conditions and fallback cascade`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Orchestrator tests

**Verifies:** reflexive-recall.AC5.1, reflexive-recall.AC5.2, reflexive-recall.AC5.3, reflexive-recall.AC5.4, reflexive-recall.AC6.1, reflexive-recall.AC6.2, reflexive-recall.AC6.3, reflexive-recall.AC6.4

**Files:**
- Test: `src/recall/orchestrator.test.ts` (unit)

**Testing:**

Mock all dependencies (`SearchStore`, `ModelProvider`, `EmbeddingProvider`, `TraceRecorder`) as plain objects.

Tests must verify:
- reflexive-recall.AC5.1: Mock model that throws an error → verify search is called with raw message as query (fallback path)
- reflexive-recall.AC5.2: Mock model that returns non-JSON text → decomposeMessage returns empty result → verify fallback to raw message query
- reflexive-recall.AC5.3: This is SearchStore internal behavior — verify that recall still calls searchStore.search() with mode 'hybrid' and trusts SearchStore to degrade. (No special recall logic to test, but verify the call is made correctly)
- reflexive-recall.AC5.4: Pass `model: null` (no decomposition available) → verify search is called with raw message. SearchStore handles embedding failure internally.
- reflexive-recall.AC6.1: Not tested here (caller responsibility) — but verify that performRecall doesn't check a config flag itself
- reflexive-recall.AC6.2: Pass message "hi" (3 chars) → verify returns null without calling searchStore
- reflexive-recall.AC6.3: Pass `embedding: null` → verify returns null without calling searchStore or model
- reflexive-recall.AC6.4: Pass `model: null, modelName: null` → verify search is called with raw message (skips decomposition, doesn't skip entirely)

Additional test cases:
- Happy path: model returns valid decomposition → search returns results → verify RecallResult structure
- Empty results: model works, search returns empty → verify returns null
- Trace recording: verify traceRecorder.record() is called with correct shape when owner/conversationId provided
- Trace recording skipped when no traceRecorder provided

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun test src/recall/orchestrator.test.ts`
Expected: All tests pass

**Commit:** `test(recall): add orchestrator integration tests`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/recall/index.ts`

**Implementation:**

Update the barrel to include orchestrator exports. The barrel remains a pure re-export file:

```typescript
// pattern: Functional Core (barrel export)

export type { DecompositionResult, RecallFragment, RecallResult } from './types.js';
export { decomposeMessage, parseDecompositionResponse } from './decompose.js';
export { retrieveContext } from './retrieve.js';
export type { RetrieveOptions } from './retrieve.js';
export { performRecall } from './orchestrator.js';
export type { RecallDeps } from './orchestrator.js';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): export orchestrator from barrel`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
