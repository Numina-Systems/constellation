# Scheduled Task Context Hydration Implementation Plan

**Goal:** Enrich scheduled task events with recent operation traces so the agent has visibility into its recent activity during cold-start scheduled turns.

**Architecture:** A pure formatting function converts `OperationTrace` records into a compact text summary. The existing `buildReviewEvent()` becomes async and queries `TraceStore` for recent traces before constructing the event. A new `buildAgentScheduledEvent()` function provides the same enrichment for agent-scheduled tasks. The single `scheduler.onDue` handler is updated to pass `traceStore` and `owner` to the async builder.

**Tech Stack:** Bun (TypeScript), bun:test, existing TraceStore/OperationTrace from src/reflexion

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### scheduled-task-context.AC1: Scheduled tasks include recent traces
- **scheduled-task-context.AC1.1 Success:** Review event content contains [Recent Activity] section with formatted traces
- **scheduled-task-context.AC1.2 Success:** Agent-scheduled event content contains [Recent Activity] section with formatted traces
- **scheduled-task-context.AC1.3 Edge:** When no traces exist in lookback window, section shows "No recent activity recorded."
- **scheduled-task-context.AC1.4 Edge:** Traces are bounded to max 20 entries regardless of activity volume
- **scheduled-task-context.AC1.5 Edge:** Only traces within 2-hour lookback window are included

### scheduled-task-context.AC2: No impact on interactive sessions
- **scheduled-task-context.AC2.1 Success:** Interactive REPL messages do not include trace sections
- **scheduled-task-context.AC2.2 Success:** Bluesky event processing does not include trace sections

### scheduled-task-context.AC3: Trace formatting is compact and readable
- **scheduled-task-context.AC3.1 Success:** Each trace is one line with timestamp, tool name, status, and truncated output
- **scheduled-task-context.AC3.2 Success:** Output summaries are truncated to ~80 chars per line
- **scheduled-task-context.AC3.3 Success:** Traces are ordered newest-first

---

## Codebase Verification Findings

- ✓ `buildReviewEvent()` exists at `src/index.ts:103-134`, currently synchronous
- ✗ `buildAgentScheduledEvent()` does NOT exist — must be created
- ✗ Design assumed two schedulers (`systemScheduler` + `agentScheduler`) — codebase has one `scheduler` instance with one `onDue` handler at `src/index.ts:675-697`
- ✓ `TraceStore` type at `src/reflexion/trace-recorder.ts:40-42` with `queryTraces(query: IntrospectionQuery)`
- ✓ `OperationTrace` type at `src/reflexion/types.ts:31-42` with all expected fields
- ✓ `IntrospectionQuery` type at `src/reflexion/types.ts:57-63` with `owner`, `lookbackSince?`, `toolName?`, `successOnly?`, `limit?`
- ✓ `traceRecorder` variable (typed `TraceStore`) at `src/index.ts:406`
- ✓ `AGENT_OWNER = 'spirit'` at `src/index.ts:55`
- ✓ `queryTraces` already returns results ordered `created_at DESC` (newest-first)
- + Output summaries are truncated to 500 chars at storage time; formatting function truncates further to ~80 chars for display

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Implement `formatTraceSummary()` pure function

**Verifies:** scheduled-task-context.AC3.1, scheduled-task-context.AC3.2, scheduled-task-context.AC3.3, scheduled-task-context.AC1.3

**Files:**
- Create: `src/scheduled-context.ts`
- Test: `src/scheduled-context.test.ts`

**Implementation:**

Create `src/scheduled-context.ts` (pattern: Functional Core) with a single exported function:

```typescript
function formatTraceSummary(traces: ReadonlyArray<OperationTrace>): string
```

Behaviour:
- The function always returns a string starting with the `[Recent Activity]` section header
- If `traces` is empty, return `"[Recent Activity]\nNo recent activity recorded."`
- Otherwise, format each trace as a single line: `[HH:MM] toolName ✓|✗ truncatedOutput`
  - Timestamp: `createdAt` formatted as `HH:MM` in local time
  - Tool name: `toolName` field
  - Status: `✓` if `success === true`, `✗` if `success === false`
  - Output: `outputSummary` truncated to 80 characters, with `…` appended if truncated
- Traces are already ordered newest-first from `queryTraces` (no re-sorting needed)
- Join all formatted lines with `\n`
- Prepend `[Recent Activity]\n` to the joined lines

Example output with traces:
```
[Recent Activity]
[14:32] memory_write ✓ Wrote block core:persona with updated personality traits…
[14:30] web_search ✗ Search failed: connection timeout
[14:28] code_execute ✓ Executed Python snippet, returned 42
```

Example output with no traces:
```
[Recent Activity]
No recent activity recorded.
```

Import `OperationTrace` from `@/reflexion`.

**Commit:** `feat: add formatTraceSummary pure function for scheduled task context`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for `formatTraceSummary()`

**Verifies:** scheduled-task-context.AC3.1, scheduled-task-context.AC3.2, scheduled-task-context.AC3.3, scheduled-task-context.AC1.3

