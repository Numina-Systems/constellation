# Custom Tool

Last verified: 2026-05-17

## Purpose
Provides runtime custom tool creation with persistence, registry integration, and Deno sandbox execution. Agents create tools dynamically via `create_tool` agent tool, which persists to PostgreSQL and immediately becomes callable.

## Contracts
- **Exposes**: `CustomToolDefinition` type (immutable tool definition with id, owner, name, description, parameters, code, timestamps), `CustomToolStore` port interface (create, update, delete, list, getByName with owner isolation), `createPostgresCustomToolStore(persistence)`, `CustomToolManager` interface (create, update, delete, list, loadAll), `createCustomToolManager(deps)`, `CustomToolManagerDeps` type
- **Guarantees**: Tools are per-owner (owner isolation via unique constraint on (owner, name)). Custom tool names cannot conflict with built-in tools at creation time. Updates to code/parameters are reflected immediately in the registry via closure re-evaluation. Deleted tools are removed from registry and database. `loadAll()` skips conflicting tool names silently on startup.
- **Expects**: `PersistenceProvider` with `custom_tools` table. `ToolRegistry` for integration. `CodeRuntime` for Deno execution. `SecretResolver` for accessing secrets in tool code.

## Dependencies
- **Uses**: `src/persistence/` (PostgreSQL queries for CRUD), `src/tool/types.js` (ToolParameter, ToolDefinition, Tool), `src/runtime/types.js` (CodeRuntime), `src/secrets/resolver.js` (SecretResolver for tool environment)
- **Used by**: `src/index.ts` (composition root wiring), `src/tool/builtin/custom-tools.ts` (create_tool, list_tools, update_tool, delete_tool agent tools)
- **Boundary**: Custom tool handlers are closures that receive parameters via PARAMS constant and return ToolResult. Secrets are resolved and passed to CodeRuntime.execute() in ExecutionContext.

## Key Decisions
- Port/adapter pattern: `CustomToolStore` port with PostgreSQL adapter for testability
- Definition cache in manager: In-memory cache of tool definitions for fast handler access; updates invalidate the cache
- Closure-based handlers: Each tool gets a closure handler that reads from definition cache and wraps code with PARAMS injection
- Silent conflict skipping on loadAll(): Custom tools created before a built-in was added don't crash startup
- Owner isolation: (owner, name) unique constraint enforces per-owner tool namespacing

## Invariants
- Tool names are unique per owner
- Custom tool names cannot conflict with built-in tool names at creation time
- Tool definitions are immutable once created (updated via update, deleted via delete)
- Persisted tools are reloaded on startup via loadAll()
- Parameters injected via PARAMS const in tool code

## Key Files
- `types.ts` -- `CustomToolDefinition` type and `CustomToolStore` port interface
- `postgres-store.ts` -- PostgreSQL adapter for custom tool persistence
- `index.ts` -- Barrel exports
- `manager.ts` -- `CustomToolManager` orchestrating CRUD and registry integration
