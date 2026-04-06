# MCP Client Implementation Plan

**Goal:** Add MCP (Model Context Protocol) client support to Constellation, allowing it to connect to external MCP servers and surface their tools and prompts as first-class capabilities.

**Architecture:** Standalone `src/mcp/` module wrapping `@modelcontextprotocol/sdk`. Implements existing `ToolProvider` interface for tool discovery, adds skill adapter for MCP prompts, and wires into the composition root following the Bluesky DataSource lifecycle pattern.

**Tech Stack:** TypeScript 5.7+, Bun, Zod, `@modelcontextprotocol/sdk` v1.29+

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### mcp-client.AC4: Tools discovered and registered with namespacing
- **mcp-client.AC4.1 Success:** MCP tools are registered as `mcp_{server}_{tool}` in the tool registry
- **mcp-client.AC4.2 Success:** Tool descriptions are prefixed with `[MCP: {server}]`
- **mcp-client.AC4.3 Success:** Tool execution dispatches to MCP server with original (unnamespaced) tool name
- **mcp-client.AC4.4 Success:** JSON Schema input_schema maps to ToolParameter[] (string, number, boolean, object, array, enums)

---

## Phase 3: Tool Provider

**Goal:** Bridge MCP tools into Constellation's tool registry with namespacing.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create JSON Schema to ToolParameter mapper

**Files:**
- Create: `src/mcp/schema-mapper.ts`
- Modify: `src/mcp/index.ts` (add re-export)

**Implementation:**

Mark as `// pattern: Functional Core` (pure transformation, no I/O).

Create a pure function that converts MCP tool `inputSchema` (JSON Schema format) to Constellation's `ToolParameter[]`:

```typescript
function mapInputSchemaToParameters(
  inputSchema: Readonly<Record<string, unknown>>,
): Array<ToolParameter>
```

Import `ToolParameter` and `ToolParameterType` from `@/tool/types.ts`.

The MCP SDK returns `inputSchema` as a JSON Schema object with structure:
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query" },
    "limit": { "type": "number", "description": "Max results", "enum": [5, 10, 20] }
  },
  "required": ["query"]
}
```

Mapping logic:
1. Extract `properties` from the schema (default to `{}` if absent)
2. Extract `required` array from the schema (default to `[]` if absent)
3. For each property in `properties`:
   - `name`: the property key
   - `type`: map JSON Schema type to `ToolParameterType`:
     - `'string'` → `'string'`
     - `'number'` | `'integer'` → `'number'`
     - `'boolean'` → `'boolean'`
     - `'object'` → `'object'`
     - `'array'` → `'array'`
     - default (unknown/missing) → `'string'`
   - `description`: from the property's `description` field, default to `''`
   - `required`: whether the property key appears in the `required` array
   - `enum_values`: if the property has an `enum` array, convert all values to strings via `String()`

Export `mapInputSchemaToParameters`.

Add re-export to `src/mcp/index.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/schema-mapper.ts src/mcp/index.ts
git commit -m "feat(mcp): add JSON Schema to ToolParameter mapper"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for schema mapper

**Verifies:** mcp-client.AC4.4

**Files:**
- Create: `src/mcp/schema-mapper.test.ts`

**Testing:**

Tests must verify the AC listed above — that JSON Schema `inputSchema` maps correctly to `ToolParameter[]` for all supported types.

- mcp-client.AC4.4 (string): Schema with `{ type: 'string', description: 'A query' }` maps to `{ name, type: 'string', description: 'A query', required: true/false }`.
- mcp-client.AC4.4 (number): Schema with `{ type: 'number' }` maps to `type: 'number'`.
- mcp-client.AC4.4 (integer): Schema with `{ type: 'integer' }` maps to `type: 'number'` (integer → number).
- mcp-client.AC4.4 (boolean): Schema with `{ type: 'boolean' }` maps to `type: 'boolean'`.
- mcp-client.AC4.4 (object): Schema with `{ type: 'object' }` maps to `type: 'object'`.
- mcp-client.AC4.4 (array): Schema with `{ type: 'array' }` maps to `type: 'array'`.
- mcp-client.AC4.4 (enum): Schema with `{ type: 'string', enum: ['a', 'b', 'c'] }` maps to `enum_values: ['a', 'b', 'c']`.
- mcp-client.AC4.4 (required): Properties listed in `required` array have `required: true`; others have `required: false`.
- mcp-client.AC4.4 (empty schema): Empty or `{ type: 'object' }` with no properties returns `[]`.
- mcp-client.AC4.4 (missing description): Property without `description` defaults to `''`.
- mcp-client.AC4.4 (unknown type): Property with unrecognised type defaults to `'string'`.

**Verification:**

Run:
```bash
bun test src/mcp/schema-mapper.test.ts
```

Expected: All tests pass.

**Commit:**

```bash
git add src/mcp/schema-mapper.test.ts
git commit -m "test(mcp): add JSON Schema to ToolParameter mapping tests covering AC4.4"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Create MCP Tool Provider

**Files:**
- Create: `src/mcp/provider.ts`
- Modify: `src/mcp/index.ts` (add re-export)

**Implementation:**

Mark as `// pattern: Functional Core` (pure mapping and dispatch logic, no direct I/O — delegates I/O to the injected `McpClient`).

