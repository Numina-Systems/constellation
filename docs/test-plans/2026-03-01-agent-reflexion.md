# Agent Reflexion - Human Test Plan

## Prerequisites

- PostgreSQL running: `docker compose up -d`
- Migrations applied: `bun run migrate`
- All automated tests passing:
  ```bash
  bun test src/reflexion/ src/scheduler/ src/agent/trace-capture.test.ts src/agent/context-providers.test.ts src/index.wiring.test.ts
  ```
- Valid LLM config in `config.toml` (Anthropic API key or OpenAI-compatible endpoint)
- Type-check passes: `bun run build`

## Phase 1: Prediction Lifecycle (AC1.x, AC3.x)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon: `bun run start` | REPL prompt appears, no startup errors |
| 2 | Send message: "Make a prediction that I will ask you about the weather within the next hour. Use the predict tool with domain 'conversation' and confidence 0.6" | Agent calls `predict` tool; response includes prediction ID, domain "conversation", confidence 0.6 |
| 3 | Send message: "List your current predictions" | Agent calls `list_predictions`; shows 1 pending prediction with the text from step 2 |
| 4 | Send message: "Actually, what's the weather like today?" | Agent responds (may use web_search or give general answer) |
| 5 | Send message: "Now evaluate your prediction from earlier -- it was correct, I did ask about the weather. Use annotate_prediction." | Agent calls `annotate_prediction` with `accurate: true`; response includes evaluation ID |
| 6 | Send message: "List your predictions again" | Prediction from step 2 now shows status "evaluated" with non-null `evaluated_at` |
| 7 | Verify in database: `SELECT status, evaluated_at FROM predictions WHERE owner = 'spirit' ORDER BY created_at DESC LIMIT 1;` | Status = "evaluated", evaluated_at is non-null |

## Phase 2: Operation Tracing (AC2.x)

| Step | Action | Expected |
|------|--------|----------|
| 1 | With the daemon running, send a message that triggers tool use: "Search your memory for information about yourself" | Agent calls `memory_read` tool |
| 2 | Send: "Use self_introspect to look at your recent tool usage" | Agent calls `self_introspect`; output includes the `memory_read` trace from step 1 with tool name, output summary, duration, and success=true |
| 3 | Verify in database: `SELECT tool_name, success, duration_ms, output_summary FROM operation_traces WHERE owner = 'spirit' ORDER BY created_at DESC LIMIT 5;` | Recent traces present with all fields populated; `output_summary` values are <= 500 characters |
| 4 | Send a message that triggers a web search likely to succeed, then one likely to fail (e.g., search for a nonsensical domain) | Both operations recorded as traces; failed one has `success=false` and `error` populated |

## Phase 3: Scheduler and Review Job (AC4.x, AC3.5, AC3.6)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon, check logs for scheduler registration | Log output includes "Scheduled review-predictions" or similar; `SELECT * FROM scheduled_tasks WHERE owner = 'spirit';` shows a row with `name = 'review-predictions'`, `schedule = '0 * * * *'` |
| 2 | Verify next_run_at is set to a future hourly boundary | `next_run_at` is within the next hour |
| 3 | To test without waiting an hour, manually advance the task: `UPDATE scheduled_tasks SET next_run_at = NOW() - INTERVAL '1 minute' WHERE name = 'review-predictions' AND owner = 'spirit';` | Task is now overdue |
| 4 | Wait up to 60 seconds (scheduler poll interval) | Scheduler fires the review event; logs show `[External Event: review-job]` being processed |
| 5 | Observe agent's response to the review event | Agent calls `list_predictions`, may call `annotate_prediction` for any pending ones, and writes a reflection to archival memory via `memory_write` |
| 6 | Verify reflection in archival memory: `SELECT content FROM memory_blocks WHERE owner = 'spirit' AND tier = 'archival' ORDER BY created_at DESC LIMIT 1;` | Contains a reflection block referencing the prediction review |
| 7 | Verify `next_run_at` advanced: `SELECT next_run_at, last_run_at FROM scheduled_tasks WHERE name = 'review-predictions' AND owner = 'spirit';` | `last_run_at` is recent; `next_run_at` is in the future (next hour boundary) |

## Phase 4: Context Provider Injection (AC5.x)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a few predictions via the REPL without evaluating them | Predictions in "pending" status |
| 2 | Send any message and observe the system prompt (enable debug logging if available, or check via `self_introspect` that the agent acknowledges pending predictions) | Agent's behaviour or self-reporting indicates awareness of pending predictions (e.g., mentions it has N pending predictions) |
| 3 | Evaluate all predictions, then send another message | No prediction journal line in system prompt (provider returns `undefined` for 0 pending) |

## End-to-End: Full Reflexion Cycle

