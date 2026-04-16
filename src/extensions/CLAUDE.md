# Extensions

Last verified: 2026-04-05

## Purpose
Defines extension point interfaces and hosts concrete implementations. Extension interfaces are contracts that plugins implement to extend the agent's capabilities.

## Contracts
- **Exposes**: `DataSource` (external message streams), `Coordinator` (multi-agent routing), `Scheduler` (deferred/periodic tasks), `ToolProvider` (dynamic tool discovery), `DataSourceRegistration` (per-source metadata), `DataSourceRegistry` (registry lifecycle management), `createDataSourceRegistry(options)` (factory), plus concrete implementations via subdirectory re-exports
- **Guarantees**: Interfaces are stable. Implementations can be registered without modifying core modules. Registry wires sources through activity interceptors and event routing to a shared external event queue, decoupling source integration from agent instantiation.
- **Expects**: Implementations live in `src/extensions/<name>/` subdirectories. Registry caller provides `eventSink` (event queue) and `processEvents` (async handler) callbacks.

## Dependencies
- **Uses**: `src/tool/types.ts` (ToolProvider references ToolDefinition/ToolResult)
- **Used by**: `src/index.ts` (composition root imports Bluesky source and DataSource registry), `src/scheduler/` (implements Scheduler interface), `src/tool/builtin/scheduling.ts` (scheduling tools depend on Scheduler port), `src/activity/` (activity interceptor consumes `IncomingMessage` type)
- **Boundary**: Extension interfaces live here. Implementations live in `src/extensions/<name>/`.

## Extension Points
- **DataSource**: Connect external message streams (Discord, Bluesky, webhooks). Produces `IncomingMessage`, optionally sends `OutgoingMessage`.
- **Coordinator**: Multi-agent routing with patterns: supervisor, round_robin, pipeline, voting.
- **Scheduler**: Cron or one-shot deferred tasks for background work ("sleep time compute"). `schedule()` returns `{ id, nextRunAt }` for caller confirmation.
- **ToolProvider**: Dynamic tool discovery from MCP servers, plugins, or remote registries.

## Implementations
- **Bluesky** (`bluesky/`): First DataSource implementation. See `bluesky/CLAUDE.md`.
- **Scheduler** (`../scheduler/`): PostgreSQL-backed Scheduler implementation. See `src/scheduler/CLAUDE.md`.
- **MCP** (`../mcp/`): First ToolProvider implementation. Bridges MCP server tools with namespaced names. See `src/mcp/CLAUDE.md`.
- **DataSource Registry** (`data-source-registry.ts`): Routes all registered sources through unified event handling with activity awareness.

## Key Files
- `data-source.ts` -- DataSource, IncomingMessage, OutgoingMessage, DataSourceRegistration, DataSourceRegistry
- `coordinator.ts` -- Coordinator, CoordinationPattern, AgentRef, AgentResponse
- `scheduler.ts` -- Scheduler, ScheduledTask
- `tool-provider.ts` -- ToolProvider
- `data-source-registry.ts` -- Registry implementation, wires sources through activity interceptors and event routing
- `bluesky/` -- Bluesky DataSource implementation
