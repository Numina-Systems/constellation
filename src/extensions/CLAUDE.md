# Extensions

Last verified: 2026-02-28

## Purpose
Defines extension point interfaces and hosts concrete implementations. Extension interfaces are contracts that plugins implement to extend the agent's capabilities.

## Contracts
- **Exposes**: `DataSource` (external message streams), `Coordinator` (multi-agent routing), `Scheduler` (deferred/periodic tasks), `ToolProvider` (dynamic tool discovery), plus concrete implementations via subdirectory re-exports
- **Guarantees**: Interfaces are stable. Implementations can be registered without modifying core modules.
- **Expects**: Implementations live in `src/extensions/<name>/` subdirectories.

## Dependencies
- **Uses**: `src/tool/types.ts` (ToolProvider references ToolDefinition/ToolResult)
- **Used by**: `src/index.ts` (composition root imports Bluesky source)
- **Boundary**: Extension interfaces live here. Implementations live in `src/extensions/<name>/`.

## Extension Points
- **DataSource**: Connect external message streams (Discord, Bluesky, webhooks). Produces `IncomingMessage`, optionally sends `OutgoingMessage`.
- **Coordinator**: Multi-agent routing with patterns: supervisor, round_robin, pipeline, voting.
- **Scheduler**: Cron or one-shot deferred tasks for background work ("sleep time compute").
- **ToolProvider**: Dynamic tool discovery from MCP servers, plugins, or remote registries.

## Implementations
- **Bluesky** (`bluesky/`): First DataSource implementation. See `bluesky/CLAUDE.md`.

## Key Files
- `data-source.ts` -- DataSource, IncomingMessage, OutgoingMessage
- `coordinator.ts` -- Coordinator, CoordinationPattern, AgentRef, AgentResponse
- `scheduler.ts` -- Scheduler, ScheduledTask
- `tool-provider.ts` -- ToolProvider
- `bluesky/` -- Bluesky DataSource implementation
