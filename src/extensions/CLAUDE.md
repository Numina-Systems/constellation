# Extensions

Last verified: 2026-02-23

## Purpose
Defines extension point interfaces for future integration without implementation. These are contracts that external plugins will implement to extend the agent's capabilities.

## Contracts
- **Exposes**: `DataSource` (external message streams), `Coordinator` (multi-agent routing), `Scheduler` (deferred/periodic tasks), `ToolProvider` (dynamic tool discovery)
- **Guarantees**: Interfaces are stable. Implementations can be registered without modifying core modules.
- **Expects**: No implementations exist yet. These are forward-looking contracts.

## Dependencies
- **Uses**: `src/tool/types.ts` (ToolProvider references ToolDefinition/ToolResult)
- **Used by**: Nothing currently. Future integration points.
- **Boundary**: Extension interfaces live here. Implementations will live in separate packages or `src/extensions/<name>/`.

## Extension Points
- **DataSource**: Connect external message streams (Discord, Bluesky, webhooks). Produces `IncomingMessage`, optionally sends `OutgoingMessage`.
- **Coordinator**: Multi-agent routing with patterns: supervisor, round_robin, pipeline, voting.
- **Scheduler**: Cron or one-shot deferred tasks for background work ("sleep time compute").
- **ToolProvider**: Dynamic tool discovery from MCP servers, plugins, or remote registries.

## Key Files
- `data-source.ts` -- DataSource, IncomingMessage, OutgoingMessage
- `coordinator.ts` -- Coordinator, CoordinationPattern, AgentRef, AgentResponse
- `scheduler.ts` -- Scheduler, ScheduledTask
- `tool-provider.ts` -- ToolProvider
