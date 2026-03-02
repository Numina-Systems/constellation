# Agent Reflexion Design

## Summary

Constellation's agent loop will gain a structured self-improvement cycle inspired by the Reflexion architecture (Shinn et al., 2023). The agent can record predictions — timestamped, confidence-tagged beliefs about future events or outcomes — during normal conversation. In parallel, every tool call the agent makes is silently traced to an `operation_traces` table: tool name, duration, success, and a truncated output summary. An hourly scheduled job then closes the loop: it invokes the agent through the existing `processEvent()` path, prompting it to review its pending predictions against the accumulated trace data, annotate each prediction with an accuracy judgment, and write a reflection to archival memory. That reflection surfaces in future conversations via semantic search, giving the agent a mechanism to learn from its own track record over time.

The implementation is purely additive. Three new subsystems — a prediction journal, an operation trace recorder, and a cron-based scheduler — live in two new modules (`src/reflexion/`, `src/scheduler/`) and slot into the existing port/adapter, factory-function, and owner-scoped isolation patterns without modifying established interfaces. The scheduler concretely implements the `Scheduler` extension interface that already exists in the codebase but had no implementation until now.

## Definition of Done

1. **Prediction journal tool** — agent can write timestamped predictions (any topic) scoped per-agent. Predictions stored in PostgreSQL with metadata.
2. **Self-introspection tool** — agent can query its own operational traces (tool calls, duration, success/failure, errors) with lookback window defaulting to since-last-review. New `operation_traces` table captures execution metadata.
3. **Prediction review mechanism** — automated review infers outcomes from traces/memory/conversation, plus agent can self-annotate predictions manually. Review results stored.
4. **Scheduler implementation** — implement the existing `Scheduler` extension interface (cron-based, DB-backed). Review loop registers as an hourly scheduled task. Reusable for future features.
5. **Wiring** — all new components registered in composition root, following existing FCIS/port-adapter patterns.

**Out of scope:**
- Changes to existing memory tiers (predictions are a parallel system, not a new tier)
- UI/REPL changes for prediction management
- Multi-process scheduling (single-daemon scope)

## Acceptance Criteria

### agent-reflexion.AC1: Prediction Journal
- **agent-reflexion.AC1.1 Success:** Agent can create a prediction with text, optional domain, and optional confidence via the `predict` tool
- **agent-reflexion.AC1.2 Success:** Predictions are scoped by owner — agent A cannot see agent B's predictions
- **agent-reflexion.AC1.3 Success:** Prediction captures a context snapshot (recent tool calls, active memory labels) at creation time
- **agent-reflexion.AC1.4 Success:** `list_predictions` returns predictions filtered by status and respects limit
- **agent-reflexion.AC1.5 Edge:** Prediction with no optional fields (domain, confidence) succeeds with null values

### agent-reflexion.AC2: Self-Introspection & Trace Capture
- **agent-reflexion.AC2.1 Success:** Every tool dispatch (regular, execute_code, compact_context) writes a trace with tool name, input, output summary, duration, and success status
- **agent-reflexion.AC2.2 Success:** Failed tool calls record the error message in the trace
- **agent-reflexion.AC2.3 Success:** Output summary is truncated to 500 characters
- **agent-reflexion.AC2.4 Failure:** A trace recorder INSERT failure logs a warning but does not block or fail the agent loop
- **agent-reflexion.AC2.5 Success:** `self_introspect` returns traces filtered by owner and lookback window
- **agent-reflexion.AC2.6 Success:** Lookback window defaults to since-last-review timestamp when not specified
- **agent-reflexion.AC2.7 Edge:** When no prior review exists, lookback defaults to all available traces (up to limit)

### agent-reflexion.AC3: Prediction Review
- **agent-reflexion.AC3.1 Success:** `annotate_prediction` creates an evaluation record with outcome, accuracy boolean, and evidence
- **agent-reflexion.AC3.2 Success:** Annotating a prediction updates its status to `evaluated`
- **agent-reflexion.AC3.3 Failure:** Annotating a nonexistent prediction ID returns an error
- **agent-reflexion.AC3.4 Success:** Review job expires predictions older than 24h as `expired` without evaluating them
- **agent-reflexion.AC3.5 Success:** Review job triggers agent to write a reflection to archival memory via `memory_write`
- **agent-reflexion.AC3.6 Edge:** Review job with zero pending predictions still produces a reflection noting the absence

