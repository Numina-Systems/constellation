# MCP Client Integration -- Test Requirements

Maps each acceptance criterion from the [design plan](../../design-plans/2026-04-05-mcp-client.md) to automated tests or documented human verification.

## Automated Tests

### AC1: MCP servers configured in config.toml

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC1.1 | Stdio server config with command, args, and env parses correctly | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.2 | HTTP server config with url parses correctly | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.3 | Multiple servers of mixed transport types parse correctly | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.4 | Stdio config missing `command` is rejected | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.5 | HTTP config missing `url` is rejected | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.6 | Unknown transport type is rejected | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.7 | Empty servers map with `enabled = true` is valid | Unit | `src/mcp/schema.test.ts` | Phase 1 / Task 7 |
| AC1.8 | Env vars with `${VAR}` syntax are expanded from process.env | Unit | `src/mcp/env.test.ts` | Phase 1 / Task 7 |

### AC2: Stdio servers spawned on startup, killed on shutdown

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC2.1 | Stdio server process is spawned via StdioClientTransport on connect | Unit | `src/mcp/client.test.ts` | Phase 2 / Task 5 |
| AC2.2 | Process env merges config env with process.env (SDK bug workaround) | Unit | `src/mcp/client.test.ts` | Phase 2 / Task 5 |

The `buildTransportOptions` pure function is tested to verify correct transport object construction and env merging. Actual process spawn is verified manually (see Human Verification section).

### AC3: HTTP servers connected on startup

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC3.1 | HTTP server is connected via StreamableHTTPClientTransport | Unit | `src/mcp/client.test.ts` | Phase 2 / Task 5 |

The `buildTransportOptions` pure function is tested to verify correct URL construction. Actual HTTP connection is verified manually.

### AC4: Tools discovered and registered with namespacing

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC4.1 | MCP tools registered as `mcp_{server}_{tool}` in tool registry | Unit | `src/mcp/provider.test.ts` | Phase 3 / Tasks 4-5 |
| AC4.2 | Tool descriptions prefixed with `[MCP: {server}]` | Unit | `src/mcp/provider.test.ts` | Phase 3 / Task 5 |
| AC4.3 | Tool execution dispatches with original (unnamespaced) tool name | Unit | `src/mcp/provider.test.ts` | Phase 3 / Tasks 4-5 |
| AC4.4 | JSON Schema input_schema maps to ToolParameter[] (all types, enums) | Unit | `src/mcp/schema-mapper.test.ts` | Phase 3 / Task 2 |
| AC4.5 | Tool results map ContentBlock[] text to ToolResult.output | Unit | `src/mcp/client.test.ts` | Phase 2 / Task 3 |
| AC4.6 | Tool call to disconnected server returns `{ success: false }` | Unit | `src/mcp/client.test.ts` | Phase 2 / Tasks 3-4 |
| AC4.7 | MCP tool returning isError maps to `{ success: false }` | Unit | `src/mcp/client.test.ts` | Phase 2 / Task 3 |

### AC5: Prompts surfaced through skill system

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC5.1 | MCP prompts appear as SkillDefinitions with source `'mcp'` | Unit | `src/mcp/skill-adapter.test.ts` | Phase 4 / Task 4 |
| AC5.2 | Virtual skills have correct IDs and kebab-case names | Unit | `src/mcp/skill-adapter.test.ts` | Phase 4 / Task 4 |
| AC5.3 | Virtual skills appear in skill_list and skill_read output | Unit | `src/skill/registry.test.ts` or `src/mcp/skill-inject.test.ts` | Phase 4 / Task 6 |
| AC5.4 | Virtual skills participate in semantic search (embedding upserted) | Unit | `src/skill/registry.test.ts` or `src/mcp/skill-inject.test.ts` | Phase 4 / Task 6 |
| AC5.5 | skill_create rejects creating a skill with source `'mcp'` | Unit | `src/skill/tools.test.ts` or `src/mcp/skill-guard.test.ts` | Phase 4 / Task 5 |
| AC5.6 | skill_update rejects updating a skill with source `'mcp'` | Unit | `src/skill/tools.test.ts` or `src/mcp/skill-guard.test.ts` | Phase 4 / Task 5 |

### AC6: Graceful degradation

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC6.1 | Agent starts normally when all MCP servers connect | Unit | `src/mcp/startup.test.ts` | Phase 5 / Task 7 |
| AC6.3 | Agent starts normally when one MCP server fails (others still registered) | Unit | `src/mcp/startup.test.ts` | Phase 5 / Task 7 |
| AC6.4 | All MCP servers failing doesn't block agent startup | Unit | `src/mcp/startup.test.ts` | Phase 5 / Task 7 |

### AC7: Server instructions as context

