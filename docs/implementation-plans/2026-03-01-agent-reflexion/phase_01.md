# Agent Reflexion Implementation Plan

**Goal:** Add prediction journaling, operation tracing, and scheduled self-review to the Constellation agent, enabling structured self-improvement via the Reflexion architecture.

**Architecture:** Three new subsystems (prediction journal, operation trace recorder, cron-based scheduler) integrated via existing port/adapter and factory function patterns. New modules `src/reflexion/` and `src/scheduler/` slot into the composition root without modifying established interfaces.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), PostgreSQL 17 with pgvector, bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase is infrastructure (schema + types). No acceptance criteria are directly tested here — types are verified by the compiler, and the migration is verified operationally.

**Verifies: None** (infrastructure phase — verified operationally via `bun run build` and `bun run migrate`)

---

## Phase 1: Database Schema & Core Types

**Goal:** Create the database tables and Functional Core type definitions needed by all subsequent phases.

**Key finding from investigation:** The design assumed migration number `003`, but `003_add_reasoning_content.sql` already exists. This migration will be `004_reflexion_schema.sql`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create database migration

**Files:**
- Create: `src/persistence/migrations/004_reflexion_schema.sql`

**Implementation:**

Create the migration file with four tables: `predictions`, `prediction_evaluations`, `operation_traces`, and `scheduled_tasks`. Follow the conventions established by `001_initial_schema.sql`:
- TEXT PRIMARY KEY (application-generated ULIDs/UUIDs)
- TIMESTAMPTZ with DEFAULT NOW() for timestamps
- CHECK constraints for status enums
- Standard index naming: `idx_tablename_columns`
- Owner column on all tables for multi-agent isolation

```sql
-- Predictions table (prediction journal)
CREATE TABLE predictions (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    prediction_text TEXT NOT NULL,
    domain TEXT,
    confidence DOUBLE PRECISION,
    context_snapshot JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'evaluated', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ
);

CREATE INDEX idx_predictions_owner ON predictions (owner);
CREATE INDEX idx_predictions_owner_status ON predictions (owner, status);
CREATE INDEX idx_predictions_created_at ON predictions (created_at);

-- Prediction evaluations table
CREATE TABLE prediction_evaluations (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    outcome TEXT NOT NULL,
    accurate BOOLEAN NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prediction_evaluations_prediction_id ON prediction_evaluations (prediction_id);
CREATE INDEX idx_prediction_evaluations_owner ON prediction_evaluations (owner);

-- Operation traces table
CREATE TABLE operation_traces (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input JSONB NOT NULL DEFAULT '{}',
    output_summary TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operation_traces_owner ON operation_traces (owner);
CREATE INDEX idx_operation_traces_owner_created_at ON operation_traces (owner, created_at);
CREATE INDEX idx_operation_traces_tool_name ON operation_traces (tool_name);

-- Scheduled tasks table
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_owner ON scheduled_tasks (owner);
CREATE INDEX idx_scheduled_tasks_next_run_at ON scheduled_tasks (next_run_at);
CREATE INDEX idx_scheduled_tasks_cancelled ON scheduled_tasks (cancelled);
```

**Verification:**

Run: `bun run build`
Expected: Passes (migration file is plain SQL, no TypeScript compilation involved, but verifies nothing else broke)

**Commit:** `feat(persistence): add reflexion schema migration`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create Functional Core types for reflexion module

**Files:**
- Create: `src/reflexion/types.ts`

**Implementation:**

Define all domain types for the prediction journal, trace recorder, and introspection query. Follow the patterns established in `src/memory/types.ts` and `src/persistence/types.ts`:
- `// pattern: Functional Core` header
- Plain `type` declarations (not `interface`) for data shapes
- `readonly` on all type fields (design contract types use readonly)
- `null` for optional absent values (not `undefined`)
- String literal unions for status enums (not TypeScript enums)

Types to define:
- `Prediction` — matches the `predictions` table schema
- `PredictionEvaluation` — matches the `prediction_evaluations` table schema
- `OperationTrace` — matches the `operation_traces` table schema
- `PredictionStore` — port interface for prediction CRUD, evaluation, expiry, and last-review timestamp
- `TraceRecorder` — port interface for recording operation traces
- `IntrospectionQuery` — query parameters for the self-introspect tool

```typescript
// pattern: Functional Core

export type Prediction = {
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

export type PredictionEvaluation = {
  readonly id: string;
  readonly predictionId: string;
  readonly owner: string;
  readonly outcome: string;
  readonly accurate: boolean;
  readonly evidence: Record<string, unknown>;
  readonly createdAt: Date;
};

export type OperationTrace = {
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

export type TraceRecorder = {
  record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void>;
};

export type PredictionStore = {
  createPrediction(prediction: Omit<Prediction, 'id' | 'createdAt' | 'evaluatedAt'>): Promise<Prediction>;
  listPredictions(owner: string, status?: Prediction['status'], limit?: number): Promise<ReadonlyArray<Prediction>>;
  createEvaluation(evaluation: Omit<PredictionEvaluation, 'id' | 'createdAt'>): Promise<PredictionEvaluation>;
  markEvaluated(predictionId: string): Promise<void>;
  expireStalePredictions(owner: string, olderThan: Date): Promise<number>;
  getLastReviewTimestamp(owner: string): Promise<Date | null>;
};

export type IntrospectionQuery = {
  readonly owner: string;
  readonly lookbackSince?: Date;
  readonly toolName?: string;
  readonly successOnly?: boolean;
  readonly limit?: number;
};
```

**Verification:**

Run: `bun run build`
Expected: Passes with no type errors

**Commit:** `feat(reflexion): add Functional Core types`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Create scheduler types module

**Files:**
- Create: `src/scheduler/types.ts`

**Implementation:**

Re-export the existing `Scheduler` and `ScheduledTask` types from `src/extensions/scheduler.ts`, and add the internal `SchedulerRow` type used by the PostgreSQL adapter (Phase 5). This follows the pattern where modules re-export types they depend on so consumers import from the module root.

The `SchedulerRow` type maps the `scheduled_tasks` database table to TypeScript, using the snake_case column names matching the DB schema. This is an internal type not exported from the barrel.

```typescript
// pattern: Functional Core

export type { Scheduler, ScheduledTask } from '../extensions/scheduler.ts';

export type SchedulerRow = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
  readonly next_run_at: Date;
  readonly last_run_at: Date | null;
  readonly cancelled: boolean;
  readonly created_at: Date;
};
```

**Verification:**

Run: `bun run build`
Expected: Passes with no type errors

**Commit:** `feat(scheduler): add scheduler types module`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify build passes with all new files

**Files:**
- No new files — verification only

**Verification:**

Run: `bun run build`
Expected: `tsc --noEmit` passes with zero errors

Run: `bun test`
Expected: All existing tests still pass (381 unit tests pass, 4 integration tests fail due to no local PostgreSQL — this is the pre-existing baseline)

This task ensures the new types and migration don't break any existing functionality.

<!-- END_TASK_4 -->
