# MCP Client Human Test Plan

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Valid `config.toml` with model/embedding/database settings
- `bun test` passes (165 tests, 0 failures)
- `npx @modelcontextprotocol/server-filesystem` available (install via `npm install -g @modelcontextprotocol/server-filesystem`)
- Optionally: a local HTTP MCP server (e.g. `npx @modelcontextprotocol/server-everything --transport http --port 3001`)

## Phase 1: Stdio Server Lifecycle

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Add to `config.toml`: `[mcp]` section with `enabled = true` and a stdio server: `[mcp.servers.filesystem]`, `transport = "stdio"`, `command = "npx"`, `args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]` | Config saved without error |
| 1.2 | Run `bun run start` | Console shows `[mcp:filesystem] connected` and `[mcp:filesystem] registered N tool(s)` where N > 0 |
| 1.3 | In the REPL, ask the agent: "What tools do you have that start with mcp_?" | Agent lists tools prefixed with `mcp_filesystem_` (e.g. `mcp_filesystem_read_file`, `mcp_filesystem_list_directory`) |
| 1.4 | Ask the agent to use one: "Use mcp_filesystem_list_directory to list /tmp" | Agent calls the tool and returns directory listing content |
| 1.5 | Press `Ctrl+C` to trigger shutdown | Console shows `[mcp] N server(s) disconnected` |
| 1.6 | Run `ps aux \| grep @modelcontextprotocol` | No orphan MCP server processes remain |

## Phase 2: Stdio Server Failure

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Add a broken stdio server to `config.toml`: `[mcp.servers.broken]`, `transport = "stdio"`, `command = "nonexistent-binary-xyz-404"` | Config saved |
| 2.2 | Keep the working `filesystem` server from Phase 1 | Both servers configured |
| 2.3 | Run `bun run start` | Console shows `[mcp:broken] failed to connect:` error, then `[mcp:filesystem] connected` and `registered N tool(s)`. REPL starts normally. |
| 2.4 | Ask the agent to list tools | Only `mcp_filesystem_*` tools appear; no `mcp_broken_*` tools |

## Phase 3: HTTP Server

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Start an HTTP MCP server: `npx @modelcontextprotocol/server-everything --transport http --port 3001` | Server starts and logs listening on port 3001 |
| 3.2 | Add to `config.toml`: `[mcp.servers.everything]`, `transport = "http"`, `url = "http://localhost:3001/mcp"` | Config saved |
| 3.3 | Run `bun run start` | Console shows `[mcp:everything] connected` and tool registration |
| 3.4 | Stop the HTTP server, then add `url = "http://localhost:19999/mcp"` (unreachable) | Config points to dead endpoint |
| 3.5 | Run `bun run start` | Console shows `[mcp:everything] failed to connect:` error. REPL starts normally. |

## Phase 4: No MCP Configuration

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Remove the entire `[mcp]` section from `config.toml` | No MCP configuration present |
| 4.2 | Run `bun run start` | No MCP-related log output. REPL starts normally. Built-in tools (memory, code, search, etc.) all available. |
| 4.3 | Run `bun test` | All tests pass with no regressions |

## Phase 5: Environment Variable Expansion

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Set `export MCP_FS_PATH=/tmp` in your shell | Env var set |
| 5.2 | Configure stdio server with `args = ["-y", "@modelcontextprotocol/server-filesystem", "${MCP_FS_PATH}"]` | Config uses `${VAR}` syntax |
| 5.3 | Run `bun run start` | Server connects successfully; tool execution operates on `/tmp` |

## End-to-End: Mixed Transport with Prompts and Instructions

1. Configure two working servers (one stdio, one HTTP) and one broken server in `config.toml`
2. Run `bun run start`
3. Verify console shows 2 connected, 1 failed in startup summary
4. Ask the agent "What MCP tools and skills are available?" — confirm tools are namespaced and any MCP prompts appear as skills
5. Execute a tool from each working server to confirm dispatch works end-to-end
6. If an MCP server exposes prompts, verify they appear in `skill_list` output with `source: mcp`
7. Attempt `skill_update` on an MCP skill — confirm it returns an error refusing the update
8. Shutdown and confirm clean process cleanup

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1-AC1.7 | `src/mcp/schema.test.ts` | — |
| AC1.8 | `src/mcp/env.test.ts` | Phase 5 |
| AC2.1 | `src/mcp/client.test.ts` | Phase 1, steps 1.1-1.4 |
| AC2.2 | `src/mcp/client.test.ts` | — |
| AC2.3 | — | Phase 1, steps 1.5-1.6 |
| AC2.4 | — | Phase 2, steps 2.1-2.4 |
| AC3.1 | `src/mcp/client.test.ts` | Phase 3, steps 3.1-3.3 |
| AC3.2 | — | Phase 3, steps 3.4-3.5 |
| AC4.1-AC4.4 | `src/mcp/provider.test.ts`, `src/mcp/schema-mapper.test.ts` | Phase 1, step 1.3 |
| AC4.5-AC4.7 | `src/mcp/client.test.ts` | Phase 1, step 1.4 |
| AC5.1-AC5.4 | `src/mcp/skill-adapter.test.ts`, `src/skill/registry.test.ts` | E2E step 6 |
| AC5.5-AC5.6 | `src/skill/tools.test.ts` | E2E step 7 |
| AC6.1 | `src/mcp/startup.test.ts` | Phase 1, step 1.2 |
| AC6.2 | — | Phase 4, steps 4.1-4.3 |
| AC6.3-AC6.4 | `src/mcp/startup.test.ts` | Phase 2, step 2.3 |
| AC7.1-AC7.2 | `src/mcp/startup.test.ts`, `src/mcp/client.test.ts` | E2E step 4 |