### agent-reflexion.AC4: Scheduler
- **agent-reflexion.AC4.1 Success:** Tasks can be scheduled with a cron expression and persist across restarts
- **agent-reflexion.AC4.2 Success:** Scheduler fires `onDue` handler when a task's `next_run_at` passes
- **agent-reflexion.AC4.3 Success:** `next_run_at` is recomputed from the cron expression after each execution
- **agent-reflexion.AC4.4 Success:** Tasks can be cancelled by ID
- **agent-reflexion.AC4.5 Edge:** Missed ticks (e.g., daemon was down) are detected and fired on next startup based on `last_run_at`
- **agent-reflexion.AC4.6 Success:** Review job is registered as a scheduled task at daemon startup and fires hourly via `processEvent()`

### agent-reflexion.AC5: Wiring & Context
- **agent-reflexion.AC5.1 Success:** Prediction context provider injects status line into system prompt when predictions exist
- **agent-reflexion.AC5.2 Edge:** Context provider returns `undefined` (no injection) when no predictions exist
- **agent-reflexion.AC5.3 Success:** All new components (store, recorder, tools, scheduler, context provider) are wired in the composition root and the daemon starts successfully

## Glossary

- **Reflexion**: A 2023 research architecture (Shinn et al.) in which a language model agent reflects on past failures, stores verbal self-feedback in memory, and uses that feedback to improve future behaviour. This design adapts the concept from discrete task episodes to continuous daemon operation.
- **Functional Core / Imperative Shell (FCIS)**: An architectural pattern in which all business logic is expressed as pure functions (the "functional core") while side-effecting operations like I/O, database writes, and scheduling are pushed to the outer "imperative shell." Files in this codebase explicitly annotate which pattern they follow.
- **Port/Adapter pattern**: A hexagonal architecture convention where a domain defines an abstract interface ("port") and infrastructure provides a concrete implementation ("adapter") — e.g., `PredictionStore` (port) implemented by a PostgreSQL adapter. Callers depend only on the port.
- **Composition root**: The single entry point (`src/index.ts`) where all concrete implementations are instantiated and wired together. No business logic lives here — it only constructs the dependency graph.
- **ContextProvider**: A function registered in the composition root that injects a string fragment into the agent's system prompt at context-build time. Used to surface ambient state (e.g., pending prediction count) without the agent explicitly querying for it.
- **processEvent()**: The agent loop's entry point for externally-triggered events, as opposed to user-initiated conversation turns. The Bluesky data source and now the scheduler both fire into the agent via this path.
- **Owner-scoped isolation**: All multi-agent data (memory, predictions, traces) is keyed by an `owner` string so agent A cannot read or modify agent B's records, even within a shared database.
- **Prediction journal**: The subsystem that stores agent-authored predictions as rows in a `predictions` table with status (`pending`, `evaluated`, `expired`), optional domain and confidence metadata, and a context snapshot captured at creation time.
- **Operation trace**: A record written after every tool dispatch capturing the tool name, inputs, a truncated output summary, wall-clock duration, and success/failure status. Used by the agent during self-review to reconstruct what it actually did.
- **TraceRecorder**: The port interface for writing operation traces. Implemented as a fire-and-forget INSERT — failures log a warning but never block the agent loop.
- **Semantic search**: Retrieval from the archival memory tier using vector similarity (pgvector) rather than exact-match queries. Reflections written after each review cycle are surfaced this way in future turns when context is relevant.
- **pgvector**: A PostgreSQL extension that stores and queries vector embeddings. Used by the archival memory tier to enable semantic similarity search.
- **Cron expression**: A string notation (e.g., `0 * * * *` for hourly) that defines a repeating schedule. The scheduler stores one per task and recomputes `next_run_at` after each execution using a lightweight parsing library.
- **Missed-tick recovery**: When the daemon restarts after downtime, the scheduler detects tasks whose `next_run_at` has already passed (based on `last_run_at` in the database) and fires them immediately rather than waiting for the next natural tick.
- **Archival memory**: The third tier of Constellation's three-tier memory system. Stored in PostgreSQL with vector embeddings; retrieved via semantic search. Reflections from the review cycle are written here so they can influence future conversations.
- **Barrel export**: An `index.ts` file whose sole purpose is re-exporting the public API of a module. Consumers import from the module root rather than individual files.

## Architecture

Three new subsystems — prediction journal, operation tracing, and scheduling — integrated into the existing agent via the established port/adapter pattern. Inspired by the Reflexion architecture (Shinn et al., 2023), adapted from episodic task-solving to continuous daemon operation.

**Core separation:** Prediction, evaluation, and reflection are distinct concerns with separate storage. The agent writes predictions during normal conversation. A scheduled review job triggers the agent to evaluate its own predictions using introspection data, then write reflections to archival memory. Reflections surface later via semantic search when the agent encounters similar contexts.

**Data flow:**

