# MCP Client Implementation Plan

**Goal:** Add MCP (Model Context Protocol) client support to Constellation, allowing it to connect to external MCP servers and surface their tools and prompts as first-class capabilities.

**Architecture:** Standalone `src/mcp/` module wrapping `@modelcontextprotocol/sdk`. Implements existing `ToolProvider` interface for tool discovery, adds skill adapter for MCP prompts, and wires into the composition root following the Bluesky DataSource lifecycle pattern.

**Tech Stack:** TypeScript 5.7+, Bun, Zod, `@modelcontextprotocol/sdk` v1.29+

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### mcp-client.AC2: Stdio servers spawned on startup, killed on shutdown
- **mcp-client.AC2.1 Success:** Stdio server process is spawned via StdioClientTransport on connect
- **mcp-client.AC2.2 Success:** Process env merges config env with process.env (SDK bug workaround)
- **mcp-client.AC2.3 Success:** Stdio server process is killed on disconnect
- **mcp-client.AC2.4 Failure:** Stdio server that fails to spawn logs warning, doesn't block startup

### mcp-client.AC3: HTTP servers connected on startup
- **mcp-client.AC3.1 Success:** HTTP server is connected via StreamableHTTPClientTransport
- **mcp-client.AC3.2 Failure:** HTTP server that fails to connect logs warning, doesn't block startup

### mcp-client.AC4: Tools discovered and registered with namespacing (partial — tool result mapping only)
- **mcp-client.AC4.5 Success:** Tool results map ContentBlock[] text to ToolResult.output
- **mcp-client.AC4.6 Failure:** Tool call to disconnected server returns { success: false }
- **mcp-client.AC4.7 Failure:** MCP tool returning isError maps to { success: false }

### mcp-client.AC7: Server instructions as context
- **mcp-client.AC7.1 Success:** Server instructions from getInstructions() are appended to system prompt
- **mcp-client.AC7.2 Edge:** Server with no instructions contributes nothing to system prompt

---

## Phase 2: MCP Client Wrapper

**Goal:** Create a client that can connect to MCP servers, discover tools/prompts, call tools, and manage connection lifecycle.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create McpClient interface in types.ts

**Files:**
- Modify: `src/mcp/types.ts` (append new types after existing definitions)

**Implementation:**

Add the `McpClient` interface and supporting type to `src/mcp/types.ts`. This is a behavioural contract (uses `interface`, not `type`) because it will have concrete implementations.

Add `McpClient` interface with:
- `readonly serverName: string`
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `listTools(): Promise<Array<McpToolInfo>>`
- `callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>`
- `listPrompts(): Promise<Array<McpPromptInfo>>`
- `getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptResult>`
- `getInstructions(): Promise<string | undefined>`

Import `ToolResult` from `@/tool/types.ts`.

Update the barrel export in `src/mcp/index.ts` to include `McpClient`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/types.ts src/mcp/index.ts
git commit -m "feat(mcp): add McpClient interface to domain types"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create McpClient factory implementation

**Files:**
- Create: `src/mcp/client.ts`
- Modify: `src/mcp/index.ts` (add re-export)

**Implementation:**

Mark as `// pattern: Imperative Shell` (manages transport connections, spawns processes, performs I/O).

Create factory function:
```typescript
function createMcpClient(serverName: string, config: McpServerConfig): McpClient
```

Import from `@modelcontextprotocol/sdk`:
- `Client` from `@modelcontextprotocol/sdk/client/index.js`
- `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`
- `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`

Import `McpServerConfig` from `./schema.ts` (config types are Zod-inferred).
Import `McpClient`, `McpToolInfo`, `McpPromptInfo`, `McpPromptResult` from `./types.ts`.
Import `ToolResult` from `@/tool/types.ts`.

**Internal state** (closure variables):
- `let sdkClient: Client | null = null` — the SDK client instance
- `let connected = false`

**Transport options creation** — extract as a **pure, exported function** for testability:

```typescript
export function buildTransportOptions(
  config: McpServerConfig,
  processEnv: Readonly<Record<string, string | undefined>>,
): { type: 'stdio'; command: string; args: Array<string>; env: Record<string, string | undefined> }
  | { type: 'http'; url: URL }
```

For stdio configs, return:
```typescript
{ type: 'stdio', command: config.command, args: [...config.args], env: { ...processEnv, ...config.env } }
```

The `{ ...processEnv, ...config.env }` merge is the SDK env bug workaround (AC2.2). The SDK's `StdioClientTransport` replaces process.env entirely when `env` is provided, so we must merge manually.

**Note:** This env merge is separate from the `resolveEnvVars` config expansion in Phase 1. `resolveEnvVars` expands `${VAR}` templates in config string values at config load time. The merge here happens at transport creation time to work around an SDK bug where `StdioClientTransport` drops the parent process environment when custom env vars are provided.

