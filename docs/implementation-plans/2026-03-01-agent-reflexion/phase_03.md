# Agent Reflexion Implementation Plan

**Goal:** Add agent-callable tools for predictions and trace queries.

**Architecture:** Factory functions returning `Array<Tool>`, following `createMemoryTools` and `createWebTools` patterns.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC1: Prediction Journal
- **agent-reflexion.AC1.1 Success:** Agent can create a prediction with text, optional domain, and optional confidence via the `predict` tool
- **agent-reflexion.AC1.2 Success:** Predictions are scoped by owner — agent A cannot see agent B's predictions
- **agent-reflexion.AC1.3 Success:** Prediction captures a context snapshot (recent tool calls, active memory labels) at creation time

### agent-reflexion.AC2: Self-Introspection & Trace Capture
- **agent-reflexion.AC2.5 Success:** `self_introspect` returns traces filtered by owner and lookback window
- **agent-reflexion.AC2.6 Success:** Lookback window defaults to since-last-review timestamp when not specified
- **agent-reflexion.AC2.7 Edge:** When no prior review exists, lookback defaults to all available traces (up to limit)

### agent-reflexion.AC3: Prediction Review
- **agent-reflexion.AC3.1 Success:** `annotate_prediction` creates an evaluation record with outcome, accuracy boolean, and evidence
- **agent-reflexion.AC3.2 Success:** Annotating a prediction updates its status to `evaluated`
- **agent-reflexion.AC3.3 Failure:** Annotating a nonexistent prediction ID returns an error

---

## Phase 3: Prediction & Introspection Tools

**Goal:** Create agent-callable tools that wrap the PredictionStore and TraceStore from Phase 2.

**Patterns to follow:** `src/tool/builtin/memory.ts` — `createMemoryTools(manager)` returning `Array<Tool>`. Tool handlers never throw; errors are returned as `{ success: false, output: '', error: '...' }`.

**CLAUDE.md files to read before implementation:**
- `src/tool/CLAUDE.md` — Tool registry contracts and ToolParameter conventions
- `src/memory/CLAUDE.md` — Memory manager interface (for context snapshot)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Implement prediction tools

**Verifies:** agent-reflexion.AC1.1, agent-reflexion.AC1.2, agent-reflexion.AC1.3, agent-reflexion.AC3.1, agent-reflexion.AC3.2, agent-reflexion.AC3.3

**Files:**
- Create: `src/reflexion/tools.ts`

**Implementation:**

Create `createPredictionTools(store, owner, conversationId)` returning `Array<Tool>` with three tools: `predict`, `annotate_prediction`, `list_predictions`.

The file must be `// pattern: Imperative Shell` (tools perform I/O via store).

Factory signature:

```typescript
import type { PredictionStore } from './types.ts';
import type { Tool } from '../tool/types.ts';

type PredictionToolsDeps = {
  readonly store: PredictionStore;
  readonly owner: string;
  readonly conversationId: string;
};

export function createPredictionTools(deps: PredictionToolsDeps): Array<Tool>
```

**`predict` tool:**
- Parameters: `text` (string, required), `domain` (string, optional), `confidence` (number, optional)
- Handler: Creates a prediction via `store.createPrediction`. The `contextSnapshot` should be an empty object `{}` for now — Phase 7 wiring will inject richer context from the agent loop.
- Returns: JSON-formatted prediction on success

**`annotate_prediction` tool:**
- Parameters: `prediction_id` (string, required), `outcome` (string, required), `accurate` (boolean, required), `evidence` (string, optional — free-text evidence)
- Handler: Calls `store.createEvaluation`, then `store.markEvaluated`. If `createEvaluation` throws (e.g., FK violation for nonexistent prediction_id), catch and return error. The evidence parameter is stored as `{ text: evidence }` in the JSONB evidence field.
- Returns: JSON-formatted evaluation on success

**`list_predictions` tool:**
- Parameters: `status` (string, optional, enum: pending/evaluated/expired), `limit` (number, optional)
- Handler: Calls `store.listPredictions(owner, status, limit)`.
- Returns: JSON-formatted array of predictions on success