**Purpose:** Validate the complete predict -> trace -> review -> reflect pipeline in a single session.

1. Start daemon fresh (`bun run start`)
2. Send: "I predict that if I ask you to write code, you'll use the execute_code tool. Record this prediction with confidence 0.9."
   - Expected: `predict` tool called, prediction ID returned
3. Send: "Write a Python function that computes the Fibonacci sequence and run it"
   - Expected: `execute_code` tool called with Python code
4. Send: "Check your recent operations with self_introspect"
   - Expected: Traces visible for both `predict` and `execute_code` calls
5. Send: "Now evaluate your prediction -- did you use execute_code?"
   - Expected: `annotate_prediction` called with `accurate: true`
6. Manually trigger the review job (see Phase 3, step 3)
7. Wait for review to fire
   - Expected: Agent processes review event, writes archival memory reflection covering the prediction evaluation
8. Verify archival memory contains reflection
9. Verify `operation_traces` table has entries for all tool calls in this session

## End-to-End: Zero-Predictions Review (AC3.6)

**Purpose:** Validate that the review job produces a reflection even when no predictions exist.

1. Start daemon with a clean database (no pending predictions for the agent's owner)
2. Confirm: `SELECT count(*) FROM predictions WHERE owner = 'spirit' AND status = 'pending';` returns 0
3. Manually trigger the review job by advancing `next_run_at`
4. Wait for scheduler tick (up to 60 seconds)
   - Expected: Logs show review event processed; agent writes to archival memory
5. Verify: `SELECT content FROM memory_blocks WHERE owner = 'spirit' AND tier = 'archival' ORDER BY created_at DESC LIMIT 1;`
   - Expected: Reflection content references the absence of predictions and considers whether predictions should be made going forward

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC3.5 | Requires live LLM reasoning: the agent must interpret the review prompt, evaluate predictions, and decide what to write | Phase 3, steps 3-6; E2E Full Reflexion steps 6-8 |
| AC3.6 | Requires live LLM: the review event content includes zero-predictions guidance, but the agent's compliance depends on model reasoning | E2E Zero-Predictions Review steps 1-5 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `prediction-store.test.ts`, `tools.test.ts` | Phase 1, steps 2-3 |
| AC1.2 | `prediction-store.test.ts` | N/A (multi-agent not tested manually) |
| AC1.3 | `tools.test.ts` | Phase 1, step 2 |
| AC1.4 | `prediction-store.test.ts` | Phase 1, steps 3, 6 |
| AC1.5 | `prediction-store.test.ts` | Phase 1, step 2 (optional fields) |
| AC2.1 | `trace-recorder.test.ts`, `trace-capture.test.ts` | Phase 2, steps 1-3 |
| AC2.2 | `trace-recorder.test.ts`, `trace-capture.test.ts` | Phase 2, step 4 |
| AC2.3 | `trace-recorder.test.ts` | Phase 2, step 3 (DB check) |
| AC2.4 | `trace-recorder.test.ts`, `trace-capture.test.ts` | N/A (resilience tested in automation) |
| AC2.5 | `introspection-tools.test.ts` | Phase 2, step 2 |
| AC2.6 | `introspection-tools.test.ts` | Phase 2, step 2 (implicit) |
| AC2.7 | `introspection-tools.test.ts` | Phase 2, step 2 (first session) |
| AC3.1 | `tools.test.ts` | Phase 1, step 5 |
| AC3.2 | `prediction-store.test.ts` | Phase 1, steps 5-7 |
| AC3.3 | `tools.test.ts` | N/A (error path, automated) |
| AC3.4 | `prediction-store.test.ts`, `index.wiring.test.ts` | Phase 3, step 5 (implicit via review) |
| AC3.5 | N/A (human verification) | Phase 3, steps 3-6; E2E Full Reflexion steps 6-8 |
| AC3.6 | N/A (human verification) | E2E Zero-Predictions Review steps 1-5 |
| AC4.1 | `postgres-scheduler.test.ts` | Phase 3, steps 1-2 |
| AC4.2 | `postgres-scheduler.test.ts` | Phase 3, steps 3-4 |
| AC4.3 | `postgres-scheduler.test.ts` | Phase 3, step 7 |
| AC4.4 | `postgres-scheduler.test.ts` | N/A (cancellation automated) |
| AC4.5 | `postgres-scheduler.test.ts` | Phase 3, step 3-4 (simulates missed tick) |
| AC4.6 | `index.wiring.test.ts` | Phase 3, step 1 |
| AC5.1 | `context-provider.test.ts`, `context-providers.test.ts` | Phase 4, steps 1-2 |
| AC5.2 | `context-provider.test.ts` | Phase 4, step 3 |
| AC5.3 | `index.wiring.test.ts` | Phase 3, step 1 (daemon starts) |