```
Normal operation:
  Agent conversation → predict tool → predictions table
  Agent tool dispatch → TraceRecorder → operation_traces table

Hourly review:
  Scheduler tick → processEvent(review prompt) → Agent loop
    → list_predictions (pending) → self_introspect (traces since last review)
    → annotate_prediction (per prediction) → prediction_evaluations table
    → memory_write (reflection) → archival memory block

Future turns:
  Agent context building → semantic search → matching reflections surface
```

**New module boundaries:**

- `src/reflexion/` — Prediction store, trace recorder, tools, context provider. Functional Core types + Imperative Shell PostgreSQL implementations.
- `src/scheduler/` — Concrete implementation of the existing `Scheduler` extension interface. DB-backed cron scheduling with in-process tick.

**Key contracts:**

```typescript
type Prediction = {
  readonly id: string;
  readonly owner: string;
  readonly conversationId: string;
  readonly predictionText: string;
  readonly domain: string | null;
  readonly confidence: number | null;
  readonly contextSnapshot: Record<string, unknown>;
  readonly status: 'pending' | 'evaluated' | 'expired';
  readonly createdAt: Date;
  readonly evaluatedAt: Date | null;
};

type PredictionEvaluation = {
  readonly id: string;
  readonly predictionId: string;
  readonly owner: string;
  readonly outcome: string;
  readonly accurate: boolean;
  readonly evidence: Record<string, unknown>;
  readonly createdAt: Date;
};

type OperationTrace = {
  readonly id: string;
  readonly owner: string;
  readonly conversationId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly outputSummary: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error: string | null;
  readonly createdAt: Date;
};

type TraceRecorder = {
  record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void>;
};

type PredictionStore = {
  createPrediction(prediction: Omit<Prediction, 'id' | 'createdAt' | 'evaluatedAt'>): Promise<Prediction>;
  listPredictions(owner: string, status?: Prediction['status'], limit?: number): Promise<ReadonlyArray<Prediction>>;
  createEvaluation(evaluation: Omit<PredictionEvaluation, 'id' | 'createdAt'>): Promise<PredictionEvaluation>;
  markEvaluated(predictionId: string): Promise<void>;
  expireStalePredictions(owner: string, olderThan: Date): Promise<number>;
  getLastReviewTimestamp(owner: string): Promise<Date | null>;
};

type IntrospectionQuery = {
  readonly owner: string;
  readonly lookbackSince?: Date;
  readonly toolName?: string;
  readonly successOnly?: boolean;
  readonly limit?: number;
};
```

## Existing Patterns

Investigation found established patterns this design follows:

**Port/Adapter with factory functions:** `MemoryManager`, `ToolRegistry`, `CodeRuntime`, and `PersistenceProvider` all use the `createFoo()` factory pattern returning an interface. `PredictionStore`, `TraceRecorder`, and the scheduler follow the same pattern with PostgreSQL adapters.

**Owner-scoped isolation:** All `MemoryStore` queries filter by `owner` string for multi-agent isolation. All new tables (`predictions`, `prediction_evaluations`, `operation_traces`, `scheduled_tasks`) include `owner` columns with the same scoping pattern.

**Tool registration via `createFooTools()`:** Memory tools use `createMemoryTools(manager)` returning `Array<Tool>`. New tools use `createPredictionTools(store, owner)` and `createIntrospectionTools(persistence, owner)` following the same pattern.

**Context providers:** Rate limiter status is exposed via a `ContextProvider` function registered in the composition root. Prediction status uses the same mechanism.

**Event processing via `processEvent()`:** The Bluesky data source fires external events into the agent loop via `agent.processEvent()`. The scheduler uses the same path for review triggers.

**Append-only migrations:** Existing migrations in `src/persistence/migrations/` are immutable. New tables added via a new migration file.

**No new patterns introduced.** All components fit existing architectural conventions.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Database Schema & Core Types
**Goal:** New tables and Functional Core type definitions.

**Components:**
- `src/persistence/migrations/003_reflexion_schema.sql` — `predictions`, `prediction_evaluations`, `operation_traces`, `scheduled_tasks` tables with indexes
- `src/reflexion/types.ts` — `Prediction`, `PredictionEvaluation`, `OperationTrace`, `TraceRecorder`, `PredictionStore`, `IntrospectionQuery` types
- `src/scheduler/types.ts` — Re-export `Scheduler` and `ScheduledTask` from `src/extensions/`, add internal `SchedulerRow` type

**Dependencies:** None

**Done when:** Migration runs successfully, types compile, `bun run build` passes
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Prediction Store & Trace Recorder
**Goal:** PostgreSQL implementations for prediction storage and trace recording.

**Components:**
- `src/reflexion/prediction-store.ts` — `createPredictionStore(persistence)` implementing `PredictionStore` port. CRUD for predictions and evaluations, stale expiry, last-review timestamp query.
- `src/reflexion/trace-recorder.ts` — `createTraceRecorder(persistence, owner)` implementing `TraceRecorder` port. Fire-and-forget INSERT with error logging, output truncation to 500 chars.

