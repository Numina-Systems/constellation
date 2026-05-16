# Output Loop Detection — Human Test Plan

## Prerequisites
- Constellation running locally (`bun run start`)
- Config file accessible with `[loop_detection]` section
- `bun test src/loop-detection/` passing (77 tests, 0 failures)

## Phase 1: Warn Action Dispatch

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml`: set `[loop_detection]` to `enabled = true`, `consecutive_trigger = 2`, `action = "warn"` | Config loads without error |
| 2 | Start agent: `bun run start` | REPL launches, no config errors |
| 3 | Enter a prompt that produces repetitive output (e.g., "Say exactly: I cannot help with that.") | Agent responds with the phrase |
| 4 | Repeat the same prompt 2 more times | Agent responds identically each time |
| 5 | On the 3rd repetitive response, observe agent output | A system-injected warning message appears in the conversation context indicating loop detected. Agent continues generating (not halted). |

## Phase 2: Redirect Action Dispatch

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml`: set `action = "redirect"` | Config loads without error |
| 2 | Restart agent: `bun run start` | REPL launches |
| 3 | Enter a prompt that produces repetitive output 3+ times | Agent responds identically |
| 4 | Observe agent output after trigger threshold | A system message appears with loop warning AND a redirect hint suggesting the agent try a different approach. Agent continues generating. |

## Phase 3: Halt Action Dispatch

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml`: set `action = "halt"` | Config loads without error |
| 2 | Restart agent: `bun run start` | REPL launches |
| 3 | Enter a prompt that produces repetitive output 3+ times | Agent responds identically |
| 4 | Observe agent output after trigger threshold | Agent turn ends immediately with a "stuck" message. No further generation occurs for that turn. Control returns to user. |

## End-to-End: Loop Detection Through Full Agent Cycle

**Purpose:** Validate that the loop detector integrates correctly with the agent loop, including trace recording and window reset on new conversations.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set config: `consecutive_trigger = 2`, `action = "warn"`, `enabled = true` | -- |
| 2 | Start agent, trigger a loop (3 identical responses) | Warning injected |
| 3 | Query traces: check for `loop_detection` trace in recent operation traces | Trace exists with `similarity >= 0.85`, `consecutiveCount >= 2`, `action: "warn"` |
| 4 | Send a genuinely different prompt after warning | Agent responds normally without loop warning (counter reset) |
| 5 | Set `enabled = false` in config, restart | -- |
| 6 | Repeat step 2's repetitive prompts | No warning injected, no halt, no trace recorded |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC4.1 dispatch (warn injects message) | Requires full agent loop with model inference; message injection into conversation context not unit-testable | Phase 1 steps 3-5 |
| AC4.2 dispatch (redirect appends hint) | Redirect hint content depends on agent prompt construction | Phase 2 steps 3-4 |
| AC4.3 dispatch (halt ends turn) | Turn termination logic couples to agent loop control flow | Phase 3 steps 3-4 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1-AC1.5 | `src/loop-detection/similarity.test.ts` | -- |
| AC2.1-AC2.4 | `src/loop-detection/window.test.ts` | -- |
| AC3.1-AC3.4 | `src/loop-detection/window.test.ts` | -- |
| AC4.1 (result) | `src/loop-detection/detector.test.ts` | -- |
| AC4.2 (result) | `src/loop-detection/detector.test.ts` | -- |
| AC4.3 (result) | `src/loop-detection/detector.test.ts` | -- |
| AC4.1 (dispatch) | -- | Phase 1, step 5 |
| AC4.2 (dispatch) | -- | Phase 2, step 4 |
| AC4.3 (dispatch) | -- | Phase 3, step 4 |
| AC5.1-AC5.3 | `src/loop-detection/detector.test.ts` | End-to-End step 3 |
| AC6.1-AC6.6 | `src/loop-detection/detector.test.ts` | End-to-End steps 5-6 |
| AC7.1-AC7.3 | `src/loop-detection/similarity.test.ts`, `src/loop-detection/strip-quotes.test.ts` | -- |