Create factory function:
```typescript
function createMcpToolProvider(client: McpClient): ToolProvider
```

Import `ToolProvider` from `@/extensions/tool-provider.ts`.
Import `ToolDefinition`, `ToolResult` from `@/tool/types.ts`.
Import `McpClient` from `./types.ts`.
Import `mapInputSchemaToParameters` from `./schema-mapper.ts`.

**Namespacing convention:**
- Tool name: `mcp_${serverName}_${toolName}` with hyphens converted to underscores in both server name and tool name
- Create a helper: `function namespaceTool(serverName: string, toolName: string): string`

**Internal name map** — the provider maintains a `Map<string, string>` mapping namespaced tool names back to original MCP tool names. This is populated during `discover()` and used during `execute()`. This is necessary because the namespacing is lossy (hyphens become underscores), so you can't reconstruct the original name from the namespaced version. The map provides an exact reverse lookup.

**Return object implementing `ToolProvider`:**

`name`: `\`mcp:${client.serverName}\``

`discover()`:
1. Call `const mcpTools = await client.listTools()`
2. Clear the internal name map
3. For each MCP tool:
   - Compute the namespaced name: `namespaceTool(client.serverName, tool.name)`
   - Store the mapping: `nameMap.set(namespacedName, tool.name)`
   - Build a `ToolDefinition`:
     ```typescript
     {
       name: namespacedName,
       description: `[MCP: ${client.serverName}] ${tool.description ?? ''}`,
       parameters: mapInputSchemaToParameters(tool.inputSchema),
     }
     ```
4. Return the array

`execute(tool, params)`:
1. Look up the original name from the internal name map: `const originalName = nameMap.get(tool)`
2. If not found, return `{ success: false, output: '', error: \`unknown MCP tool: ${tool}\` }`
3. Call `return client.callTool(originalName, params)`

Export `createMcpToolProvider` and `namespaceTool`.

Add re-exports to `src/mcp/index.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/provider.ts src/mcp/index.ts
git commit -m "feat(mcp): implement MCP ToolProvider with namespacing and schema mapping"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for namespacing helpers

**Verifies:** mcp-client.AC4.1, mcp-client.AC4.3

**Files:**
- Create: `src/mcp/provider.test.ts`

**Testing:**

- mcp-client.AC4.1 (basic namespacing): `namespaceTool('github', 'create_issue')` returns `'mcp_github_create_issue'`.
- mcp-client.AC4.1 (hyphen conversion): `namespaceTool('my-server', 'list-files')` returns `'mcp_my_server_list_files'`.
- mcp-client.AC4.3 (name map lookup): After calling `discover()` on the provider (which populates the internal name map), calling `execute('mcp_my_server_list_files', {})` should dispatch to the mock client's `callTool` with the original name `'list-files'`.
- mcp-client.AC4.3 (unknown tool): Calling `execute('mcp_unknown_tool', {})` without a prior `discover()` returns `{ success: false }` with error about unknown tool.

**Verification:**

Run:
```bash
bun test src/mcp/provider.test.ts
```

Expected: All tests pass.

**Commit:**

```bash
git add src/mcp/provider.test.ts
git commit -m "test(mcp): add tool namespacing tests covering AC4.1, AC4.3"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for MCP ToolProvider discover and execute

**Verifies:** mcp-client.AC4.1, mcp-client.AC4.2, mcp-client.AC4.3

**Files:**
- Modify: `src/mcp/provider.test.ts` (append additional tests)

**Testing:**

Create a mock `McpClient` for these tests — a simple object satisfying the `McpClient` interface with controllable return values:

```typescript
function createMockMcpClient(options?: {
  tools?: Array<McpToolInfo>;
  callToolResult?: ToolResult;
}): McpClient
```

The mock returns `options.tools` from `listTools()` and `options.callToolResult` from `callTool()`. Set `serverName` to `'test-server'`.

Tests:

- mcp-client.AC4.1 (discover namespacing): Create provider with mock client returning one tool `{ name: 'search', description: 'Search files', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }`. Call `discover()`. Verify returned `ToolDefinition` has `name: 'mcp_test_server_search'`.
- mcp-client.AC4.2 (description prefix): Same test. Verify description is `'[MCP: test-server] Search files'`.
- mcp-client.AC4.2 (no description): Tool with `description: undefined`. Verify description is `'[MCP: test-server] '`.
- mcp-client.AC4.3 (execute dispatch): Call `discover()` first (to populate name mapping), then call `execute('mcp_test_server_search', { query: 'foo' })`. Verify the mock's `callTool` was called with the original name `'search'` and `{ query: 'foo' }`.
- mcp-client.AC4.1 (multiple tools): Mock returns 3 tools. Verify all 3 are namespaced correctly after `discover()`.

**Verification:**

Run:
```bash
bun test src/mcp/provider.test.ts
```

Expected: All tests pass.

Run:
```bash
bun test
```

Expected: All tests pass (no regressions).

**Commit:**

```bash
git add src/mcp/provider.test.ts
git commit -m "test(mcp): add ToolProvider discover/execute tests covering AC4.1-AC4.3"
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
