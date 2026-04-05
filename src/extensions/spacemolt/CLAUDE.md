# SpaceMolt

Last verified: 2026-04-05

## Purpose
Integrates the SpaceMolt multiplayer space game as an extension. Provides a DataSource (WebSocket event stream), ToolProvider (MCP-based game actions), game state machine, per-turn tool cycling, event classification, and capability seeding.

## Contracts
- **Exposes**: `createSpaceMoltSource(options)`, `createSpaceMoltToolProvider(options)`, `createGameStateManager(initial?)`, `createSpaceMoltLifecycle(options)`, `seedSpaceMoltCapabilities(store, embedding)`, `cycleSpaceMoltTools(options)`, `filterToolsByState(tools, state)`, `classifyEvent(type)`, `isHighPriority(type)`, `formatEventContent(event)`, `translateMcpTool(tool, prefix)`, `flattenMcpContent(content)`, all domain types (`GameState`, `GameStateManager`, `SpaceMoltEvent`, `SpaceMoltDataSource`, `SpaceMoltToolProvider`, `SpaceMoltLifecycle`, `EventTier`)
- **Guarantees**:
  - `GameState` is always one of `DOCKED | UNDOCKED | COMBAT | TRAVELING`
  - State transitions are deterministic from events (`nextStateFromEvent`) and tool results (`nextStateFromToolResult`)
  - Tool cycling registers only tools valid for current `GameState` using `ToolRegistry.unregister()` + `register()`
  - All tool names are prefixed `spacemolt:` to namespace them in the registry
  - `seedSpaceMoltCapabilities` is idempotent (checks for existing `spacemolt:capabilities` memory block)
  - Events classified into three tiers: `high` (combat, death, trade offers, scans), `internal` (tick, welcome, logged_in -- never surfaced), `normal` (everything else)
  - WebSocket source auto-reconnects on unexpected close; `disconnect()` suppresses reconnection
  - Tool provider handles session expiry with automatic reconnect-and-retry (single retry)
  - MCP tool schemas translated to `ToolDefinition` via `translateMcpTool`
- **Expects**: `MemoryStore` and `EmbeddingProvider` for capability seeding. `ToolRegistry` with `unregister()` support for tool cycling. Config section `[spacemolt]` with `username`, `password` when enabled.

## Dependencies
- **Uses**: `src/tool/types.ts` (ToolDefinition, ToolResult, ToolRegistry), `src/memory/store.ts` (MemoryStore for seeding), `src/embedding/types.ts` (EmbeddingProvider for seeding), `src/extensions/data-source.ts` (DataSource, IncomingMessage), `src/extensions/tool-provider.ts` (ToolProvider), `@modelcontextprotocol/sdk` (MCP client, StreamableHTTPClientTransport)
- **Used by**: `src/index.ts` (composition root), `src/extensions/index.ts` (barrel re-export)
- **Boundary**: All game I/O flows through MCP (tools) and WebSocket (events). No direct HTTP to game server.

## Key Decisions
- Per-turn tool cycling via `beforeTurn` hook: Avoids overwhelming the model with 100+ tools; registers only state-appropriate subset each turn
- Game state as finite state machine: Pure transitions make state changes testable and deterministic
- MCP for tool discovery: Game server exposes tools via MCP protocol; we translate to our `ToolDefinition` format with `spacemolt:` prefix
- WebSocket for events: Real-time game events (combat, chat, mining) flow through DataSource interface
- Capability seeding into working memory: Gives agent persistent context about how to play without polluting system prompt

## Invariants
- Tool names always carry `spacemolt:` prefix in the registry
- `filterToolsByState` exhaustive switch ensures all `GameState` values are handled (compile-time checked)
- State transitions never skip states -- they respond to specific events/tools or return current state

## Key Files
- `types.ts` -- `GameState`, `GameStateManager`, `SpaceMoltEvent`, `SpaceMoltDataSource`, `SpaceMoltToolProvider`
- `state.ts` -- `createGameStateManager()`, pure transition functions (`nextStateFromEvent`, `nextStateFromToolResult`)
- `tool-filter.ts` -- `filterToolsByState()`, tool allowlists per game state
- `schema.ts` -- `translateMcpTool()`, `flattenMcpContent()`, MCP-to-ToolDefinition translation
- `tool-provider.ts` -- `createSpaceMoltToolProvider()`, MCP client wrapper with session expiry handling
- `events.ts` -- `classifyEvent()`, `isHighPriority()`, `formatEventContent()`, event tier classification
- `source.ts` -- `createSpaceMoltSource()`, WebSocket DataSource with auth flow and auto-reconnect
- `lifecycle.ts` -- `createSpaceMoltLifecycle()`, coordinates source + tool provider start/stop
- `tool-cycling.ts` -- `cycleSpaceMoltTools()`, per-turn tool registration using `ToolRegistry.unregister()`
- `seed.ts` -- `seedSpaceMoltCapabilities()`, idempotent working memory seeding
