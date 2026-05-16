# Cache-Bust Detection — Human Test Plan

## Prerequisites
- Bun installed and working
- `bun run build` passes (confirms AC5.3 type-level config field)
- `bun test src/agent/cache-diagnostics.test.ts` passes on local machine
- `bun test src/agent/agent.test.ts` passes on local machine

## Phase 1: Config Schema Verification (AC5.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/config/schema.ts` in editor | File exists and is readable |
| 2 | Search for `cache_diagnostics` in the file | Field exists inside the `AgentConfigSchema` (which maps to the `[agent]` TOML section) |
| 3 | Verify the field definition is `z.boolean().default(true)` or equivalent | Default value is `true`, type is boolean |
| 4 | Open `config.example.toml` (if it exists) | Check for `cache_diagnostics = true` under `[agent]` section. If file does not exist, note this and move on — it is not a blocker |
| 5 | Run `bun run build` | Exit code 0, no type errors. This confirms that `AgentConfig` includes `cache_diagnostics` and the agent code references it correctly |

## Phase 2: Performance Benchmark Verification (AC6.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/agent/cache-diagnostics.test.ts` on the deployment target machine (not just local dev) | All tests pass, including the "100 successive checks average under 5ms" benchmark |
| 2 | If the benchmark test fails, note the average time reported | Determine whether the failure is environment-specific (slow CI runner, resource contention) or algorithmic (e.g., a regression in hashing performance) |
| 3 | Run the benchmark test 3 times in sequence | Results should be consistent. If the average fluctuates wildly (e.g., 2ms then 15ms), the test may be flaky due to GC pressure or system load |

## End-to-End: Cache-Bust Detection in Live Agent Loop

Purpose: Validate that cache-bust detection works end-to-end in a running agent, not just in isolated unit tests.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon with `bun run start` (ensure `cache_diagnostics` is true or omitted in config.toml) | Daemon starts without errors |
| 2 | Send a message to the agent via the REPL | Agent responds normally. No cache-bust warnings in console output (first turn has no baseline) |
| 3 | Send a second message with no config changes | Agent responds normally. No cache-bust warnings (nothing changed between turns) |
| 4 | While the agent is running, modify a memory block that alters the system prompt (e.g., edit a core memory block) | On the next turn, a console warning about `system_prompt` dimension change should appear, and a trace with `toolName: 'cache_diagnostics'` should be recorded to the database |
| 5 | Trigger a compaction (either automatically via budget or by the agent calling `compact_context`) | After compaction, the next turn should NOT produce cache-bust warnings for `system_prompt` or `message_prefix` dimensions (suppression flags should be set) |

## End-to-End: Config Gating Disables All Diagnostics

Purpose: Validate that setting `cache_diagnostics = false` in config.toml completely disables cache-bust detection.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set `cache_diagnostics = false` under `[agent]` in config.toml | Config file saved |
| 2 | Start the daemon with `bun run start` | Daemon starts without errors |
| 3 | Send multiple messages, including ones that would trigger cache busts (e.g., modify memory blocks between turns) | No cache-bust console warnings appear at any point. No `cache_diagnostics` traces recorded in the operation_traces table |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC5.3 | Config field placement and TOML rendering are structural concerns best verified by reading the schema source and running the build | See Phase 1 steps 1-5 above |
| AC6.1 | The 5ms threshold is environment-dependent; CI runners and production hardware have different performance profiles | See Phase 2 steps 1-3 above |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `cache-diagnostics.test.ts` AC1.1 | — |
| AC1.2 | `cache-diagnostics.test.ts` AC1.2 | — |
| AC1.3 | `cache-diagnostics.test.ts` AC1.3 | — |
| AC1.4 | `cache-diagnostics.test.ts` AC1.4 | — |
| AC1.5 | `cache-diagnostics.test.ts` AC1.5 | — |
| AC2.1 | `cache-diagnostics.test.ts` AC2.1 | — |
| AC2.2 | `cache-diagnostics.test.ts` AC2.2 | — |
| AC2.3 | `cache-diagnostics.test.ts` AC2.3 | — |
| AC2.4 | `cache-diagnostics.test.ts` AC2.4 | — |
| AC2.5 | `cache-diagnostics.test.ts` AC2.5 | — |
| AC3.1 | `cache-diagnostics.test.ts` AC3.1 | — |
| AC3.2 | `cache-diagnostics.test.ts` AC3.2 | — |
| AC3.3 | `cache-diagnostics.test.ts` AC3.3 | — |
| AC3.4 | `cache-diagnostics.test.ts` AC3.4 | — |
| AC3.5 | `cache-diagnostics.test.ts` AC3.5 | — |
| AC4.1 | `cache-diagnostics.test.ts` + `agent.test.ts` AC4.1 | — |
| AC4.2 | `cache-diagnostics.test.ts` + `agent.test.ts` AC4.2 | — |
| AC4.3 | `cache-diagnostics.test.ts` + `agent.test.ts` AC4.3 | — |
| AC5.1 | `agent.test.ts` AC5.1 | — |
| AC5.2 | `cache-diagnostics.test.ts` + `agent.test.ts` AC5.2 | — |
| AC5.3 | `bun run build` (type-check) | Phase 1 steps 1-5 |
| AC6.1 | `cache-diagnostics.test.ts` AC6.1 | Phase 2 steps 1-3 |
| AC6.2 | `cache-diagnostics.test.ts` AC6.2 | — |
| AC6.3 | `cache-diagnostics.test.ts` AC6.3 | — |