For http configs, return:
```typescript
{ type: 'http', url: new URL(config.url) }
```

The `connect()` method then uses these options to construct the actual transport:
```typescript
const opts = buildTransportOptions(config, process.env);
const transport = opts.type === 'stdio'
  ? new StdioClientTransport({ command: opts.command, args: opts.args, env: opts.env })
  : new StreamableHTTPClientTransport(opts.url);
```

**connect():**
1. Create SDK `Client` with `{ name: 'constellation', version: '1.0.0' }`
2. Create transport based on `config.transport` discriminant
3. Set `sdkClient.onerror` to `(error) => console.error(\`[mcp:${serverName}] error:\`, error)`
4. Set `sdkClient.onclose` to `() => { connected = false; console.log(\`[mcp:${serverName}] connection closed\`) }`
5. Call `await sdkClient.connect(transport)`
6. Set `connected = true`
7. Log `console.log(\`[mcp:${serverName}] connected\`)`

**disconnect():**
1. If `sdkClient` is not null and `connected` is true:
   - Call `await sdkClient.close()`
   - Set `connected = false`
   - Log `console.log(\`[mcp:${serverName}] disconnected\`)`

**listTools():**
1. If not connected, return `[]`
2. Paginate through all tools:
   ```typescript
   const tools: Array<McpToolInfo> = [];
   let cursor: string | undefined;
   do {
     const result = await sdkClient!.listTools(cursor ? { cursor } : undefined);
     for (const tool of result.tools) {
       tools.push({
         name: tool.name,
         description: tool.description,
         inputSchema: tool.inputSchema as Record<string, unknown>,
       });
     }
     cursor = result.nextCursor;
   } while (cursor);
   return tools;
   ```

**callTool(name, args):**
1. If not connected, return `{ success: false, output: '', error: \`[mcp:${serverName}] not connected\` }` (AC4.6)
2. Call `const result = await sdkClient!.callTool({ name, arguments: args })`
3. Map ContentBlock[] to ToolResult:
   - Concatenate all text blocks: `result.content.filter(b => b.type === 'text').map(b => b.text).join('\n')`
   - If `result.isError` is true, return `{ success: false, output: text, error: text }` (AC4.7)
   - Otherwise return `{ success: true, output: text }` (AC4.5)
4. Wrap in try/catch: on error, return `{ success: false, output: '', error: String(error) }`

**listPrompts():**
1. If not connected, return `[]`
2. Paginate (same cursor pattern as listTools):
   ```typescript
   const prompts: Array<McpPromptInfo> = [];
   let cursor: string | undefined;
   do {
     const result = await sdkClient!.listPrompts(cursor ? { cursor } : undefined);
     for (const prompt of result.prompts) {
       prompts.push({
         name: prompt.name,
         description: prompt.description,
         arguments: (prompt.arguments ?? []).map(a => ({
           name: a.name,
           description: a.description,
           required: a.required,
         })),
       });
     }
     cursor = result.nextCursor;
   } while (cursor);
   return prompts;
   ```

**getPrompt(name, args):**
1. If not connected, return `{ description: undefined, messages: [] }`
2. Call `const result = await sdkClient!.getPrompt({ name, arguments: args })`
3. Map to McpPromptResult:
   ```typescript
   return {
     description: result.description,
     messages: result.messages.map(m => ({
       role: m.role,
       content: m.content.type === 'text' ? m.content.text : JSON.stringify(m.content),
     })),
   };
   ```

**getInstructions():**
1. If not connected, return `undefined`
2. After `connect()`, the MCP SDK `Client` instance stores the server's `instructions` string from the `initialize` response. Access it via:
   ```typescript
   return sdkClient!.getInstructions?.() ?? undefined;
   ```
   The `getInstructions()` method is available on `@modelcontextprotocol/sdk` v1.29+. It returns the `instructions` field from the server's `InitializeResult`, or `undefined` if the server didn't provide instructions.
3. If the method is not available on the installed SDK version (should not happen with v1.29+), fall back to `undefined`.

