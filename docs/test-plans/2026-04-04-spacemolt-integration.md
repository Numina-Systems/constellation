# SpaceMolt Integration — Human Test Plan

## Prerequisites
- PostgreSQL running with pgvector (`docker compose up -d`)
- Valid SpaceMolt credentials configured in `config.toml` under `[spacemolt]` or via `SPACEMOLT_USERNAME` / `SPACEMOLT_PASSWORD` env vars
- `bun test src/extensions/spacemolt/ src/config/schema.test.ts src/config/env-override.test.ts` all passing (215 tests, 0 failures)

## Phase 1: Connection and Authentication

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set `[spacemolt] enabled = true` with valid `username`, `password` in `config.toml`. Run `bun run start`. | Daemon starts without errors. |
| 2 | Watch stdout/stderr for SpaceMolt connection log lines. | Log message: `"SpaceMolt connected: N tools discovered"` (where N > 0). |
| 3 | Check that the WebSocket connection is established. | No `WebSocket error` or `authentication failed` lines in logs. |
| 4 | Observe the reported game state after login. | Log indicates initial state is either `DOCKED` or `UNDOCKED` depending on where the character currently is. |

## Phase 2: MCP Tool Discovery and Execution

| Step | Action | Expected |
|------|--------|----------|
| 1 | After successful connection, note the tool count in the startup log. | Tool count matches what the SpaceMolt MCP server actually exposes. |
| 2 | In the REPL, ask the agent to run `spacemolt:get_status`. | Agent invokes the tool. Response contains current player status (location, credits, ship info). No `session_invalid` error. |
| 3 | Ask the agent to list available SpaceMolt tools. | Agent shows only tools appropriate for the current game state (e.g., if docked, shows `buy`/`sell`/`repair`/`undock` but not `mine`/`attack`). |

## Phase 3: Game State Transitions and Tool Cycling

| Step | Action | Expected |
|------|--------|----------|
| 1 | While docked, ask the agent to undock. | Agent calls `spacemolt:undock`. State transitions to `UNDOCKED`. Next tool listing shows undocked tools (`mine`, `travel`, `dock`) instead of docked tools (`buy`, `sell`). |
| 2 | While undocked, ask the agent to travel to a known location. | Agent calls `spacemolt:travel`. State transitions to `TRAVELING`. Tool listing reduces to travel-appropriate tools (`get_system`, `get_poi`) plus always-tools. |
| 3 | After arrival, ask the agent to dock at a station. | Agent calls `spacemolt:dock`. State transitions to `DOCKED`. Docked tools reappear (`buy`, `sell`, `repair`). |
| 4 | If combat is encountered (or can be provoked), observe state change. | State transitions to `COMBAT`. Tool listing shows combat tools (`attack`, `scan`, `cloak`). Non-combat tools (`buy`, `mine`) disappear. |

## Phase 4: Activity Cycle Integration

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure `[activity]` with a sleep schedule that triggers within a few minutes. Start the daemon. | Daemon logs show SpaceMolt connected on wake. |
| 2 | Wait for the sleep window to begin. | Logs show SpaceMolt disconnecting. WebSocket closes. No reconnection attempts after close. |
| 3 | Wait for the wake window to resume. | Logs show SpaceMolt reconnecting. New tool discovery occurs. Game state re-initialized from `logged_in` response. |

## Phase 5: Session Expiry Recovery

