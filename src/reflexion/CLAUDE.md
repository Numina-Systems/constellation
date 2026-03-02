# Reflexion

Last verified: 2026-03-02

## Purpose
Enables agent self-observation and calibration through prediction journaling, operation tracing, and introspection. The agent records predictions about outcomes, traces every tool call, and periodically reviews its accuracy to improve decision-making.

## Contracts
- **Exposes**: `PredictionStore` (CRUD for predictions and evaluations), `TraceRecorder` / `TraceStore` (fire-and-forget trace recording with query support), `createPredictionTools(deps)` (predict, annotate_prediction, list_predictions), `createIntrospectionTools(deps)` (self_introspect), `createPredictionContextProvider(store, owner)` (cached system prompt injection of pending prediction count)
- **Guarantees**:
  - Trace recording is fire-and-forget; database errors are caught and logged, never propagated to the agent loop
  - Output summaries are truncated to 500 chars before storage
  - Prediction context provider caches for 5 minutes, refreshes asynchronously
  - `expireStalePredictions` marks old pending predictions as `expired` without deleting data
  - `getLastReviewTimestamp` returns the most recent evaluation timestamp for lookback anchoring
- **Expects**: `PersistenceProvider` with migration 004 applied. Owner string for multi-agent isolation.

## Dependencies
- **Uses**: `src/persistence/` (query interface), `src/tool/types.ts` (Tool interface), `src/agent/types.ts` (ContextProvider type)
- **Used by**: `src/agent/` (traceRecorder in AgentDependencies, contextProviders), `src/index.ts` (composition root)
- **Boundary**: This module never calls the LLM directly. Introspection tools read traces; the agent decides how to act on them.

## Key Decisions
- Fire-and-forget tracing: Tool dispatch timing must not be affected by trace persistence
- Owner-scoped queries: All stores filter by owner, enabling multi-agent deployments
- Context provider pattern: Pending prediction count injected into system prompt via ContextProvider, not tool calls

## Invariants
- Prediction status transitions: `pending` -> `evaluated` (via annotate) or `pending` -> `expired` (via expiry)
- Evaluations reference a valid prediction ID (FK constraint)
- Traces are append-only; no update or delete operations

## Key Files
- `types.ts` -- `Prediction`, `PredictionEvaluation`, `OperationTrace`, `TraceRecorder`, `PredictionStore`, `IntrospectionQuery`
- `prediction-store.ts` -- PostgreSQL PredictionStore implementation
- `trace-recorder.ts` -- PostgreSQL TraceRecorder/TraceStore implementation
- `tools.ts` -- predict, annotate_prediction, list_predictions tool definitions
- `introspection-tools.ts` -- self_introspect tool definition
- `context-provider.ts` -- Cached prediction context provider for system prompt
- `index.ts` -- Barrel exports