All handlers follow the pattern from `createMemoryTools`:
```typescript
handler: async (params) => {
  try {
    // ... logic
    return { success: true, output: JSON.stringify(result, null, 2) };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `predict failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
},
```

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): add prediction tools (predict, annotate, list)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement introspection tools

**Verifies:** agent-reflexion.AC2.5, agent-reflexion.AC2.6, agent-reflexion.AC2.7

**Files:**
- Create: `src/reflexion/introspection-tools.ts`

**Implementation:**

Create `createIntrospectionTools(traceStore, predictionStore, owner)` returning `Array<Tool>` with one tool: `self_introspect`.

The file must be `// pattern: Imperative Shell`.

Factory signature:

```typescript
import type { TraceStore } from './trace-recorder.ts';
import type { PredictionStore } from './types.ts';
import type { Tool } from '../tool/types.ts';

type IntrospectionToolsDeps = {
  readonly traceStore: TraceStore;
  readonly predictionStore: PredictionStore;
  readonly owner: string;
};

export function createIntrospectionTools(deps: IntrospectionToolsDeps): Array<Tool>
```

**`self_introspect` tool:**
- Parameters: `lookback_hours` (number, optional), `tool_name` (string, optional), `success_only` (boolean, optional), `limit` (number, optional)
- Handler:
  1. If `lookback_hours` is provided, compute `lookbackSince = new Date(Date.now() - lookback_hours * 3600000)`
  2. If `lookback_hours` is NOT provided, call `predictionStore.getLastReviewTimestamp(owner)`:
     - If a timestamp exists, use it as `lookbackSince` (AC2.6)
     - If null (no prior review), omit `lookbackSince` so all traces are returned up to limit (AC2.7)
  3. Call `traceStore.queryTraces({ owner, lookbackSince, toolName, successOnly, limit })`
  4. Return JSON-formatted traces

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): add self_introspect tool`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create barrel export and tests

**Verifies:** agent-reflexion.AC1.1, agent-reflexion.AC1.3, agent-reflexion.AC2.5, agent-reflexion.AC2.6, agent-reflexion.AC2.7, agent-reflexion.AC3.1, agent-reflexion.AC3.3

**Files:**
- Create: `src/reflexion/index.ts`
- Create: `src/reflexion/tools.test.ts`
- Create: `src/reflexion/introspection-tools.test.ts`

**Implementation — Barrel export:**

```typescript
// pattern: Functional Core (barrel export)

export type {
  Prediction,
  PredictionEvaluation,
  OperationTrace,
  TraceRecorder,
  PredictionStore,
  IntrospectionQuery,
} from './types.ts';

export { createPredictionStore } from './prediction-store.ts';
export { createTraceRecorder } from './trace-recorder.ts';
export type { TraceStore } from './trace-recorder.ts';
export { createPredictionTools } from './tools.ts';
export { createIntrospectionTools } from './introspection-tools.ts';
```

**Testing:**

Tool tests use **mock stores** (not real PostgreSQL). Follow the pattern from `src/tool/builtin/memory.test.ts`:
- Create mock PredictionStore and TraceStore objects that return canned data
- Call `createPredictionTools(deps)` / `createIntrospectionTools(deps)`, find tool by name
- Invoke `handler()` directly, assert on output

Tests for prediction tools must verify:
- **agent-reflexion.AC1.1:** Call `predict` handler with text, domain, confidence — verify store.createPrediction was called with correct args and output contains the prediction
- **agent-reflexion.AC1.3:** Verify the context snapshot is included in the createPrediction call (empty object `{}` for now)
- **agent-reflexion.AC3.1:** Call `annotate_prediction` handler — verify store.createEvaluation and store.markEvaluated are called
- **agent-reflexion.AC3.3:** Call `annotate_prediction` with invalid ID where store.createEvaluation throws — verify handler returns `{ success: false }` with error message

Tests for introspection tools must verify:
- **agent-reflexion.AC2.5:** Call `self_introspect` with lookback_hours — verify traceStore.queryTraces is called with computed lookbackSince date
- **agent-reflexion.AC2.6:** Call `self_introspect` without lookback_hours, mock getLastReviewTimestamp to return a date — verify that date is used as lookbackSince
- **agent-reflexion.AC2.7:** Call `self_introspect` without lookback_hours, mock getLastReviewTimestamp to return null — verify queryTraces is called without lookbackSince

**Verification:**

Run: `bun test src/reflexion/tools.test.ts src/reflexion/introspection-tools.test.ts`
Expected: All tests pass (no PostgreSQL needed — mocked stores)

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): add barrel export and tool tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