| Step | Action | Expected |
|------|--------|----------|
| 1 | Connect to SpaceMolt. Leave the daemon idle for 30+ minutes (or however long the game server's session timeout is). | No activity during this period. |
| 2 | After the idle period, ask the agent to execute any `spacemolt:` tool (e.g., `spacemolt:get_status`). | First attempt may fail with `session_invalid`. Logs show automatic reconnection (re-login via MCP). Retry succeeds. Agent receives valid tool result. |
| 3 | Verify no double-reconnection or error cascade. | Single reconnection event in logs. No repeated `session_invalid` failures after successful reconnect. |

## End-to-End: Full Session Lifecycle

1. Start with a clean config: `[spacemolt] enabled = true`, valid credentials, activity cycle configured with a 2-hour wake window.
2. On startup, verify: SpaceMolt connects, tools discovered, capabilities memory block seeded (check via `memory_read` for `spacemolt:capabilities`).
3. Play a short session: undock, travel, mine, dock, buy/sell. Verify tool cycling works correctly at each state transition.
4. Wait for sleep cycle. Verify clean disconnection.
5. Wait for wake cycle. Verify reconnection and tool re-discovery.
6. Disable SpaceMolt (`enabled = false`), restart daemon. Verify no SpaceMolt-related log lines, no SpaceMolt tools registered.

## End-to-End: Prediction Journaling Integration

1. Connect to SpaceMolt with a fresh memory store.
2. Verify `spacemolt:capabilities` block exists in working memory and mentions prediction journaling.
3. Ask the agent to make a prediction about a trade (e.g., "predict that iron prices will rise at Station X").
4. Verify the agent uses `annotate_prediction` or `memory_write` to record the prediction.
5. After some gameplay, ask the agent to review its predictions. Verify it can retrieve and reflect on them.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC4.1 (partial) | Mocks verify message format but not actual server handshake | Phase 1, Steps 1-3 |
| AC2.1 (partial) | Mocks verify translation but not real schema compatibility | Phase 2, Steps 1-2 |
| AC5.1/AC5.2 (partial) | Lifecycle tested with mocks; real wiring depends on ActivityManager | Phase 4, Steps 1-3 |
| AC5.3 (partial) | Real expiry depends on server timeout and actual error format | Phase 5, Steps 1-3 |
| AC7.4 (partial) | Real gameplay may have different payload shapes | Phase 3, Steps 1-4 |

## Traceability

| AC | Automated Test | Manual Step |
|----|---------------|-------------|
| AC1.1 | `schema.test.ts` | -- |
| AC1.2 | `env-override.test.ts` | -- |
| AC1.3 | `env-override.test.ts` | -- |
| AC1.4 | `schema.test.ts` | -- |
| AC2.1 | `tool-provider.test.ts` | Phase 2, Step 1 |
| AC2.2 | `schema.test.ts` | -- |
| AC2.3 | `schema.test.ts` | -- |
| AC2.4 | `tool-provider.test.ts` | Phase 2, Step 2 |
| AC2.5 | `schema.test.ts` | -- |
| AC2.6 | `tool-provider.test.ts` | -- |
| AC3.1 | `state.test.ts` | Phase 1, Step 4 |
| AC3.2 | `state.test.ts` | Phase 3, Step 4 |
| AC3.3 | `state.test.ts` | Phase 3, Step 2 |
| AC3.4 | `tool-filter.test.ts` | Phase 3, Step 1 |
| AC3.5 | `tool-filter.test.ts` | Phase 2, Step 3 |
| AC3.6 | `tool-cycling.test.ts` | Phase 3, Steps 1-4 |
| AC3.7 | `tool-cycling.test.ts` | -- |
| AC4.1 | `source.test.ts` | Phase 1, Steps 1-3 |
| AC4.2 | `events.test.ts` | Phase 3, Step 4 |
| AC4.3 | `events.test.ts` | -- |
| AC4.4 | `source.test.ts` | -- |
| AC4.5 | `events.test.ts` | Phase 3, Step 4 |
| AC4.6 | `source.test.ts` | -- |
| AC5.1 | `lifecycle.test.ts` | Phase 4, Step 1 |
| AC5.2 | `lifecycle.test.ts` | Phase 4, Step 2 |
| AC5.3 | `tool-provider.test.ts` | Phase 5, Steps 1-3 |
| AC5.4 | `source.test.ts` | Phase 4, Step 2 |
| AC6.1 | `seed.test.ts` | E2E Lifecycle, Step 2 |
| AC6.2 | `seed.test.ts` | -- |
| AC6.3 | `seed.test.ts` | E2E Prediction, Steps 2-4 |
| AC7.1 | `wiring.test.ts` | Phase 1, Steps 1-2 |
| AC7.2 | `wiring.test.ts` | Phase 1, Step 2 |
| AC7.3 | `wiring.test.ts` | -- |
| AC7.4 | `wiring.test.ts` | Phase 3, Steps 1-4 |
| AC7.5 | `wiring.test.ts` | E2E Lifecycle, Step 6 |
