# Agent Reflexion Implementation Plan

**Goal:** Add prediction journaling, operation tracing, and scheduled self-review to the Constellation agent.

**Architecture:** Port/adapter pattern with factory functions, following existing `createPostgresMemoryStore` patterns.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), PostgreSQL 17, bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC1: Prediction Journal
- **agent-reflexion.AC1.1 Success:** Agent can create a prediction with text, optional domain, and optional confidence via the `predict` tool
- **agent-reflexion.AC1.2 Success:** Predictions are scoped by owner — agent A cannot see agent B's predictions
- **agent-reflexion.AC1.4 Success:** `list_predictions` returns predictions filtered by status and respects limit
- **agent-reflexion.AC1.5 Edge:** Prediction with no optional fields (domain, confidence) succeeds with null values

### agent-reflexion.AC2: Self-Introspection & Trace Capture
- **agent-reflexion.AC2.1 Success:** Every tool dispatch writes a trace with tool name, input, output summary, duration, and success status
- **agent-reflexion.AC2.2 Success:** Failed tool calls record the error message in the trace
- **agent-reflexion.AC2.3 Success:** Output summary is truncated to 500 characters
- **agent-reflexion.AC2.4 Failure:** A trace recorder INSERT failure logs a warning but does not block or fail the agent loop

### agent-reflexion.AC3: Prediction Review
- **agent-reflexion.AC3.2 Success:** Annotating a prediction updates its status to `evaluated`
- **agent-reflexion.AC3.4 Success:** Review job expires predictions older than 24h as `expired` without evaluating them

---

## Phase 2: Prediction Store & Trace Recorder

**Goal:** PostgreSQL implementations of the `PredictionStore` and `TraceRecorder` port interfaces defined in Phase 1.

**Patterns to follow:** `src/memory/postgres-store.ts` — factory function returning interface, positional `$1` params, `randomUUID()` for IDs, row parser converting snake_case DB columns to camelCase domain types, `RETURNING *` pattern.

**Testing approach:** Real PostgreSQL with TRUNCATE between tests, matching the pattern in `src/memory/manager.test.ts`. Random owner ID per test run for isolation.

**CLAUDE.md files to read before implementation:**
- `src/persistence/CLAUDE.md` — PersistenceProvider contracts and query patterns
- `src/memory/CLAUDE.md` — Memory store pattern reference

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Implement PredictionStore PostgreSQL adapter

**Verifies:** agent-reflexion.AC1.1, agent-reflexion.AC1.2, agent-reflexion.AC1.4, agent-reflexion.AC1.5, agent-reflexion.AC3.2, agent-reflexion.AC3.4

**Files:**
- Create: `src/reflexion/prediction-store.ts`

**Implementation:**

Create `createPredictionStore(persistence: PersistenceProvider): PredictionStore` following `createPostgresMemoryStore` pattern.

The file must be `// pattern: Imperative Shell` (database I/O).

Internal row type for DB mapping:

```typescript
type PredictionRow = {
  id: string;
  owner: string;
  conversation_id: string;
  prediction_text: string;
  domain: string | null;
  confidence: number | null;
  context_snapshot: Record<string, unknown>;
  status: string;
  created_at: string;
  evaluated_at: string | null;
};

type EvaluationRow = {
  id: string;
  prediction_id: string;
  owner: string;
  outcome: string;
  accurate: boolean;
  evidence: Record<string, unknown>;
  created_at: string;
};
```

Row parsers to convert snake_case DB rows to camelCase domain types (same pattern as `parseMemoryBlock` in `postgres-store.ts`):

```typescript
function parsePrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    owner: row.owner,
    conversationId: row.conversation_id,
    predictionText: row.prediction_text,
    domain: row.domain,
    confidence: row.confidence,
    contextSnapshot: row.context_snapshot,
    status: row.status as Prediction['status'],
    createdAt: new Date(row.created_at),
    evaluatedAt: row.evaluated_at ? new Date(row.evaluated_at) : null,
  };
}
```

Methods:
- `createPrediction`: INSERT with `randomUUID()` ID, RETURNING *, parse row
- `listPredictions`: SELECT filtered by owner, optional status, optional limit (default 50), ORDER BY created_at DESC
- `createEvaluation`: INSERT evaluation row with `randomUUID()` ID, RETURNING *, parse row
- `markEvaluated`: UPDATE predictions SET status = 'evaluated', evaluated_at = NOW() WHERE id = $1
- `expireStalePredictions`: UPDATE predictions SET status = 'expired' WHERE owner = $1 AND status = 'pending' AND created_at < $2, return count of rows affected
- `getLastReviewTimestamp`: SELECT MAX(created_at) FROM prediction_evaluations WHERE owner = $1, return Date or null

For `expireStalePredictions`, use RETURNING to count:
```sql
UPDATE predictions SET status = 'expired'
WHERE owner = $1 AND status = 'pending' AND created_at < $2
RETURNING id
```
Return `rows.length` as the count.

