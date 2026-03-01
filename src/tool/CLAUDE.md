# Tool

Last verified: 2026-03-01

## Purpose
Provides a tool registry that manages registration, parameter validation, dispatch, model-format conversion, and Deno stub generation. Includes built-in tools for memory operations, code execution, and web search/fetch.

## Contracts
- **Exposes**: `ToolRegistry` interface (`register`, `getDefinitions`, `dispatch`, `generateStubs`, `toModelTools`), `createToolRegistry()`, `createMemoryTools(memory)`, `createExecuteCodeTool()`, `createWebTools(options)`, all tool types
- **Guarantees**:
  - `dispatch` validates required params, types, and enum values before calling handler
  - `dispatch` returns `ToolResult` (never throws); errors captured in `error` field
  - `generateStubs()` produces TypeScript function stubs that call `__callTool__` for the Deno IPC bridge
  - `toModelTools()` converts definitions to Anthropic tool format (JSON Schema)
  - Duplicate tool names are rejected at registration
- **Expects**: Tools registered before dispatch. `MemoryManager` injected for memory tools. `SearchFn` and `FetchFn` injected for web tools.

## Dependencies
- **Uses**: `src/memory/` (for built-in memory tools), `src/web/` (for built-in web tools)
- **Used by**: `src/agent/`, `src/runtime/` (stubs for Deno bridge), `src/index.ts`
- **Boundary**: Tool handlers are pure functions returning `ToolResult`. Side effects go through injected dependencies.

## Key Decisions
- Registry pattern over static map: Supports dynamic tool registration from extensions
- Stub generation for Deno bridge: Tools callable from sandboxed code via IPC without direct access to host APIs
- `execute_code` is a tool definition only: Actual execution is handled by `src/runtime/`, the agent dispatches it specially

## Invariants
- Tool names are unique within a registry instance
- `ToolResult.success` and `ToolResult.error` are consistent (error present iff not success)

## Built-in Tools
- `memory_read(query, limit?, tier?)` -- Semantic search across memory
- `memory_write(label, content, tier?, reason?)` -- Write/update memory block
- `memory_list(tier?)` -- List memory blocks
- `execute_code(code)` -- Definition only; dispatched by agent to runtime
- `web_search(query, limit?)` -- Search via provider fallback chain
- `web_fetch(url, continue_from?)` -- Fetch URL as paginated markdown

## Key Files
- `types.ts` -- `Tool`, `ToolRegistry`, `ToolResult`, `ToolDefinition` types
- `registry.ts` -- Registry implementation with validation and stub generation
- `builtin/memory.ts` -- Memory tool implementations
- `builtin/code.ts` -- Code execution tool definition
- `builtin/web.ts` -- Web search and fetch tool definitions
