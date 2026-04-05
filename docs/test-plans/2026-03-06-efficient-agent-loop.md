# Human Test Plan — Efficient Agent Loop

Generated from test-requirements.md after automated coverage validation passed.

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Bluesky credentials configured in `config.toml` (`bluesky.enabled = true`, valid DID/handle/tokens)
- Scheduler configured with `review-predictions` task
- Circadian schedule configured (sleep/wake crons)
- All automated tests passing: `bun test src/reflexion/review-gate.test.ts src/extensions/data-source-registry.test.ts src/activity/activity-interceptor.test.ts src/index.wiring.test.ts src/agent/agent.test.ts`

## Phase 1: Single-Agent Topology (AC2.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun run start` to start the daemon | Agent starts without errors. Logs show a single agent creation with one conversation ID. No log line containing `blueskyAgent`. |
| 2 | Send a message via the REPL (e.g., "Hello, what is your name?") | Agent responds in the REPL. Response is persisted to the database. |
| 3 | Wait for a scheduler event to fire (or trigger one manually by setting a short cron interval) | Logs show the scheduler event processed by the same agent. Check logs for `[scheduler]` lines. |
| 4 | If Bluesky is enabled, wait for or trigger an inbound Bluesky post from a followed account | Logs show a `[registry]` event. The event is processed by the same agent. |
| 5 | Query the database: `SELECT DISTINCT conversation_id FROM messages WHERE owner = '<agent-owner>'` | Exactly one active conversation ID is returned, confirming all three event sources (REPL, scheduler, Bluesky) feed the same conversation. |

## Phase 2: Bluesky End-to-End (AC4.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon with Bluesky enabled (`bun run start`) | Logs show `[bluesky] Connected to Jetstream` or equivalent connection message. Logs show `[registry] bluesky` indicating the source was registered via the DataSource registry. |
| 2 | From a Bluesky account followed by the agent, create a post that the agent should see | Logs show the inbound event arriving through the registry (`[registry] bluesky event` or the activity interceptor queuing it). |
| 3 | Observe the agent processing the event | The agent's LLM response appears in logs. The agent reads bluesky templates from memory (`memory_read` tool call visible in traces or logs). |
| 4 | If the agent decides to reply, verify the reply appears on Bluesky | Check the agent's Bluesky profile (via app or AT Protocol API) for the new post/reply. Confirm the content is coherent and the reply threading (parent_uri, root_uri) is correct. |
| 5 | Verify the `[Instructions:]` block was present in the formatted event | Enable debug logging or check traces. The formatted event sent to the LLM should contain `[Instructions: To respond to this post, use memory_read to find your bluesky templates...]`. This confirms AC2.4's source instructions lookup is working end-to-end. |

## Phase 3: Prediction Journaling Smoke Test (AC4.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon (`bun run start`) | Agent starts normally. |
| 2 | Via REPL, ask: "Make a prediction about whether it will rain tomorrow in Vancouver" | Agent calls the `predict` tool. Logs show tool dispatch. No errors. Response confirms the prediction was recorded. |
| 3 | Via REPL, ask: "List your current predictions" | Agent calls `list_predictions` tool. Response shows the prediction from step 2 with status `pending`. |
| 4 | Via REPL, ask: "Annotate that prediction as correct with outcome 'it did rain'" | Agent calls `annotate_prediction` tool. Response confirms the prediction was evaluated. |
| 5 | Via REPL, ask: "List your predictions again" | The previously pending prediction now shows status `evaluated`. |

## Phase 4: Sleep Task Firing (AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon and either wait for the circadian sleep trigger or manually invoke sleep transition (e.g., by adjusting the sleep cron to fire soon) | Logs show `[activity] transitioning to sleeping`. |
| 2 | Observe logs during the sleep period | Within the sleep window, logs should show `sleep-compaction`, `sleep-prediction-review`, and `sleep-pattern-analysis` tasks firing at their configured offsets. Each should complete without errors. |
| 3 | Wait for or trigger the wake transition | Logs show `[activity] transitioning to active`. Any queued events during sleep begin draining. |
| 4 | Verify normal operation resumes | Send a REPL message. Agent responds normally. Scheduler events continue processing. |

## End-to-End: Idle Review Gate (AC1.1, AC1.2, AC1.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon. Do NOT interact with it for at least one review-predictions cycle (default: 1 hour). | When the review-predictions scheduler task fires, logs should show a skip message (e.g., `[review-gate] skipping review-predictions: no agent-initiated traces since last window`). No LLM call is made. |
| 2 | Interact with the agent via REPL -- perform several actions that trigger tool calls (memory writes, code execution, etc.) | Agent processes the messages normally, generating operation traces. |
| 3 | Wait for the next review-predictions cycle | The review event fires normally. Logs show the agent receiving the review event with `[Recent Activity]` section containing the tools from step 2. The agent calls `list_predictions` and potentially `annotate_prediction`. |

## End-to-End: Registry Shutdown Resilience (AC2.5)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon with Bluesky enabled | Agent starts with registry connected. |
| 2 | Terminate the Bluesky Jetstream connection externally (e.g., network disruption, firewall rule) | The Bluesky source should handle the disconnection gracefully. Logs may show reconnection attempts. |
| 3 | Shut down the daemon (Ctrl+C or SIGTERM) | Shutdown handler runs. Logs show `[registry] disconnected bluesky` or an error message for bluesky disconnect followed by successful cleanup of other resources. The daemon exits cleanly without crash. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `src/reflexion/review-gate.test.ts` (unit), `src/index.wiring.test.ts` (integration) | Idle Review Gate step 3 |
| AC1.2 | `src/reflexion/review-gate.test.ts` (unit), `src/index.wiring.test.ts` (integration) | Idle Review Gate step 1 |
| AC1.3 | `src/reflexion/review-gate.test.ts` (unit, architectural invariant) | Idle Review Gate step 1 |
| AC2.1 | `src/index.wiring.test.ts` (registry shutdown, processEventQueue export) | Phase 1 steps 1-5 |
| AC2.2 | `src/index.wiring.test.ts` (structural grep) | -- |
| AC2.3 | `src/extensions/data-source-registry.test.ts` (event routing) | Phase 2 step 2 |
| AC2.4 | `src/agent/agent.test.ts` (sourceInstructions lookup), `src/index.wiring.test.ts` | Phase 2 step 5 |
| AC2.5 | `src/extensions/data-source-registry.test.ts` (shutdown + error resilience) | Registry Shutdown Resilience |
| AC3.1 | `src/activity/activity-interceptor.test.ts` (generic filter) | -- |
| AC3.2 | `src/activity/activity-interceptor.test.ts` (DID filter) | Phase 2 step 2 |
| AC4.1 | Compositional (AC2.3 + AC3.2 + existing source tests) | Phase 2 steps 1-5 |
| AC4.2 | Existing tests in `src/reflexion/` (unchanged) | Phase 3 steps 1-5 |
| AC4.3 | Existing tests in `src/activity/` (unchanged) | Phase 4 steps 1-4 |