For `context_snapshot` and `evidence` JSONB columns: pass JavaScript objects directly as query parameters — `pg` driver serializes them to JSONB automatically.

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): implement PredictionStore PostgreSQL adapter`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement TraceRecorder PostgreSQL adapter

**Verifies:** agent-reflexion.AC2.1, agent-reflexion.AC2.2, agent-reflexion.AC2.3, agent-reflexion.AC2.4

**Files:**
- Create: `src/reflexion/trace-recorder.ts`

**Implementation:**

Create `createTraceRecorder(persistence: PersistenceProvider): TraceStore` factory function.

**Design deviation:** The design specifies `createTraceRecorder(persistence, owner)` with owner at factory creation time. This implementation takes only `persistence` because `owner` is included per-record in the trace data passed to `record()`. This is more flexible (a single recorder can handle traces from multiple owners) and aligns with how `PredictionStore` also receives owner per-method.

The file must be `// pattern: Imperative Shell` (database I/O).

The `record` method:
1. Generates a UUID with `randomUUID()`
2. Truncates `outputSummary` to 500 characters
3. INSERTs into `operation_traces`
4. Wraps the entire operation in try/catch — on failure, logs a warning via `console.warn` but does NOT throw. This is the fire-and-forget pattern specified by AC2.4.

```typescript
async function record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void> {
  try {
    const id = randomUUID();
    const truncatedOutput = trace.outputSummary.slice(0, 500);
    await persistence.query(
      `INSERT INTO operation_traces
       (id, owner, conversation_id, tool_name, input, output_summary, duration_ms, success, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, trace.owner, trace.conversationId, trace.toolName,
       trace.input, truncatedOutput, trace.durationMs, trace.success, trace.error],
    );
  } catch (error) {
    console.warn('trace recorder: failed to record operation trace', error);
  }
}
```

Also add a query method for the self_introspect tool (used in Phase 3):

```typescript
async function queryTraces(query: IntrospectionQuery): Promise<ReadonlyArray<OperationTrace>> {
  // Build WHERE clause dynamically based on query parameters
  // Always filter by owner
  // Optional: lookbackSince, toolName, successOnly, limit (default 100)
}
```

Internal row type:

```typescript
type TraceRow = {
  id: string;
  owner: string;
  conversation_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output_summary: string;
  duration_ms: number;
  success: boolean;
  error: string | null;
  created_at: string;
};
```

Expose both `record` and `queryTraces` from the factory. The return type extends `TraceRecorder` with the additional `queryTraces` method:

```typescript
type TraceStore = TraceRecorder & {
  queryTraces(query: IntrospectionQuery): Promise<ReadonlyArray<OperationTrace>>;
};
```

Export this `TraceStore` type from the module so the introspection tools can depend on it.

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): implement TraceRecorder with fire-and-forget recording`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for PredictionStore and TraceRecorder

**Verifies:** agent-reflexion.AC1.1, agent-reflexion.AC1.2, agent-reflexion.AC1.4, agent-reflexion.AC1.5, agent-reflexion.AC2.1, agent-reflexion.AC2.2, agent-reflexion.AC2.3, agent-reflexion.AC2.4, agent-reflexion.AC3.2, agent-reflexion.AC3.4

**Files:**
- Create: `src/reflexion/prediction-store.test.ts`
- Create: `src/reflexion/trace-recorder.test.ts`

**Testing:**

These are integration tests requiring a running PostgreSQL instance, following the exact pattern from `src/memory/manager.test.ts`:
- Real PostgreSQL connection to `postgresql://constellation:constellation@localhost:5432/constellation`
- `beforeAll`: connect, run migrations, truncate
- `afterEach`: truncate `predictions`, `prediction_evaluations`, `operation_traces` tables (CASCADE)
- `afterAll`: disconnect
- Random `TEST_OWNER` per test run

Tests for PredictionStore must verify:
- **agent-reflexion.AC1.1:** Create a prediction with text, domain, and confidence — verify returned prediction has all fields populated correctly
- **agent-reflexion.AC1.2:** Create predictions for two different owners, list for each — verify owner A cannot see owner B's predictions
- **agent-reflexion.AC1.4:** Create several predictions with different statuses, list with status filter and limit — verify filtering and limit work correctly
- **agent-reflexion.AC1.5:** Create a prediction with `domain: null` and `confidence: null` — verify it succeeds and returns null values
- **agent-reflexion.AC3.2:** Create evaluation for a prediction, call markEvaluated — verify prediction status changes to `evaluated` and `evaluatedAt` is set
- **agent-reflexion.AC3.4:** Create predictions older than 24h (by inserting with backdated created_at or using a cutoff date), call expireStalePredictions — verify they're marked `expired` and count is returned

Tests for TraceRecorder must verify:
- **agent-reflexion.AC2.1:** Record a trace with all fields — verify it's written to DB (query directly to check)
- **agent-reflexion.AC2.2:** Record a trace with `success: false` and an error message — verify error is stored
- **agent-reflexion.AC2.3:** Record a trace with an outputSummary longer than 500 chars — verify stored summary is truncated to 500
- **agent-reflexion.AC2.4:** Simulate INSERT failure (e.g., disconnect persistence before recording) — verify no exception is thrown and a warning is logged
- **queryTraces:** Verify filtering by owner, lookback window, tool name, success-only flag, and limit

**Verification:**

Run: `bun test src/reflexion/`
Expected: All tests pass (requires running PostgreSQL)

Run: `bun run build`
Expected: No type errors

**Commit:** `test(reflexion): add PredictionStore and TraceRecorder tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
