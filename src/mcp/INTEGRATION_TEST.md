# MCP Client Manual Integration Tests

These tests require a running MCP server and verify lifecycle behaviour
that cannot be tested with mocks.

## Prerequisites

- `npx` available in PATH
- A temporary directory for the filesystem server

## Test 1: Stdio server spawns and discovers tools (AC2.1)

1. Add to config.toml:
   ```toml
   [mcp]
   enabled = true
   [mcp.servers.fs]
   transport = "stdio"
   command = "npx"
   args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mcp-test"]
   ```
2. Start constellation: `bun run start`
3. Expected: Console shows `[mcp:fs] connected` and `[mcp:fs] registered N tool(s)`
4. Verify tools: In REPL, ask the agent to list available tools. MCP tools should appear with `mcp_fs_` prefix.

## Test 2: Stdio server killed on shutdown (AC2.3)

1. With the above config running, press Ctrl+C
2. Expected: Console shows `[mcp] 1 server(s) disconnected` during shutdown
3. Verify no orphan processes: `ps aux | grep @modelcontextprotocol` should show no results

## Test 3: Failed stdio server doesn't block startup (AC2.4)

1. Set config with bad command:
   ```toml
   [mcp.servers.bad]
   transport = "stdio"
   command = "nonexistent-binary-xyz"
   args = []
   ```
2. Start constellation: `bun run start`
3. Expected: Console shows `[mcp:bad] failed to connect:` error, then continues to REPL normally

## Test 4: Failed HTTP server doesn't block startup (AC3.2)

1. Set config with unreachable URL:
   ```toml
   [mcp.servers.remote]
   transport = "http"
   url = "http://localhost:19999/mcp"
   ```
2. Start constellation (with no server on port 19999): `bun run start`
3. Expected: Console shows `[mcp:remote] failed to connect:` error, then continues to REPL normally