Export `createMcpClient` from `src/mcp/index.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/client.ts src/mcp/index.ts
git commit -m "feat(mcp): implement MCP client wrapper with transport creation and lifecycle management"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Create ContentBlock-to-ToolResult mapping tests

**Verifies:** mcp-client.AC4.5, mcp-client.AC4.6, mcp-client.AC4.7

**Files:**
- Create: `src/mcp/client.test.ts`

**Implementation:**

Since the MCP client wraps an external SDK and manages real process/network connections, integration-testing the full connect/disconnect cycle requires running actual MCP servers. Instead, test the pure mapping logic by extracting a testable helper.

Before writing tests, extract the ContentBlock-to-ToolResult mapping from `callTool()` into a pure helper function at the top of `client.ts`:

```typescript
function mapToolResult(
  content: ReadonlyArray<{ readonly type: string; readonly text?: string }>,
  isError: boolean | undefined,
): ToolResult
```

Export this function for testing (it's a Functional Core pure function despite living in an Imperative Shell file — this is acceptable for a small extracted helper).

**Testing:**

Tests must verify each AC listed above:

- mcp-client.AC4.5: Test `mapToolResult` with an array of text content blocks. Verify text blocks are concatenated with `\n` into `output`, and `success` is `true`.
- mcp-client.AC4.5 (single block): Test with a single text block. Verify output matches the text exactly.
- mcp-client.AC4.5 (mixed types): Test with mixed content types (text + image). Verify only text blocks contribute to output; non-text blocks are ignored.
- mcp-client.AC4.5 (empty content): Test with empty content array. Verify `{ success: true, output: '' }`.
- mcp-client.AC4.6: Test that calling `callTool` on a disconnected client (before `connect()`) returns `{ success: false }` with an error message containing "not connected".
  - This test creates a client via `createMcpClient()` but does NOT call `connect()`, then calls `callTool()`.
- mcp-client.AC4.7: Test `mapToolResult` with `isError: true`. Verify `success` is `false` and `error` contains the text content.

**Verification:**

Run:
```bash
bun test src/mcp/client.test.ts
```

Expected: All tests pass.

**Commit:**

```bash
git add src/mcp/client.ts src/mcp/client.test.ts
git commit -m "test(mcp): add tool result mapping tests covering AC4.5, AC4.6, AC4.7"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Test disconnected client behaviour

**Verifies:** mcp-client.AC4.6, mcp-client.AC7.2

**Files:**
- Modify: `src/mcp/client.test.ts` (append additional tests)

**Testing:**

These tests verify the client's behaviour when not connected, without requiring a real MCP server:

- mcp-client.AC4.6 (listTools disconnected): Create client, don't connect, call `listTools()`. Verify returns empty array.
- mcp-client.AC4.6 (listPrompts disconnected): Create client, don't connect, call `listPrompts()`. Verify returns empty array.
- mcp-client.AC7.2 (getInstructions disconnected): Create client, don't connect, call `getInstructions()`. Verify returns `undefined`.
- Verify `serverName` property returns the name passed to factory.

**Verification:**

Run:
```bash
bun test src/mcp/client.test.ts
```

Expected: All tests pass.

Run:
```bash
bun test
```

Expected: All tests pass (no regressions).

**Commit:**

```bash
git add src/mcp/client.test.ts
git commit -m "test(mcp): add disconnected client behaviour tests covering AC4.6, AC7.2"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for transport options creation

**Verifies:** mcp-client.AC2.1, mcp-client.AC2.2, mcp-client.AC3.1

**Files:**
- Modify: `src/mcp/client.test.ts` (append transport options tests)

**Testing:**

These tests verify the extracted `buildTransportOptions` pure function:

- mcp-client.AC2.1 (stdio transport created): Call `buildTransportOptions` with a stdio config. Verify returned object has `type: 'stdio'`, correct `command` and `args`.
- mcp-client.AC2.2 (env merge): Call `buildTransportOptions` with stdio config `{ env: { CUSTOM: 'val' } }` and processEnv `{ PATH: '/usr/bin', HOME: '/home/test' }`. Verify returned env contains both `PATH` (from processEnv) and `CUSTOM` (from config). Verify config env overrides processEnv when keys collide.
- mcp-client.AC2.2 (empty config env): Call with stdio config `{ env: {} }` and a processEnv. Verify returned env equals processEnv.
- mcp-client.AC3.1 (HTTP transport created): Call `buildTransportOptions` with HTTP config `{ transport: 'http', url: 'http://localhost:3001/mcp' }`. Verify returned object has `type: 'http'` and `url` is a URL instance with correct href.

**Verification:**

Run:
```bash
bun test src/mcp/client.test.ts
```

Expected: All tests pass.

**Commit:**

```bash
git add src/mcp/client.test.ts
git commit -m "test(mcp): add transport options creation tests covering AC2.1, AC2.2, AC3.1"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Document manual integration test procedure for AC2/AC3 lifecycle

**Verifies:** mcp-client.AC2.1, mcp-client.AC2.3, mcp-client.AC2.4, mcp-client.AC3.1, mcp-client.AC3.2

**Files:**
- Create: `src/mcp/INTEGRATION_TEST.md`

**Implementation:**

Create a markdown document describing manual integration test steps using the `@modelcontextprotocol/server-filesystem` reference server (a well-known stdio MCP server from the SDK maintainers). This covers the lifecycle ACs that require a real MCP server process:

```markdown
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
```

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes (markdown file doesn't affect build).

**Commit:**

```bash
git add src/mcp/INTEGRATION_TEST.md
git commit -m "docs(mcp): add manual integration test procedure for AC2/AC3 lifecycle"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
