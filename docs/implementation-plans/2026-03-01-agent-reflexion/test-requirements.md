# Test Requirements: Agent Reflexion

Generated from: docs/design-plans/2026-03-01-agent-reflexion.md

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| agent-reflexion.AC1.1 | Agent can create a prediction with text, optional domain, and optional confidence via the `predict` tool | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC1.1 | Agent can create a prediction with text, optional domain, and optional confidence via the `predict` tool | unit (mock store) | `src/reflexion/tools.test.ts` | 3 |
| agent-reflexion.AC1.2 | Predictions are scoped by owner -- agent A cannot see agent B's predictions | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC1.3 | Prediction captures a context snapshot (recent tool calls, active memory labels) at creation time | unit (mock store) | `src/reflexion/tools.test.ts` | 3 |
| agent-reflexion.AC1.4 | `list_predictions` returns predictions filtered by status and respects limit | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC1.5 | Prediction with no optional fields (domain, confidence) succeeds with null values | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC2.1 | Every tool dispatch (regular, execute_code, compact_context) writes a trace with tool name, input, output summary, duration, and success status | integration | `src/reflexion/trace-recorder.test.ts` | 2 |
| agent-reflexion.AC2.1 | Every tool dispatch (regular, execute_code, compact_context) writes a trace with tool name, input, output summary, duration, and success status | unit (mock deps) | `src/agent/trace-capture.test.ts` | 4 |
| agent-reflexion.AC2.2 | Failed tool calls record the error message in the trace | integration | `src/reflexion/trace-recorder.test.ts` | 2 |
| agent-reflexion.AC2.2 | Failed tool calls record the error message in the trace | unit (mock deps) | `src/agent/trace-capture.test.ts` | 4 |
| agent-reflexion.AC2.3 | Output summary is truncated to 500 characters | integration | `src/reflexion/trace-recorder.test.ts` | 2 |
| agent-reflexion.AC2.4 | A trace recorder INSERT failure logs a warning but does not block or fail the agent loop | integration | `src/reflexion/trace-recorder.test.ts` | 2 |
| agent-reflexion.AC2.4 | A trace recorder INSERT failure logs a warning but does not block or fail the agent loop | unit (mock deps) | `src/agent/trace-capture.test.ts` | 4 |
| agent-reflexion.AC2.5 | `self_introspect` returns traces filtered by owner and lookback window | unit (mock store) | `src/reflexion/introspection-tools.test.ts` | 3 |
| agent-reflexion.AC2.6 | Lookback window defaults to since-last-review timestamp when not specified | unit (mock store) | `src/reflexion/introspection-tools.test.ts` | 3 |
| agent-reflexion.AC2.7 | When no prior review exists, lookback defaults to all available traces (up to limit) | unit (mock store) | `src/reflexion/introspection-tools.test.ts` | 3 |
| agent-reflexion.AC3.1 | `annotate_prediction` creates an evaluation record with outcome, accuracy boolean, and evidence | unit (mock store) | `src/reflexion/tools.test.ts` | 3 |
| agent-reflexion.AC3.2 | Annotating a prediction updates its status to `evaluated` | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC3.3 | Annotating a nonexistent prediction ID returns an error | unit (mock store) | `src/reflexion/tools.test.ts` | 3 |
| agent-reflexion.AC3.4 | Review job expires predictions older than 24h as `expired` without evaluating them | integration | `src/reflexion/prediction-store.test.ts` | 2 |
| agent-reflexion.AC3.4 | Review job expires predictions older than 24h as `expired` without evaluating them | unit (mock store) | `src/index.wiring.test.ts` | 7 |
| agent-reflexion.AC4.1 | Tasks can be scheduled with a cron expression and persist across restarts | integration | `src/scheduler/postgres-scheduler.test.ts` | 5 |
| agent-reflexion.AC4.2 | Scheduler fires `onDue` handler when a task's `next_run_at` passes | integration | `src/scheduler/postgres-scheduler.test.ts` | 5 |
| agent-reflexion.AC4.3 | `next_run_at` is recomputed from the cron expression after each execution | integration | `src/scheduler/postgres-scheduler.test.ts` | 5 |
| agent-reflexion.AC4.4 | Tasks can be cancelled by ID | integration | `src/scheduler/postgres-scheduler.test.ts` | 5 |
| agent-reflexion.AC4.5 | Missed ticks (daemon was down) are detected and fired on next startup based on `last_run_at` | integration | `src/scheduler/postgres-scheduler.test.ts` | 5 |
| agent-reflexion.AC4.6 | Review job is registered as a scheduled task at daemon startup and fires hourly via `processEvent()` | unit (mock deps) | `src/index.wiring.test.ts` | 7 |
| agent-reflexion.AC5.1 | Prediction context provider injects status line into system prompt when predictions exist | unit (mock store) | `src/reflexion/context-provider.test.ts` | 6 |
| agent-reflexion.AC5.1 | Prediction context provider injects status line into system prompt when predictions exist | unit (mock memory) | `src/agent/context-providers.test.ts` | 6 |
| agent-reflexion.AC5.2 | Context provider returns `undefined` (no injection) when no predictions exist | unit (mock store) | `src/reflexion/context-provider.test.ts` | 6 |
| agent-reflexion.AC5.3 | All new components wired in composition root and daemon starts successfully | unit (import verification) | `src/index.wiring.test.ts` | 7 |