**Dependencies:** Phase 1

**Done when:** Tests verify prediction CRUD, evaluation creation, stale expiry, trace recording with truncation, and fire-and-forget error handling. Covers `agent-reflexion.AC1.1-AC1.5`, `agent-reflexion.AC2.1-AC2.4`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Prediction & Introspection Tools
**Goal:** Agent-callable tools for predictions and trace queries.

**Components:**
- `src/reflexion/tools.ts` — `createPredictionTools(store, owner, conversationId)` producing `predict`, `annotate_prediction`, `list_predictions` tools
- `src/reflexion/introspection-tools.ts` — `createIntrospectionTools(persistence, owner)` producing `self_introspect` tool with lookback-since-last-review default
- `src/reflexion/index.ts` — Barrel export

**Dependencies:** Phase 2

**Done when:** Tests verify tool parameter validation, correct delegation to store, context snapshot capture, introspection query filtering and formatting. Covers `agent-reflexion.AC1.1-AC1.3`, `agent-reflexion.AC2.5-AC2.7`, `agent-reflexion.AC3.1-AC3.3`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Trace Capture in Agent Loop
**Goal:** Instrument the agent loop to write operation traces on every tool dispatch.

**Components:**
- `src/agent/types.ts` — Add optional `traceRecorder?: TraceRecorder` to `AgentDependencies`
- `src/agent/agent.ts` — Wrap tool dispatch (regular, execute_code, compact_context) with timing + trace recording. Fire-and-forget, never blocks.

**Dependencies:** Phase 2

**Done when:** Tests verify traces are recorded for successful and failed tool calls with correct duration, that trace failures don't block the agent loop, and that tracing is skipped when no recorder is provided. Covers `agent-reflexion.AC2.1-AC2.4`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Scheduler Implementation
**Goal:** Concrete DB-backed scheduler implementing the existing `Scheduler` extension interface.

**Components:**
- `src/scheduler/postgres-scheduler.ts` — `createPostgresScheduler(persistence, owner)` implementing `Scheduler`. 60-second `setInterval` tick, cron parsing via lightweight library, `next_run_at` computation, missed-tick recovery via `last_run_at`.
- `src/scheduler/index.ts` — Barrel export

**Dependencies:** Phase 1

**Done when:** Tests verify task scheduling/cancellation, cron-based due detection, handler invocation on tick, missed tick recovery after restart, and `last_run_at` persistence. Covers `agent-reflexion.AC4.1-AC4.5`.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Prediction Context Provider
**Goal:** System prompt injection showing prediction status.

**Components:**
- `src/reflexion/context-provider.ts` — `createPredictionContextProvider(store, owner)` returning `ContextProvider`. One COUNT query, cached for 5 minutes. Returns formatted status line or `undefined` when no predictions exist.

**Dependencies:** Phase 2

**Done when:** Tests verify status line format, cache behaviour, and undefined return when empty. Covers `agent-reflexion.AC5.1-AC5.2`.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Composition Root Wiring & Review Job
**Goal:** Wire all components into `src/index.ts` and register the hourly review scheduled task.

**Components:**
- `src/index.ts` — Create `PredictionStore`, `TraceRecorder`, register prediction/introspection tools, create scheduler, register review job, add prediction context provider, pass trace recorder to agent

**Dependencies:** Phases 3, 4, 5, 6

**Done when:** Daemon starts with all new components active, review job fires on schedule via `processEvent()`, `bun run build` passes. Covers `agent-reflexion.AC5.3`, `agent-reflexion.AC4.6`.
<!-- END_PHASE_7 -->

## Additional Considerations

**Prediction expiry:** Predictions still `pending` after 24h (configurable) are marked `expired` by the review job. Expired predictions aren't evaluated — they signal the agent made predictions it never followed up on. This is itself useful reflection data.

**Trace table growth:** `operation_traces` grows with every tool call. A future retention policy (e.g., drop traces older than 30 days) is advisable but out of scope for this design. The table should be partitioned by `created_at` if volume becomes a concern.

**Empty review cycles:** If the review job finds zero pending predictions, the agent writes a short reflection noting the absence. This nudges the agent toward more predictive thinking.

**Review prompt design:** The scheduled review fires a system-level prompt instructing the agent to use its tools (`list_predictions`, `self_introspect`, `annotate_prediction`, `memory_write`) in sequence. The prompt is part of the composition root wiring, not a separate config file. Exact wording is an implementation detail.

**Cron library:** A lightweight cron parser (e.g., `cron-parser` or `croner`) is needed for the scheduler. This is the only new runtime dependency.
