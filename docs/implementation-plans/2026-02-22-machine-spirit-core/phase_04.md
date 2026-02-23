# Machine Spirit Core Implementation Plan - Phase 4: Tool System

**Goal:** Tool registry with parameter validation, dispatch, built-in memory tools, and TypeScript stub generation for the Deno code execution runtime.

**Architecture:** `Tool` port defines what a tool looks like (name, description, parameters, handler). `ToolRegistry` manages registration, validation, dispatch, and generates TypeScript stub code that the Deno sandbox uses to call host-side tools via IPC. Built-in tools (`memory_read`, `memory_write`, `memory_list`, `execute_code`) are defined here. Memory tools delegate to the MemoryManager from Phase 3. The `execute_code` tool definition provides the schema the model needs; its dispatch is special-cased in the agent loop (Phase 6) to route to the CodeRuntime instead of ToolRegistry.

**Tech Stack:** Bun, TypeScript, Bun test runner

**Scope:** 8 phases from original design (this is phase 4 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phase 3 provides MemoryManager with read/write/list operations.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC4: Clean separation of concerns
- **machine-spirit-core.AC4.1 Success:** Each module (memory, model, embedding, runtime, tool, persistence) has a types.ts defining its port interface
- **machine-spirit-core.AC4.2 Success:** The agent loop depends only on port interfaces, not adapter implementations
- **machine-spirit-core.AC4.3 Success:** Each module is independently testable with mock implementations of its dependencies

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Tool port types

**Verifies:** machine-spirit-core.AC4.1

**Files:**
- Create: `src/tool/types.ts`

**Implementation:**

Define the tool system types:

- `ToolParameter`: `{ name, type ('string' | 'number' | 'boolean' | 'object' | 'array'), description, required, enum_values? }`
- `ToolDefinition`: `{ name, description, parameters: Array<ToolParameter> }` — the schema exposed to the model
- `ToolResult`: `{ success: boolean, output: string, error?: string }` — what the tool returns
- `ToolHandler`: `(params: Record<string, unknown>) => Promise<ToolResult>` — the function that executes the tool
- `Tool`: `{ definition: ToolDefinition, handler: ToolHandler }` — combines schema and implementation
- `ToolRegistry`: type with methods:
  - `register(tool: Tool): void`
  - `getDefinitions(): Array<ToolDefinition>` — returns schemas for all registered tools (sent to model)
  - `dispatch(name: string, params: Record<string, unknown>): Promise<ToolResult>` — validates params and calls handler
  - `generateStubs(): string` — produces TypeScript code for the Deno runtime bridge
  - `toModelTools(): Array<{ name: string, description: string, input_schema: Record<string, unknown> }>` — converts to the format expected by ModelProvider

`toModelTools` converts `ToolParameter` arrays into JSON Schema objects that the model providers expect (type: 'object', properties: {...}, required: [...]).

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add tool system types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ToolRegistry implementation

**Verifies:** machine-spirit-core.AC4.3

**Files:**
- Create: `src/tool/registry.ts`

**Implementation:**

Create `createToolRegistry(): ToolRegistry` factory function.

Key behaviours:

**`register(tool)`:**
- Stores tool in an internal `Map<string, Tool>` keyed by `tool.definition.name`
- Throws if a tool with the same name is already registered

**`getDefinitions()`:**
- Returns array of `ToolDefinition` from all registered tools

**`dispatch(name, params)`:**
- Looks up tool by name, returns error `ToolResult` if not found
- Validates required parameters are present (check `required` flag on each `ToolParameter`)
- Validates parameter types match declared types (basic type checking: typeof for primitives, Array.isArray for arrays)
- Calls `tool.handler(params)` and returns the result
- Catches handler errors and wraps them in `ToolResult` with `success: false`

**`generateStubs()`:**
- Produces a TypeScript string containing async function declarations for each registered tool
- Each stub function calls `__callTool__(name, params)` — a function expected to exist in the Deno runtime bridge
- Example output for `memory_read`:
  ```typescript
  async function memory_read(params: { query: string, limit?: number, tier?: string }): Promise<unknown> {
    return __callTool__("memory_read", params);
  }
  ```
- This generated code is prepended to user code when executing in the Deno sandbox

**`toModelTools()`:**
- Converts each tool's `ToolParameter` array into a JSON Schema object:
  ```typescript
  {
    name: tool.definition.name,
    description: tool.definition.description,
    input_schema: {
      type: 'object',
      properties: { [param.name]: { type: param.type, description: param.description, enum?: param.enum_values } },
      required: parameters.filter(p => p.required).map(p => p.name)
    }
  }
  ```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add ToolRegistry with validation and stub generation`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: ToolRegistry tests

**Verifies:** machine-spirit-core.AC4.1, machine-spirit-core.AC4.3

**Files:**
- Test: `src/tool/registry.test.ts` (unit)

**Testing:**

Unit tests with mock tool handlers (no external deps needed):

- **Registration:** Register a tool, verify `getDefinitions()` includes it. Register duplicate name, verify it throws.
- **Dispatch — valid call:** Register a tool with a mock handler, dispatch with valid params, verify handler was called and result returned.
- **Dispatch — unknown tool:** Dispatch to unregistered tool name, verify error ToolResult.
- **Dispatch — missing required param:** Register tool with required params, dispatch without them, verify error ToolResult without calling handler.
- **Dispatch — handler error:** Register tool whose handler throws, verify error is caught and wrapped in ToolResult.
- **Stub generation:** Register tools, call `generateStubs()`, verify output contains function declarations for each tool with correct parameter signatures.
- **toModelTools:** Register tools, call `toModelTools()`, verify output is valid JSON Schema format with properties, required arrays, and descriptions.
- **AC4.3 independence:** Verify ToolRegistry works entirely with mock tools — no real MemoryManager, no real providers.

**Verification:**
Run: `bun test src/tool/registry.test.ts`
Expected: All tests pass

**Commit:** `test: add ToolRegistry unit tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Built-in memory tools

**Verifies:** machine-spirit-core.AC4.2

**Files:**
- Create: `src/tool/builtin/memory.ts`

**Implementation:**

Create `createMemoryTools(manager: MemoryManager): Array<Tool>` factory function that returns the three built-in memory tools.

**`memory_read`:**
- Parameters: `query` (string, required), `limit` (number, optional, default 5), `tier` (string, optional, enum: ['core', 'working', 'archival'])
- Handler: calls `manager.read(query, limit, tier)`, formats results as JSON string in ToolResult
- Description: "Search memory by semantic similarity. Returns matching memory blocks ranked by relevance."

**`memory_write`:**
- Parameters: `label` (string, required), `content` (string, required), `tier` (string, optional, enum: ['core', 'working', 'archival']), `reason` (string, optional)
- Handler: calls `manager.write(label, content, tier, reason)`, formats result as JSON string in ToolResult
- If result is `{ applied: false, error }`, returns `{ success: false, output: '', error }`
- If result is `{ applied: false, mutation }`, returns `{ success: true, output: 'Mutation queued for familiar approval: [mutation details]' }`
- If result is `{ applied: true, block }`, returns `{ success: true, output: 'Memory written: [block details]' }`
- Description: "Write or update a memory block. Some blocks require familiar approval."

**`memory_list`:**
- Parameters: `tier` (string, optional, enum: ['core', 'working', 'archival'])
- Handler: calls `manager.list(tier)`, formats block summaries (id, label, tier, permission, content preview) as JSON string
- Description: "List memory blocks, optionally filtered by tier."

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add built-in memory tools`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Built-in memory tools tests

**Verifies:** machine-spirit-core.AC4.2, machine-spirit-core.AC4.3

**Files:**
- Test: `src/tool/builtin/memory.test.ts` (unit)

**Testing:**

Unit tests with a mock MemoryManager. Create a mock that implements the MemoryManager type with controllable return values.

- **memory_read:** Call with a query, verify `manager.read()` was called with correct args, verify result contains the mock search results formatted as JSON.
- **memory_write — readwrite block:** Mock `manager.write()` to return `{ applied: true, block }`. Verify tool returns success result.
- **memory_write — familiar block:** Mock `manager.write()` to return `{ applied: false, mutation }`. Verify tool returns success with mutation queued message.
- **memory_write — readonly block:** Mock `manager.write()` to return `{ applied: false, error }`. Verify tool returns error result.
- **memory_list:** Call with and without tier filter, verify `manager.list()` was called correctly, verify result contains block summaries.
- **AC4.2 port-only:** Verify memory tools depend only on the MemoryManager type, not on any concrete implementation.
- **AC4.3 independence:** All tests use mock MemoryManager — no database, no embedding provider.

**Verification:**
Run: `bun test src/tool/builtin/memory.test.ts`
Expected: All tests pass

**Commit:** `test: add built-in memory tools unit tests`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: execute_code tool definition

**Verifies:** machine-spirit-core.AC4.1

**Files:**
- Create: `src/tool/builtin/code.ts`

**Implementation:**

Create `createExecuteCodeTool(): Tool` factory function that defines the `execute_code` tool.

**`execute_code`:**
- Parameters: `code` (string, required)
- Handler: returns a placeholder `ToolResult` with `{ success: false, output: '', error: 'execute_code is dispatched by the agent loop, not the tool registry' }`. The agent loop (Phase 6) special-cases this tool name and routes it to `CodeRuntime.execute()` instead of `ToolRegistry.dispatch()`. The handler is a safety fallback that should never be called in normal operation.
- Description: "Execute TypeScript code in a sandboxed Deno environment. The code can make network requests to allowed hosts, read/write files in the working directory, and call memory tools via the built-in bridge functions. Use this for any capability beyond basic memory operations."

This tool MUST be registered in the ToolRegistry so that `toModelTools()` includes its schema in the tool definitions sent to the model. Without this definition, the model would not know `execute_code` exists and would never produce `tool_use` blocks for it.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add execute_code tool definition`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