## Human Verification

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| agent-reflexion.AC3.5 | Review job triggers agent to write a reflection to archival memory via `memory_write` | The full loop requires a live LLM to interpret the review prompt, reason over predictions and traces, and decide what to write to archival memory. The test would need to mock the entire agent loop including model responses, which would only test the mock, not the actual behaviour. | Start the daemon with a running PostgreSQL and valid LLM config. Create a prediction via the REPL (`predict` tool). Fast-forward the scheduler (or wait for the hourly tick). Verify: (1) the agent processes the review event (visible in logs), (2) a `memory_write` tool call appears in the conversation trace, (3) the archival memory tier contains a new reflection block. Query: `SELECT * FROM memory_blocks WHERE owner = 'spirit' AND tier = 'archival' ORDER BY created_at DESC LIMIT 1`. |
| agent-reflexion.AC3.6 | Review job with zero pending predictions still produces a reflection noting the absence | Same as AC3.5 -- requires a live LLM to interpret the review prompt and decide to write a "no predictions" reflection. The review event content includes guidance for this case, but the agent's actual behaviour depends on model reasoning. | Start the daemon with no pending predictions. Trigger a scheduler tick (or wait for the hourly fire). Verify: (1) the review event is processed (logs show `[External Event: review-job]`), (2) the agent writes a reflection to archival memory even with zero predictions, (3) the reflection content references the absence of predictions. The review event prompt explicitly instructs this, but verifying the agent follows through requires observation. |

## Test Infrastructure Notes

### Integration tests requiring PostgreSQL

The following test files require a running PostgreSQL instance (`postgresql://constellation:constellation@localhost:5432/constellation`):

- `src/reflexion/prediction-store.test.ts` (Phase 2)
- `src/reflexion/trace-recorder.test.ts` (Phase 2)
- `src/scheduler/postgres-scheduler.test.ts` (Phase 5)

Start PostgreSQL via `docker compose up -d` before running these tests.

### Unit tests with mocks (no external dependencies)

- `src/reflexion/tools.test.ts` (Phase 3)
- `src/reflexion/introspection-tools.test.ts` (Phase 3)
- `src/agent/trace-capture.test.ts` (Phase 4)
- `src/reflexion/context-provider.test.ts` (Phase 6)
- `src/agent/context-providers.test.ts` (Phase 6)
- `src/index.wiring.test.ts` (Phase 7)

### Test execution commands

```bash
# All reflexion + scheduler tests
bun test src/reflexion/ src/scheduler/ src/agent/trace-capture.test.ts src/agent/context-providers.test.ts src/index.wiring.test.ts

# Unit tests only (no PostgreSQL needed)
bun test src/reflexion/tools.test.ts src/reflexion/introspection-tools.test.ts src/reflexion/context-provider.test.ts src/agent/trace-capture.test.ts src/agent/context-providers.test.ts src/index.wiring.test.ts

# Integration tests only (PostgreSQL required)
bun test src/reflexion/prediction-store.test.ts src/reflexion/trace-recorder.test.ts src/scheduler/postgres-scheduler.test.ts

# Full suite (all existing + new)
bun test
```

### Coverage matrix

| Phase | Test File | ACs Covered |
|-------|-----------|-------------|
| 1 | (none -- verified by `bun run build`) | infrastructure |
| 2 | `src/reflexion/prediction-store.test.ts` | AC1.1, AC1.2, AC1.4, AC1.5, AC3.2, AC3.4 |
| 2 | `src/reflexion/trace-recorder.test.ts` | AC2.1, AC2.2, AC2.3, AC2.4 |
| 3 | `src/reflexion/tools.test.ts` | AC1.1, AC1.3, AC3.1, AC3.3 |
| 3 | `src/reflexion/introspection-tools.test.ts` | AC2.5, AC2.6, AC2.7 |
| 4 | `src/agent/trace-capture.test.ts` | AC2.1, AC2.2, AC2.4 |
| 5 | `src/scheduler/postgres-scheduler.test.ts` | AC4.1, AC4.2, AC4.3, AC4.4, AC4.5 |
| 6 | `src/reflexion/context-provider.test.ts` | AC5.1, AC5.2 |
| 6 | `src/agent/context-providers.test.ts` | AC5.1 |
| 7 | `src/index.wiring.test.ts` | AC3.4, AC4.6, AC5.3 |
| -- | (human verification) | AC3.5, AC3.6 |