**Files:**
- Test: `src/scheduled-context.test.ts`

**Testing:**

Create `src/scheduled-context.test.ts` (pattern: Functional Core). Tests must verify:

- **scheduled-task-context.AC1.3:** Empty traces array returns `"[Recent Activity]\nNo recent activity recorded."`
- **scheduled-task-context.AC3.1:** Each trace produces one line with timestamp (`HH:MM`), tool name, status indicator (`✓`/`✗`), and output summary
- **scheduled-task-context.AC3.2:** Output summaries longer than 80 characters are truncated with `…` appended; summaries at or under 80 chars are not truncated
- **scheduled-task-context.AC3.3:** Output preserves input order (newest-first, since `queryTraces` already sorts this way)
- Section header: Output starts with `[Recent Activity]\n`
- Mixed success/failure traces render correct status indicators

Use factory helper to create test `OperationTrace` values with all required fields (`id`, `owner`, `conversationId`, `toolName`, `input`, `outputSummary`, `durationMs`, `success`, `error`, `createdAt`).

**Verification:**
Run: `bun test src/scheduled-context.test.ts`
Expected: All tests pass

**Commit:** `test: add formatTraceSummary tests for scheduled task context`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Make `buildReviewEvent()` async with trace enrichment

**Verifies:** scheduled-task-context.AC1.1

**Files:**
- Modify: `src/index.ts:103-134` (`buildReviewEvent` function)

**Implementation:**

Change `buildReviewEvent` signature to async and add `traceStore` and `owner` parameters:

```typescript
export async function buildReviewEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}>
```

Inside the function body:
1. Query traces: `const traces = await traceStore.queryTraces({ owner, lookbackSince: new Date(Date.now() - 2 * 3600_000), limit: 20 })`
2. Format: `const activitySection = formatTraceSummary(traces)`
3. Append `activitySection` as a new element at the end of the existing content array (after all existing elements including the zero-predictions guidance). The current array has 8 elements (indices 0-7). Add `''` (blank line) then `activitySection` as the final two elements before `.join('\n')`. The resulting content ends with the `[Recent Activity]` section after all review instructions.

Import `formatTraceSummary` from `@/scheduled-context` and `TraceStore` from `@/reflexion`.

**Commit:** `feat: make buildReviewEvent async with trace context enrichment`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create `buildAgentScheduledEvent()` async function

**Verifies:** scheduled-task-context.AC1.2

**Files:**
- Modify: `src/index.ts` (add new exported function after `buildReviewEvent`)

**Implementation:**

Create a new exported async function `buildAgentScheduledEvent` with the same trace-enrichment pattern:

```typescript
export async function buildAgentScheduledEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}>
```

Body:
1. Query traces with same parameters as `buildReviewEvent` (2-hour lookback, limit 20)
2. Format with `formatTraceSummary(traces)`
3. Build event with:
   - `source`: `'agent-scheduled'`
   - `content`: Task prompt from payload plus the `[Recent Activity]` section
   - `metadata`: task id, name, schedule, and payload spread
   - `timestamp`: `new Date()`

The content should be:
```
Scheduled task "[task.name]" has fired.

[payload.prompt or generic "Execute this scheduled task."]

[Recent Activity]
...traces...
```

**Commit:** `feat: add buildAgentScheduledEvent with trace context enrichment`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update scheduler `onDue` handler to use async builders

**Verifies:** scheduled-task-context.AC1.1, scheduled-task-context.AC1.2, scheduled-task-context.AC1.4, scheduled-task-context.AC1.5

**Files:**
- Modify: `src/index.ts:675-697` (scheduler onDue handler)

**Implementation:**

Update the existing `scheduler.onDue` handler at line 675 to:
1. Pass `traceRecorder` and `AGENT_OWNER` to `buildReviewEvent`
2. `await` the now-async `buildReviewEvent` call
3. Route between `buildReviewEvent` and `buildAgentScheduledEvent` based on task name or payload

The handler already runs inside an async IIFE, so adding `await` is straightforward:

```typescript
scheduler.onDue((task) => {
  (async () => {
    try {
      // existing stale prediction expiry logic stays as-is
      const expiredCount = await predictionStore.expireStalePredictions(
        AGENT_OWNER,
        new Date(Date.now() - 24 * 3600_000),
      );
      if (expiredCount > 0) {
        console.log(`review job: expired ${expiredCount} stale predictions`);
      }
    } catch (error) {
      console.warn('review job: failed to expire stale predictions', error);
    }

    // Route to appropriate builder based on task name
    const event = task.name === 'review-predictions'
      ? await buildReviewEvent(task, traceRecorder, AGENT_OWNER)
      : await buildAgentScheduledEvent(task, traceRecorder, AGENT_OWNER);

    schedulerEventQueue.push(event);
    processSchedulerEvent().catch((error) => {
      console.error('scheduler event processing error:', error);
    });
  })();
});
```

