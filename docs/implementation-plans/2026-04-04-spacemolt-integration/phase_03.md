# SpaceMolt Integration — Phase 3: MCP ToolProvider

**Goal:** Connect to SpaceMolt's MCP server, discover tools, execute commands.

**Architecture:** First concrete `ToolProvider` implementation. Wraps `@modelcontextprotocol/sdk` client with `StreamableHTTPClientTransport`. Translates MCP JSON Schema tools to constellation's flat `ToolParameter[]` format. Namespaces tools with `spacemolt:` prefix.

**Tech Stack:** `@modelcontextprotocol/sdk`, TypeScript

**Scope:** 8 phases from original design (phase 3 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC2: MCP ToolProvider discovers and executes tools
- **spacemolt-integration.AC2.1 Success:** `discover()` connects to MCP server and returns `ToolDefinition[]` with `spacemolt:` prefixed names
- **spacemolt-integration.AC2.2 Success:** JSON Schema `string`/`number`/`boolean` properties translate to matching `ToolParameter` types
- **spacemolt-integration.AC2.3 Success:** JSON Schema `object`/`array` properties translate to `ToolParameter` with type `"object"` or `"array"`
- **spacemolt-integration.AC2.4 Success:** `execute()` strips `spacemolt:` prefix and calls MCP `callTool()` with correct name
- **spacemolt-integration.AC2.5 Success:** MCP content blocks (text) are flattened into `ToolResult.output` string
- **spacemolt-integration.AC2.6 Edge:** `notifications/tools/list_changed` triggers tool list refresh

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: JSON Schema to ToolParameter translation

**Verifies:** spacemolt-integration.AC2.2, spacemolt-integration.AC2.3

**Files:**
- Create: `src/extensions/spacemolt/schema.ts`
- Test: `src/extensions/spacemolt/schema.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/schema.ts` with `// pattern: Functional Core`. Export `translateMcpTool(mcpTool: McpTool, prefix: string): ToolDefinition`.

The function:
1. Prefixes the tool name: `${prefix}${mcpTool.name}`
2. Reads `mcpTool.inputSchema.properties` (JSON Schema object)
3. For each top-level property, creates a `ToolParameter`:
   - Map JSON Schema `type` to `ToolParameterType`: `"string"` → `"string"`, `"number"` / `"integer"` → `"number"`, `"boolean"` → `"boolean"`, `"object"` → `"object"`, `"array"` → `"array"`, default → `"string"`
   - Copy `description` from property schema (default empty string)
   - Check if property name is in `inputSchema.required` array
   - Copy `enum` array to `enum_values` if present
4. Returns `ToolDefinition` with translated parameters

Define a local type for the MCP tool shape (or import from SDK):
```typescript
type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, {
      type?: string;
      description?: string;
      enum?: ReadonlyArray<string>;
    }>;
    required?: ReadonlyArray<string>;
  };
};
```

Also export `flattenMcpContent(content: ReadonlyArray<{ type: string; text?: string }>): string` — concatenates all `text` fields from content blocks, separated by newlines.

**Testing:**

- AC2.2: Input schema with `string`, `number`, `boolean` properties → correct `ToolParameter` types
- AC2.3: Input schema with `object` and `array` properties → type is `"object"` / `"array"`
- Test `enum` values are copied to `enum_values`
- Test `required` field marks parameters correctly
- Test missing `properties` (empty params) produces empty parameter list
- Test `flattenMcpContent` concatenates text blocks

**Verification:**
Run: `bun test src/extensions/spacemolt/schema.test.ts`
Expected: All tests pass

**Commit:** `feat: add MCP JSON Schema to ToolParameter translation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: MCP ToolProvider implementation

**Verifies:** spacemolt-integration.AC2.1, spacemolt-integration.AC2.4, spacemolt-integration.AC2.5, spacemolt-integration.AC2.6

**Files:**
- Create: `src/extensions/spacemolt/tool-provider.ts`
- Test: `src/extensions/spacemolt/tool-provider.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/tool-provider.ts` with `// pattern: Imperative Shell`. Export `createSpaceMoltToolProvider(options)` factory.

Options type:
```typescript
type SpaceMoltToolProviderOptions = {
  readonly mcpUrl: string;
  readonly username: string;
  readonly password: string;
};
```

The factory:
1. Creates MCP `Client` with `{ name: "constellation", version: "1.0.0" }`
2. Creates `StreamableHTTPClientTransport` with `new URL(mcpUrl)`
3. Internal state: `let toolCache: Array<ToolDefinition> = []`
4. `discover()`:
   - Connect client to transport (`await client.connect(transport)`)
   - Authenticate: call `client.callTool({ name: "login", arguments: { username, password } })` — this is SpaceMolt-specific auth (login exposed as an MCP tool), NOT standard MCP auth flow. Standard MCP uses HTTP headers or OAuth; SpaceMolt uses a tool call.
   - Paginate `client.listTools()` (handle `nextCursor` if present)
   - Translate each MCP tool via `translateMcpTool(tool, "spacemolt:")`
   - Cache translated tools
   - Subscribe to `notifications/tools/list_changed` for `refreshTools()`
   - Return cached tools
5. `execute(toolName, params)`:
   - Strip `spacemolt:` prefix from `toolName`
   - Call `client.callTool({ name: strippedName, arguments: params })`
   - Flatten content blocks via `flattenMcpContent()`
   - Return `{ success: !result.isError, output: flattenedText, error: result.isError ? flattenedText : undefined }`
6. `refreshTools()`: re-run `listTools()` + translate + update cache
7. `close()`: `await client.close()`

Returns object satisfying `ToolProvider` interface with additional `refreshTools()` and `close()` methods.

**Testing:**

Since MCP SDK requires a real server connection, tests should mock the MCP client. Create a mock that returns predetermined tool lists and call results:

- AC2.1: `discover()` returns `ToolDefinition[]` with names prefixed `spacemolt:`
- AC2.4: `execute("spacemolt:mine", {})` calls underlying MCP with name `"mine"`
- AC2.5: MCP returns `{ content: [{ type: "text", text: "Mined 50 iron" }], isError: false }` → `ToolResult.output === "Mined 50 iron"`
- AC2.6: Simulating `notifications/tools/list_changed` triggers tool list refresh (test the refresh logic directly)

Mock approach: Create a mock MCP client object matching the Client interface methods used (`connect`, `listTools`, `callTool`, `close`, `on`). Inject it into the factory via an optional `client` parameter for testing.

**Verification:**
Run: `bun test src/extensions/spacemolt/tool-provider.test.ts`
Expected: All tests pass

**Commit:** `feat: add MCP ToolProvider with tool discovery and execution`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to barrel exports:
```typescript
export { translateMcpTool, flattenMcpContent } from "./schema.ts";
export { createSpaceMoltToolProvider } from "./tool-provider.ts";
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: export spacemolt tool provider from barrel`
<!-- END_TASK_3 -->
