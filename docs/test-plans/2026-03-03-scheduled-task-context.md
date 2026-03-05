# Human Test Plan: Scheduled Task Context Hydration

## Prerequisites

- PostgreSQL with pgvector running (`docker compose up -d`)
- Environment variables configured (`DATABASE_URL`, `ANTHROPIC_API_KEY`, etc.)
- All tests passing:
  ```
  bun test src/scheduled-context.test.ts src/index.wiring.test.ts
  ```
  Expected: 39 pass, 0 fail

## Phase 1: Scheduled Task Context Formatting (Unit Behaviour)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/scheduled-context.test.ts` | 9 tests pass. No failures. |
| 2 | Inspect test output for the `formatTraceSummary` tests | Each test name references its AC (AC1.3, AC3.1, AC3.2, AC3.3) |

## Phase 2: Integration Wiring (Event Builders)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/index.wiring.test.ts` | 30 tests pass. No failures. |
| 2 | Verify the `buildReviewEvent` trace enrichment tests (search for "AC1.1" in output) | Tests confirm `[Recent Activity]` section, `limit: 20`, and 2-hour lookback window |
| 3 | Verify the `buildAgentScheduledEvent` tests (search for "AC1.2" in output) | Tests confirm `source: 'agent-scheduled'`, `[Recent Activity]` section, task name in content, metadata spread |

## Phase 3: Live Daemon Smoke Test

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon with `bun run start` | Console prints "scheduler started", "review job scheduled (hourly)" or "review job already scheduled" |
| 2 | Type a message in the REPL, e.g., `hello` | Agent responds. Response does NOT contain `[Recent Activity]` anywhere. |
| 3 | Wait for the scheduler to fire (or manually adjust the review-predictions cron to `* * * * *` for testing), then observe console output | Console logs show `[scheduler] agent response:` indicating the review event was processed. The event content sent to the agent contains `[Recent Activity]` followed by either formatted trace lines or "No recent activity recorded." |
| 4 | If Bluesky is enabled, trigger a Bluesky notification (e.g., mention the agent) | The Bluesky event is processed via `processEventQueue`. The event content does NOT contain `[Recent Activity]`. |
| 5 | Send `Ctrl+C` to trigger shutdown | Console prints "scheduler stopped", "Shutting down..." and daemon exits cleanly. |

## End-to-End: Full Trace Lifecycle Through Scheduled Review

**Purpose:** Validate that traces recorded during normal agent operation appear in the next scheduled review event.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon with `bun run start` | Daemon starts, scheduler running |
| 2 | Issue a command that triggers tool use, e.g., `search for recent news about TypeScript` | Agent uses `web_search` tool. A trace is recorded to the database. |
| 3 | Issue another command, e.g., `remember that I prefer dark mode` | Agent uses `memory_write` tool. Another trace is recorded. |
| 4 | Wait for the next hourly review job to fire (or temporarily set cron to `* * * * *`) | Review event fires. Console shows agent processing the review. |
| 5 | Check agent output for the review response | Agent's response references the `[Recent Activity]` section. The section should show both `web_search` and `memory_write` traces with timestamps, success indicators, and truncated output summaries. |

## End-to-End: Agent-Scheduled Task with Context

**Purpose:** Validate that agent-created scheduled tasks also receive trace context.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon, create some tool activity as above | Traces exist in the database |
| 2 | Have the agent schedule a custom task (via scheduler tool if available, or insert one manually into `scheduled_tasks` table) | Task exists with a non-`review-predictions` name |
| 3 | Wait for the custom task to fire | Event is built via `buildAgentScheduledEvent`. Content contains `[Recent Activity]` section with recent traces. Event `source` is `'agent-scheduled'`. |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC2.1: REPL messages exclude trace sections | Cannot be fully automated because REPL flow depends on process-level stdin/stdout wiring | 1. Start daemon with `bun run start`. 2. Send any message (e.g., `what time is it?`). 3. Inspect the agent's response text -- it must NOT contain `[Recent Activity]` or trace formatting. 4. Confirm `createInteractionLoop` in `src/index.ts` calls only `agent.processMessage()` and never `buildReviewEvent` or `buildAgentScheduledEvent`. |
| AC2.2: Bluesky events exclude trace sections | Bluesky event construction happens in the `onMessage` handler which constructs raw `IncomingMessage` values without calling either event builder | 1. Confirm no references to `buildReviewEvent` or `buildAgentScheduledEvent` exist in `src/extensions/bluesky/`. 2. In `src/index.ts`, confirm the `blueskySource.onMessage` handler pushes raw `message` objects without enrichment. 3. If Bluesky is enabled, trigger a notification and verify the processed event has no `[Recent Activity]` section. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 -- Review event [Recent Activity] | `src/index.wiring.test.ts` "AC1.1: includes [Recent Activity] section..." | Phase 3 Step 3 |
| AC1.2 -- Agent-scheduled event [Recent Activity] | `src/index.wiring.test.ts` "AC1.2: includes [Recent Activity] section..." | E2E: Agent-Scheduled Task |
| AC1.3 -- Empty traces fallback | `src/scheduled-context.test.ts` "AC1.3" + `src/index.wiring.test.ts` "AC1.3" (x2) | Phase 3 Step 3 (first run, no traces) |
| AC1.4 -- Max 20 traces | `src/index.wiring.test.ts` "AC1.4: queries traces with limit 20" | -- |
| AC1.5 -- 2-hour lookback | `src/index.wiring.test.ts` "AC1.5: queries traces with lookbackSince..." | -- |
| AC2.1 -- REPL excludes traces | Design verification (code path) | Human Verification: AC2.1 |
| AC2.2 -- Bluesky excludes traces | Design verification (code path) | Human Verification: AC2.2 |
| AC3.1 -- Trace line format | `src/scheduled-context.test.ts` "AC3.1" (x3) | Phase 3 Step 3 (visual inspection) |
| AC3.2 -- 80-char truncation | `src/scheduled-context.test.ts` "AC3.2" (x2) | -- |
| AC3.3 -- Newest-first order | `src/scheduled-context.test.ts` "AC3.3" | E2E: Full Trace Lifecycle Step 5 |