This ensures:
- AC1.4: The `limit: 20` in the builder's `queryTraces` call caps trace count
- AC1.5: The `lookbackSince: 2h ago` in the builder's `queryTraces` call scopes the time window
- Review tasks use `buildReviewEvent`, agent-scheduled tasks use `buildAgentScheduledEvent`

**Commit:** `feat: update scheduler onDue handler for async trace-enriched builders`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->
### Task 6: Update existing `buildReviewEvent` tests

**Verifies:** scheduled-task-context.AC1.1, scheduled-task-context.AC1.3, scheduled-task-context.AC1.4, scheduled-task-context.AC1.5

**Files:**
- Modify: `src/index.wiring.test.ts` (existing buildReviewEvent tests at lines 117-273)

**Testing:**

The existing tests in `src/index.wiring.test.ts:117-273` call `buildReviewEvent(task)` synchronously. These must be updated to:
1. Call `await buildReviewEvent(task, mockTraceStore, 'test-owner')` (now async with 3 params)
2. Provide a mock `TraceStore` with `queryTraces` returning test data
3. Add new tests for trace enrichment:

New test cases to add:
- **scheduled-task-context.AC1.1:** When `queryTraces` returns traces, event content contains `[Recent Activity]` section with formatted trace lines
- **scheduled-task-context.AC1.3:** When `queryTraces` returns empty array, event content contains `"No recent activity recorded."`
- **scheduled-task-context.AC1.4:** `queryTraces` is called with `limit: 20`
- **scheduled-task-context.AC1.5:** `queryTraces` is called with `lookbackSince` approximately 2 hours before current time

Mock `TraceStore` (import `TraceStore` from `@/reflexion` and `OperationTrace` from `@/reflexion`):
```typescript
function createMockTraceStore(traces: ReadonlyArray<OperationTrace> = []): TraceStore {
  return {
    record: mock(async () => {}) as TraceStore['record'],
    queryTraces: mock(async () => traces),
  };
}
```

**Verification:**
Run: `bun test src/index.wiring.test.ts`
Expected: All existing tests pass (updated for async), plus new trace enrichment tests pass

**Commit:** `test: update buildReviewEvent tests for async trace enrichment`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Add `buildAgentScheduledEvent` tests

**Verifies:** scheduled-task-context.AC1.2, scheduled-task-context.AC1.3

**Files:**
- Modify: `src/index.wiring.test.ts` (add new describe block)

**Testing:**

Add a new `describe` block for `buildAgentScheduledEvent` tests:
- **scheduled-task-context.AC1.2:** Event content contains `[Recent Activity]` section with formatted traces when traces exist
- **scheduled-task-context.AC1.3:** Event content contains `"No recent activity recorded."` when no traces exist
- Event source is `'agent-scheduled'`
- Event content includes task name
- Event metadata includes taskId, taskName, schedule, and payload spread
- `queryTraces` is called with `limit: 20` and `lookbackSince` ~2 hours ago

Import `buildAgentScheduledEvent` from `@/index` (update the import line at top of file).

**Verification:**
Run: `bun test src/index.wiring.test.ts`
Expected: All tests pass

**Commit:** `test: add buildAgentScheduledEvent tests`

<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_8 -->
### Task 8: Verify AC2 — no impact on interactive sessions

**Verifies:** scheduled-task-context.AC2.1, scheduled-task-context.AC2.2

**Files:**
- No code changes — verification only

**Verification:**

AC2.1 and AC2.2 are verified by design: the trace enrichment is implemented inside `buildReviewEvent` and `buildAgentScheduledEvent` only. These functions are called exclusively from the `scheduler.onDue` handler. Interactive REPL messages go through `createInteractionLoop` → `agent.processMessage()`, and Bluesky events go through the Bluesky `onMessage` handler → `agent.processEvent()`. Neither path calls the event builder functions.

Verify by reading:
1. `src/index.ts` — confirm `buildReviewEvent`/`buildAgentScheduledEvent` are only called inside `scheduler.onDue`
2. The REPL interaction loop (`createInteractionLoop`) does not reference either function
3. The Bluesky event handler does not reference either function

Run: `bun test`
Expected: All existing tests pass (no regressions in REPL or Bluesky tests)

**Commit:** No commit — verification-only task

<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Export `buildAgentScheduledEvent` from index and run full test suite

**Verifies:** scheduled-task-context.AC1.1, scheduled-task-context.AC1.2, scheduled-task-context.AC2.1, scheduled-task-context.AC2.2

**Files:**
- Modify: `src/index.ts` (ensure `buildAgentScheduledEvent` is exported)

**Implementation:**

Ensure `buildAgentScheduledEvent` is exported (it should be if declared with `export async function`). Verify the import in `src/index.wiring.test.ts` includes it.

**Verification:**

Run full test suite:
```bash
bun test
```

Expected: All tests pass (584+ passing, same 8 pre-existing infra failures).

Run type-check:
```bash
bun run build
```

Expected: No type errors.

**Commit:** `feat: complete scheduled task context hydration`

<!-- END_TASK_9 -->
