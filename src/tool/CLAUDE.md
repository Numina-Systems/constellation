# Tool

Last verified: 2026-04-14

## Purpose
Provides a tool registry that manages registration, parameter validation, dispatch, model-format conversion, and Deno stub generation. Includes built-in tools for memory operations, code execution, web search/fetch, agent scheduling, unified search, and subconscious interest/curiosity management.

## Contracts
- **Exposes**: `ToolRegistry` interface (`register`, `getDefinitions`, `dispatch`, `generateStubs`, `toModelTools`), `createToolRegistry()`, `createMemoryTools(memory)`, `createExecuteCodeTool()`, `createCompactContextTool()`, `createWebTools(options)`, `createSchedulingTools(deps)`, `createSearchTools(searchStore)`, `createSubconsciousTools(deps)`, `validateMinimumInterval(schedule, minMinutes)`, all tool types
- **Guarantees**:
  - `dispatch` validates required params, types, and enum values before calling handler
  - `dispatch` returns `ToolResult` (never throws); errors captured in `error` field
  - `generateStubs()` produces TypeScript function stubs that call `__callTool__` for the Deno IPC bridge
  - `toModelTools()` converts definitions to Anthropic tool format (JSON Schema)
  - Duplicate tool names are rejected at registration
- **Expects**: Tools registered before dispatch. `MemoryManager` injected for memory tools. `SearchFn` and `FetchFn` injected for web tools. `Scheduler`, `owner`, and `PersistenceProvider` injected for scheduling tools. `SearchStore` injected for search tools. `InterestRegistry` and `owner` injected for subconscious tools.

## Dependencies
- **Uses**: `src/memory/` (for built-in memory tools), `src/web/` (for built-in web tools), `src/extensions/scheduler.ts` and `src/persistence/` (for scheduling tools), `src/search/` (for built-in search tool), `src/subconscious/` (for interest/curiosity tools)
- **Used by**: `src/agent/`, `src/runtime/` (stubs for Deno bridge), `src/skill/` (ToolParameter, Tool types for skill tool definitions), `src/index.ts`
- **Boundary**: Tool handlers are pure functions returning `ToolResult`. Side effects go through injected dependencies.

## Key Decisions
- Registry pattern over static map: Supports dynamic tool registration from extensions
- Stub generation for Deno bridge: Tools callable from sandboxed code via IPC without direct access to host APIs
- Special-case tools as definitions: `execute_code` and `compact_context` are tool definitions only; actual dispatch is handled by the agent loop to route to specialized handlers (`CodeRuntime` and `Compactor` respectively)

## Invariants
- Tool names are unique within a registry instance
- `ToolResult.success` and `ToolResult.error` are consistent (error present iff not success)

## Built-in Tools
- `memory_read(query, limit?, tier?)` -- Semantic search across memory
- `memory_write(label, content, tier?, reason?)` -- Write/update memory block
- `memory_list(tier?)` -- List memory blocks
- `execute_code(code)` -- Definition only; dispatched by agent to runtime
- `compact_context()` -- Definition only; dispatched by agent to compactor for context compression
- `web_search(query, limit?)` -- Search via provider fallback chain
- `web_fetch(url, continue_from?)` -- Fetch URL as paginated markdown
- `schedule_task(name, schedule, prompt)` -- Schedule a one-shot or recurring task with a self-instruction prompt
- `cancel_task(task_id)` -- Cancel a scheduled task (owner-scoped)
- `list_tasks(include_cancelled?)` -- List agent-owned scheduled tasks
- `search(query, mode?, domain?, limit?, start_time?, end_time?, role?, tier?)` -- Hybrid search across memory and conversations
- `manage_interest(action, id?, name?, description?, source?, status?, engagement_score?)` -- Create, update, or transition interests
- `manage_curiosity(action, id?, interest_id?, question?, resolution?)` -- Create, explore, resolve, or park curiosity threads
- `list_interests(status?, source?, min_score?)` -- List interests with optional filters
- `list_curiosities(interest_id, status?)` -- List curiosity threads for an interest

## Key Files
- `types.ts` -- `Tool`, `ToolRegistry`, `ToolResult`, `ToolDefinition` types
- `registry.ts` -- Registry implementation with validation and stub generation
- `builtin/memory.ts` -- Memory tool implementations
- `builtin/code.ts` -- Code execution tool definition
- `builtin/compaction.ts` -- Context compaction tool definition
- `builtin/web.ts` -- Web search and fetch tool definitions
- `builtin/scheduling.ts` -- Scheduling tool implementations (schedule, cancel, list)
- `builtin/search.ts` -- Unified search tool (delegates to SearchStore)
- `builtin/subconscious.ts` -- Interest and curiosity management tools