| Criterion | Description | Test Type | Test File | Phase/Task |
|-----------|-------------|-----------|-----------|------------|
| AC7.1 | Server instructions from getInstructions() appended to system prompt | Unit | `src/mcp/startup.test.ts` | Phase 5 / Task 7 |
| AC7.2 | Server with no instructions contributes nothing to system prompt | Unit | `src/mcp/client.test.ts`, `src/mcp/startup.test.ts` | Phase 2 / Task 4, Phase 5 / Task 7 |

---

## Human Verification

These criteria require a running MCP server process or full agent startup and cannot be meaningfully validated with mocks alone. Manual test procedures are documented in `src/mcp/INTEGRATION_TEST.md` (created in Phase 2 / Task 6).

### AC2.1: Stdio server process is spawned via StdioClientTransport on connect

**Why not automatable:** Verifying that an actual child process is spawned and communicates over stdin/stdout requires a real MCP server binary. The unit test covers `buildTransportOptions` correctness but not the actual spawn.

**Verification approach:**
1. Configure a stdio MCP server in `config.toml` (e.g., `@modelcontextprotocol/server-filesystem`)
2. Start Constellation with `bun run start`
3. Confirm console shows `[mcp:{name}] connected` and `[mcp:{name}] registered N tool(s)`
4. Verify MCP tools appear with `mcp_` prefix when asking the agent to list tools

### AC2.3: Stdio server process is killed on disconnect

**Why not automatable:** Requires verifying OS-level process cleanup on shutdown. No mock can validate that a real child process is terminated.

**Verification approach:**
1. Start Constellation with a stdio MCP server configured
2. Press Ctrl+C to trigger shutdown
3. Confirm console shows `[mcp] N server(s) disconnected`
4. Verify no orphan processes remain: `ps aux | grep @modelcontextprotocol` should return nothing

### AC2.4: Stdio server that fails to spawn logs warning, doesn't block startup

**Why not automatable:** Requires attempting to spawn a nonexistent binary and verifying the full agent continues to REPL. The unit test for graceful degradation (AC6.3/AC6.4 in `startup.test.ts`) validates the try/catch logic with mocks, but the real subprocess failure path needs a live run.

**Verification approach:**
1. Configure a stdio server with `command = "nonexistent-binary-xyz"`
2. Start Constellation
3. Confirm error log `[mcp:{name}] failed to connect:` appears
4. Confirm REPL starts normally and built-in tools are available

### AC3.1: HTTP server is connected via StreamableHTTPClientTransport

**Why not automatable:** Requires a running HTTP MCP server to validate the actual transport handshake. The unit test validates URL construction only.

**Verification approach:**
1. Start an HTTP MCP server on a known port
2. Configure it in `config.toml` with `transport = "http"` and the URL
3. Start Constellation
4. Confirm connection log and tool discovery

### AC3.2: HTTP server that fails to connect logs warning, doesn't block startup

**Why not automatable:** Same reasoning as AC2.4 — the real network failure path (connection refused, timeout) needs a live run. Mock-based graceful degradation is covered by AC6.3/AC6.4.

**Verification approach:**
1. Configure an HTTP server pointing to an unreachable URL (e.g., `http://localhost:19999/mcp`)
2. Start Constellation with no server listening on that port
3. Confirm error log appears and REPL starts normally

### AC6.2: Agent starts normally when no MCP servers are configured

**Why not automatable:** This is a regression/smoke test confirming the default config path works end-to-end. The schema default is unit-tested (AC1.7), but verifying the full agent starts requires a live run.

**Verification approach:**
1. Ensure `config.toml` has no `[mcp]` section
2. Start Constellation with `bun run start`
3. Confirm no MCP-related log output and REPL starts normally
4. Separately: `bun test` passes with no regressions (Phase 5 / Task 4)

---

## Test File Summary

| Test File | ACs Covered | Phase |
|-----------|-------------|-------|
| `src/mcp/schema.test.ts` | AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7 | 1 |
| `src/mcp/env.test.ts` | AC1.8 | 1 |
| `src/mcp/client.test.ts` | AC2.1, AC2.2, AC3.1, AC4.5, AC4.6, AC4.7, AC7.2 | 2 |
| `src/mcp/schema-mapper.test.ts` | AC4.4 | 3 |
| `src/mcp/provider.test.ts` | AC4.1, AC4.2, AC4.3 | 3 |
| `src/mcp/skill-adapter.test.ts` | AC5.1, AC5.2 | 4 |
| `src/skill/registry.test.ts` or `src/mcp/skill-inject.test.ts` | AC5.3, AC5.4 | 4 |
| `src/skill/tools.test.ts` or `src/mcp/skill-guard.test.ts` | AC5.5, AC5.6 | 4 |
| `src/mcp/startup.test.ts` | AC6.1, AC6.3, AC6.4, AC7.1, AC7.2 | 5 |
| `src/mcp/INTEGRATION_TEST.md` | AC2.1, AC2.3, AC2.4, AC3.1, AC3.2, AC6.2 (manual) | 2 |
