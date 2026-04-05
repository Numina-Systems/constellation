# SpaceMolt Integration Design

## Summary

SpaceMolt is a multiplayer space game designed for AI agents. This integration connects Constellation's "Machine Spirit" agent to SpaceMolt through two independent channels: an MCP (Model Context Protocol) client for issuing game commands, and a WebSocket connection for receiving real-time game events. The MCP channel dynamically discovers available actions from SpaceMolt's server and exposes a curated, context-sensitive subset to the agent each turn — adjusted based on the current game state (docked at a station, travelling, in combat, etc.). The WebSocket channel streams live events — combat updates, trade offers, chat messages — into the agent's conversation as they happen, with high-urgency events (combat, incoming scans) given priority processing.

Rather than building game-specific infrastructure, the integration deliberately reuses Constellation's existing systems for strategy: the three-tier memory system stores gameplay knowledge (profitable trade routes, combat outcomes, resource locations), SpaceMolt's free query tools are always available for research before acting, and the reflexion/prediction journaling system lets the agent review and improve its decision-making over time. The result is an agent that can autonomously play SpaceMolt as a persistent activity, waking and sleeping alongside its normal circadian cycle.

## Definition of Done

Constellation gains the ability to autonomously play SpaceMolt — a multiplayer space game for AI agents — through two integration channels and leverages existing systems for strategic gameplay.

1. **MCP ToolProvider**: First concrete implementation of the existing `ToolProvider` interface. Connects to SpaceMolt's MCP server (`https://game.spacemolt.com/mcp`), discovers available tools dynamically via `listTools()`, and exposes a context-appropriate subset (10-20 tools) to the agent per turn based on game state (docked/undocked/combat/travel). Tools appear in the registry like native tools.

2. **WebSocket DataSource**: Follows the Bluesky DataSource pattern. Connects to SpaceMolt's WebSocket endpoint (`wss://game.spacemolt.com/ws`) for real-time events (combat updates, chat messages, trade offers, mining yields, tick broadcasts). Events flow through the DataSource registry into the unified agent conversation.

3. **Session lifecycle**: Tied to constellation's activity cycle — session created on wake, maintained during activity, dropped on sleep. Credentials sourced from config/env vars (`SPACEMOLT_USERNAME`, `SPACEMOLT_PASSWORD`). Transparent reconnection on session expiry (30-minute timeout).

4. **Config extension**: `[spacemolt]` section in config.toml with enabled flag, credentials, and connection settings.

5. **Strategy through existing systems**: Agent uses its memory system to track gameplay patterns (trade routes, combat outcomes, resource locations), SpaceMolt query tools (`analyze_market`, `find_route`, `catalog`) for informed decision-making, and the reflexion/prediction journaling system to review and improve gameplay decisions over time.

**Out of scope:** Deno sandbox strategy scripts, website API integration (Clerk auth), agent self-registration.

## Acceptance Criteria

### spacemolt-integration.AC1: Config schema accepts SpaceMolt configuration
- **spacemolt-integration.AC1.1 Success:** Config with `[spacemolt]` section including `enabled = true`, `username`, `mcp_url`, `ws_url` parses successfully
- **spacemolt-integration.AC1.2 Success:** `SPACEMOLT_PASSWORD` env var overrides config `password` when spacemolt is enabled
- **spacemolt-integration.AC1.3 Success:** `SPACEMOLT_USERNAME` env var overrides config `username`
- **spacemolt-integration.AC1.4 Failure:** Config with `mcp_url = "not-a-url"` is rejected by schema validation

### spacemolt-integration.AC2: MCP ToolProvider discovers and executes tools
- **spacemolt-integration.AC2.1 Success:** `discover()` connects to MCP server and returns `ToolDefinition[]` with `spacemolt:` prefixed names
- **spacemolt-integration.AC2.2 Success:** JSON Schema `string`/`number`/`boolean` properties translate to matching `ToolParameter` types
- **spacemolt-integration.AC2.3 Success:** JSON Schema `object`/`array` properties translate to `ToolParameter` with type `"object"` or `"array"`
- **spacemolt-integration.AC2.4 Success:** `execute()` strips `spacemolt:` prefix and calls MCP `callTool()` with correct name
- **spacemolt-integration.AC2.5 Success:** MCP content blocks (text) are flattened into `ToolResult.output` string
- **spacemolt-integration.AC2.6 Edge:** `notifications/tools/list_changed` triggers tool list refresh

### spacemolt-integration.AC3: Game state tracking and tool filtering
- **spacemolt-integration.AC3.1 Success:** Initial state derived from `logged_in` response (docked_at_base → DOCKED, else UNDOCKED)
- **spacemolt-integration.AC3.2 Success:** `combat_update` event transitions state to COMBAT
- **spacemolt-integration.AC3.3 Success:** Tool result with destination/arrival_tick transitions state to TRAVELING
- **spacemolt-integration.AC3.4 Success:** `filterToolsByState("DOCKED", tools)` returns docked tools (buy, sell, repair, undock, etc.)
- **spacemolt-integration.AC3.5 Success:** "Always" group (get_status, get_ship, chat, help, catalog, analyze_market, find_route) included in all states
- **spacemolt-integration.AC3.6 Success:** Per-turn cycling unregisters previous `spacemolt:*` tools and registers new subset
- **spacemolt-integration.AC3.7 Edge:** Native tools are unaffected by SpaceMolt tool cycling

### spacemolt-integration.AC4: WebSocket DataSource streams real-time events
- **spacemolt-integration.AC4.1 Success:** WebSocket connects and authenticates via login message
- **spacemolt-integration.AC4.2 Success:** `combat_update` events classified as high priority and converted to `IncomingMessage`
- **spacemolt-integration.AC4.3 Success:** `chat_message` events classified as normal priority
- **spacemolt-integration.AC4.4 Success:** `tick` events update state manager but are not forwarded as `IncomingMessage`
- **spacemolt-integration.AC4.5 Success:** `IncomingMessage.content` contains human-readable event summary
- **spacemolt-integration.AC4.6 Edge:** Event queue drops oldest when at capacity

### spacemolt-integration.AC5: Session lifecycle tied to activity cycle
- **spacemolt-integration.AC5.1 Success:** Wake event creates MCP + WebSocket sessions and authenticates both
- **spacemolt-integration.AC5.2 Success:** Sleep event disconnects WebSocket and closes MCP client
- **spacemolt-integration.AC5.3 Success:** `session_invalid` error during `execute()` triggers transparent reconnect and retry
- **spacemolt-integration.AC5.4 Edge:** No reconnection attempted during sleep hours

### spacemolt-integration.AC6: Memory seeding and strategy
- **spacemolt-integration.AC6.1 Success:** Pinned working memory block `spacemolt:capabilities` seeded on first run
- **spacemolt-integration.AC6.2 Success:** Re-running seed is idempotent (no duplicate blocks)
- **spacemolt-integration.AC6.3 Success:** Capabilities block mentions prediction journaling and memory-based tracking

### spacemolt-integration.AC7: Composition root wiring
- **spacemolt-integration.AC7.1 Success:** `config.spacemolt.enabled = true` activates SpaceMolt integration
- **spacemolt-integration.AC7.2 Success:** SpaceMolt DataSource registered with DataSource registry including `highPriorityFilter`
- **spacemolt-integration.AC7.3 Success:** Per-source instructions injected for SpaceMolt event formatting
- **spacemolt-integration.AC7.4 Success:** Tool cycling integrated into agent turn
- **spacemolt-integration.AC7.5 Edge:** `config.spacemolt.enabled = false` (or absent) does not create any SpaceMolt components

## Glossary

- **MCP (Model Context Protocol)**: An open protocol for exposing tools and resources to LLM agents. SpaceMolt implements an MCP server; this integration connects to it using the `@modelcontextprotocol/sdk` client library to discover and invoke game actions.
- **StreamableHTTPClientTransport**: The MCP SDK transport that communicates over HTTP with streaming support. Used here to connect to SpaceMolt's MCP endpoint.
- **DataSource**: A Constellation extension interface for components that push events into the agent's conversation. Bluesky (via Jetstream) is the existing implementation this design follows.
- **ToolProvider**: A Constellation extension interface for components that supply tools to the agent's tool registry. SpaceMolt's MCP integration is the first concrete implementation.
- **`ToolRegistry`**: The central registry in Constellation that maps tool names to their implementations. The agent dispatches tool calls through it.
- **Per-turn tool cycling**: A new pattern introduced here — SpaceMolt tools are unregistered and re-registered each agent turn based on game state, unlike native tools which register once at startup.
- **Game state (DOCKED / UNDOCKED / COMBAT / TRAVELING)**: An enum tracked by the Game State Manager, derived from WebSocket events and tool call results. Controls which SpaceMolt tools are exposed to the agent.
- **`highPriorityFilter`**: A predicate on a `DataSourceRegistration` that marks certain incoming events as high priority, allowing the activity interceptor to fast-track them ahead of the normal event queue.
- **DataSource registry**: Constellation's unified registry (from the `efficient-agent-loop` branch) that collects events from all registered DataSources and feeds them into the agent conversation.
- **Reflexion / prediction journaling**: An existing Constellation subsystem where the agent logs predictions about outcomes and later reviews their accuracy, used here to let the agent improve its gameplay decisions over time.
- **Working memory (pinned block)**: A tier of Constellation's three-tier memory system. Pinned blocks persist across sessions and are always injected into the agent's context — used here to seed SpaceMolt capability descriptions.
- **Idempotent seeding**: A pattern in this codebase where initial memory or config is written on first run only — re-running the seed produces no duplicates.
- **Functional Core / Imperative Shell**: Constellation's architectural convention. Pure functions with no side effects (functional core) are separated from components that perform I/O or manage state (imperative shell). All files are annotated accordingly.
- **Bounded event queue**: A fixed-capacity queue that drops the oldest item when full, preventing unbounded memory growth from high-frequency WebSocket events.
- **JSON Schema `inputSchema`**: The parameter schema format used by MCP tools. Constellation's `ToolParameter` type is a flat structure, so MCP schemas are translated (lossily) during discovery.
- **`efficient-agent-loop`**: A Constellation development branch that introduces the DataSource registry, `highPriorityFilter`, and unified agent loop. This design assumes it is merged before implementation.
- **Tick**: SpaceMolt's server-side game clock, firing approximately every 10 seconds. MCP tool calls block until the next tick resolves.

## Architecture

Dual-channel integration: MCP client for tool execution, WebSocket for real-time event streaming. Both connections share credentials but operate independently — MCP handles agent-initiated actions, WebSocket handles server-pushed events.

### Components

**SpaceMolt MCP ToolProvider** (`src/extensions/spacemolt/tool-provider.ts`): First concrete `ToolProvider` implementation. Wraps the MCP SDK client (`@modelcontextprotocol/sdk`). Connects to `https://game.spacemolt.com/mcp` via `StreamableHTTPClientTransport`. `discover()` calls `listTools()`, translates MCP `Tool` objects (JSON Schema `inputSchema`) into constellation `ToolDefinition[]` (flat `ToolParameter[]`). `execute()` calls `callTool()`, flattens content blocks into a string `ToolResult`. Handles session auth (login after connect). Listens for `notifications/tools/list_changed` to refresh the tool cache.

**SpaceMolt WebSocket DataSource** (`src/extensions/spacemolt/source.ts`): Implements `DataSource`. Connects to `wss://game.spacemolt.com/ws`, authenticates via login message, receives real-time events. Uses a bounded event queue (same `createEventQueue` pattern as Bluesky). Converts WebSocket events into `IncomingMessage` objects with `source: "spacemolt"`. Classifies events into three tiers: high priority (combat, trade offers, scans), normal (chat, mining yields, skill-ups), and internal (tick counter, welcome — not forwarded to agent).

**Game State Manager** (`src/extensions/spacemolt/state.ts`): Pure function module. Maintains current game state enum (`DOCKED`, `UNDOCKED`, `COMBAT`, `TRAVELING`) derived from WebSocket events and tool call results. The `logged_in` response provides initial state. Subsequent state transitions inferred from events (`combat_update` → COMBAT, `ok` with destination → TRAVELING) and tool results (dock → DOCKED, undock → UNDOCKED). Exposes `getGameState()` for the tool filter.

**Tool Filter** (`src/extensions/spacemolt/tool-filter.ts`): Pure function. Given current game state and the full MCP tool list, returns the subset of tools to expose this turn. Defines state-to-tool-group mappings. An "always" group (get_status, get_ship, get_cargo, chat, help, catalog, get_skills, analyze_market, find_route, search_systems) is included regardless of state. Tools are namespaced with `spacemolt:` prefix to prevent collisions with native tools.

**Memory Seeding** (`src/extensions/spacemolt/seed.ts`): Idempotent seeding following the Bluesky pattern. Seeds one pinned working memory block (`spacemolt:capabilities`) describing the game, available actions, what to track in memory, and encouragement to use prediction journaling for gameplay decisions.

**Config Extension** (`src/config/schema.ts`): `[spacemolt]` section with `enabled` (boolean), `username` (string), `password` (string, optional — env override), `mcp_url` (URL, default `https://game.spacemolt.com/mcp`), `ws_url` (URL, default `wss://game.spacemolt.com/ws`), `event_queue_capacity` (positive integer, default 50).

### Contracts

```typescript
// Game state enum
type GameState = "DOCKED" | "UNDOCKED" | "COMBAT" | "TRAVELING";

// SpaceMolt-specific DataSource (extends DataSource)
interface SpaceMoltDataSource extends DataSource {
  readonly name: "spacemolt";
  getGameState(): GameState;
}

// ToolProvider implementation (satisfies existing interface)
interface SpaceMoltToolProvider extends ToolProvider {
  readonly name: "spacemolt";
  discover(): Promise<Array<ToolDefinition>>;
  execute(tool: string, params: Record<string, unknown>): Promise<ToolResult>;
  refreshTools(): Promise<void>;
  close(): Promise<void>;
}

// Tool filter — pure function
function filterToolsByState(
  allTools: ReadonlyArray<ToolDefinition>,
  state: GameState,
): Array<ToolDefinition>;

// Config schema addition
type SpaceMoltConfig = {
  enabled: boolean;
  username: string;
  password?: string;
  mcp_url: string;   // default: "https://game.spacemolt.com/mcp"
  ws_url: string;     // default: "wss://game.spacemolt.com/ws"
  event_queue_capacity: number; // default: 50
};
```

### Data Flow

**Tool execution:** Agent turn starts → `getGameState()` returns current state → `filterToolsByState()` selects relevant group → tools registered in registry (previous SpaceMolt tools unregistered) → agent calls e.g. `spacemolt:mine` → `registry.dispatch()` routes to `ToolProvider.execute()` → strips `spacemolt:` prefix → MCP `callTool("mine", {})` → SpaceMolt server processes on next tick (call blocks) → response flattened to `ToolResult` → agent sees result → game state manager updates state from result.

**Real-time events:** WebSocket receives event → classified by tier → high/normal priority events converted to `IncomingMessage` → pushed to bounded event queue → DataSource registry feeds to agent via `processEvents()` → combat events pass through `highPriorityFilter` for activity interceptor priority → agent processes event in conversation.

**Session lifecycle:** Activity manager fires wake → composition root calls `spacemoltSource.connect()` (WebSocket auth) and `spacemoltToolProvider.discover()` (MCP connect + auth + listTools) → tools populated, events flowing. On sleep → `spacemoltSource.disconnect()` + `spacemoltToolProvider.close()`. On session expiry (30-min inactivity) → next `execute()` call detects `session_invalid` → creates new HTTP session → re-authenticates → retries call.

### Schema Translation

MCP tools use JSON Schema (`inputSchema` with nested objects, arrays, oneOf). Constellation's `ToolParameter` is flat (name, type, required, enum_values). Translation strategy:

- Top-level string/number/boolean properties → direct mapping to `ToolParameter`
- Top-level object/array properties → type set to `"object"` or `"array"`, LLM passes JSON, MCP server validates full schema
- `enum` → `enum_values`
- `description` → pass-through

This is intentionally lossy at the constellation layer. The MCP server is the schema validation authority, not the tool registry. The registry provides enough type information for the LLM to generate reasonable calls.

### Per-Turn Tool Registration

Unlike native tools (registered once at startup), SpaceMolt tools cycle each turn:

1. Unregister all tools with `spacemolt:` prefix
2. Query `getGameState()` for current state
3. `filterToolsByState()` selects relevant subset
4. Register selected tools in the registry

Native tools are untouched. The `spacemolt:` prefix namespacing prevents collisions (e.g., a native `search` tool won't conflict with `spacemolt:search_systems`).

### Event Classification

| Tier | Events | Handling |
|------|--------|----------|
| High priority | `combat_update`, `player_died`, `trade_offer_received`, `scan_detected`, `pilotless_ship` | `highPriorityFilter` returns true, processed ahead of queue |
| Normal | `chat_message`, `mining_yield`, `skill_level_up`, `scan_result`, `trade_offer_*` (accept/decline/cancel) | Queued, processed in order |
| Internal | `tick`, `welcome`, `logged_in` | Consumed by state manager, not forwarded to agent |

### Combat Urgency

When WebSocket receives `combat_update`, game state transitions to COMBAT. The combat tool group is exposed (attack, scan, cloak, reload, get_battle_status, self_destruct). The `highPriorityFilter` predicate on the DataSource registration returns true for combat events, ensuring they're processed ahead of normal-priority items by the activity interceptor from the `efficient-agent-loop` DataSource registry.

### Strategy Integration

No new infrastructure. Three existing systems applied to SpaceMolt:

**Memory:** Agent stores gameplay knowledge (trade route profitability, resource-rich locations, combat outcomes, faction relationships) using existing `memory_write` tool. Retrieved via `memory_read` when making decisions. The seeded capabilities block prompts the agent to track this information.

**Query tools:** SpaceMolt's free query tools (`analyze_market`, `find_route`, `catalog`, `get_system`, `search_systems`) are in the "always" tool group — available every turn regardless of state. No tick cost. The agent researches before acting.

**Reflexion:** Agent predicts outcomes using existing `predict` tool ("Mining iron at Alpha Centauri will yield 200+ credits after selling at Sol") and annotates with `annotate_prediction`. The hourly `review-predictions` task (with dynamic gate from `efficient-agent-loop`) reviews accuracy over time.

## Existing Patterns

This design follows established patterns from codebase investigation:

- **DataSource pattern**: `SpaceMoltDataSource` implements the `DataSource` interface exactly as Bluesky does — `connect()`, `disconnect()`, `onMessage()`, bounded event queue, per-source instructions via `DataSourceRegistration`.
- **ToolProvider pattern**: `SpaceMoltToolProvider` is the first concrete implementation of the existing `ToolProvider` interface in `src/extensions/tool-provider.ts`. The interface was designed for exactly this use case.
- **Factory functions over classes**: `createSpaceMoltSource()` and `createSpaceMoltToolProvider()` return interfaces, matching `createBlueskySource()`, `createToolRegistry()`, etc.
- **Memory seeding**: Idempotent seed function following `seedBlueskyTemplates()` pattern — check for existing blocks before writing, pinned working memory for capabilities.
- **Config extension**: `[spacemolt]` section with env var override (`SPACEMOLT_PASSWORD`) matching existing credential patterns.
- **Event queue**: Reuses `createEventQueue(capacity)` from `src/extensions/bluesky/event-queue.ts`.
- **DataSource registry**: Plugs into `createDataSourceRegistry()` from `efficient-agent-loop` with `highPriorityFilter` for combat events, per-source instructions for event formatting.
- **Pattern annotations**: All new files annotate `// pattern: Functional Core` or `// pattern: Imperative Shell`.

**Divergence from existing patterns:**

- **Per-turn tool cycling**: Native tools register once at startup. SpaceMolt tools re-register each turn based on game state. This is new but doesn't modify the registry — it just calls `register()` and would need an `unregister()` method added to `ToolRegistry`.
- **External dependency**: `@modelcontextprotocol/sdk` is a new dependency. No existing adapter uses MCP. Justified because SpaceMolt recommends MCP as the primary AI integration path, and the SDK provides transport, tool discovery, and invocation out of the box.
- **Dual connection per extension**: Bluesky uses a single WebSocket (Jetstream). SpaceMolt needs both WebSocket (events) and MCP (tools). Both live under one extension directory but are separate components with separate lifecycles.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Config Schema & Dependency Setup
**Goal:** Accept `[spacemolt]` configuration and add MCP SDK dependency.

**Components:**
- `src/config/schema.ts` — add `SpaceMoltConfigSchema` with enabled, username, password, mcp_url, ws_url, event_queue_capacity
- `src/config/config.ts` — add `SPACEMOLT_PASSWORD` and `SPACEMOLT_USERNAME` env overrides
- `package.json` — add `@modelcontextprotocol/sdk` dependency

**Dependencies:** None (first phase)

**Done when:** Config with `[spacemolt]` section parses and validates. Invalid configs rejected. Env overrides work. `bun install` succeeds. `bun run build` succeeds. Tests cover valid configs, invalid configs, and env overrides.

**Covers:** `spacemolt-integration.AC1.1`, `spacemolt-integration.AC1.2`, `spacemolt-integration.AC1.3`, `spacemolt-integration.AC1.4`
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Game State Manager & Tool Filter
**Goal:** Pure functions for tracking game state and filtering tools by state.

**Components:**
- `src/extensions/spacemolt/state.ts` — game state enum, state transition logic, `createGameStateManager()` factory returning `getGameState()` and `updateFromEvent()`/`updateFromToolResult()` methods
- `src/extensions/spacemolt/tool-filter.ts` — state-to-tool-group mappings, `filterToolsByState()` pure function
- `src/extensions/spacemolt/types.ts` — `GameState`, `SpaceMoltDataSource`, `SpaceMoltToolProvider` types

**Dependencies:** None (pure functions, no external deps)

**Done when:** Game state transitions correctly from events and tool results. Tool filter returns correct subsets per state. "Always" group included in all states. Tests cover all state transitions and tool group selections.

**Covers:** `spacemolt-integration.AC3.1`, `spacemolt-integration.AC3.2`, `spacemolt-integration.AC3.3`, `spacemolt-integration.AC3.4`, `spacemolt-integration.AC3.5`
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: MCP ToolProvider
**Goal:** Connect to SpaceMolt's MCP server, discover tools, execute commands.

**Components:**
- `src/extensions/spacemolt/tool-provider.ts` — `createSpaceMoltToolProvider()` factory, MCP client setup with `StreamableHTTPClientTransport`, `discover()` with JSON Schema → ToolParameter translation, `execute()` with content block flattening, tool list change notification listener
- `src/extensions/spacemolt/schema.ts` — JSON Schema to `ToolParameter[]` translation helpers

**Dependencies:** Phase 1 (config, MCP SDK), Phase 2 (types)

**Done when:** `discover()` connects to MCP server and returns translated `ToolDefinition[]`. `execute()` calls MCP tools and returns `ToolResult`. Schema translation handles string/number/boolean/object/array types. `spacemolt:` prefix applied to tool names. Content blocks flattened to string output. Tests cover discovery, execution, schema translation, and error handling.

**Covers:** `spacemolt-integration.AC2.1`, `spacemolt-integration.AC2.2`, `spacemolt-integration.AC2.3`, `spacemolt-integration.AC2.4`, `spacemolt-integration.AC2.5`, `spacemolt-integration.AC2.6`
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: WebSocket DataSource
**Goal:** Real-time event streaming from SpaceMolt with event classification.

**Components:**
- `src/extensions/spacemolt/source.ts` — `createSpaceMoltSource()` factory, WebSocket connection, login auth, event parsing, tier classification, `IncomingMessage` conversion
- `src/extensions/spacemolt/event-queue.ts` — reuses `createEventQueue` from Bluesky or imports shared utility

**Dependencies:** Phase 1 (config), Phase 2 (game state manager — events update state)

**Done when:** WebSocket connects and authenticates. Events classified into high/normal/internal tiers. High and normal events converted to `IncomingMessage` with readable content strings. Internal events (tick, welcome) update state manager but don't forward. Bounded event queue prevents overflow. `highPriorityFilter` returns true for combat/trade/scan events. Tests cover connection, event classification, message conversion, and queue behaviour.

**Covers:** `spacemolt-integration.AC4.1`, `spacemolt-integration.AC4.2`, `spacemolt-integration.AC4.3`, `spacemolt-integration.AC4.4`, `spacemolt-integration.AC4.5`, `spacemolt-integration.AC4.6`
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Session Lifecycle
**Goal:** Tie SpaceMolt connections to constellation's activity cycle with transparent reconnection.

**Components:**
- `src/extensions/spacemolt/session.ts` — session management: create, authenticate, detect expiry, reconnect. Shared between MCP and WebSocket connections.
- `src/extensions/spacemolt/tool-provider.ts` — add session expiry detection and retry in `execute()`
- `src/extensions/spacemolt/source.ts` — add reconnection on WebSocket close during wake hours

**Dependencies:** Phase 3 (MCP tool provider), Phase 4 (WebSocket DataSource)

**Done when:** Session created on wake, closed on sleep. `session_invalid` errors trigger transparent reconnect (new session, re-auth, retry). WebSocket reconnects on unexpected close during wake. No reconnection attempted during sleep. Tests cover wake/sleep lifecycle, session expiry recovery, and reconnection.

**Covers:** `spacemolt-integration.AC5.1`, `spacemolt-integration.AC5.2`, `spacemolt-integration.AC5.3`, `spacemolt-integration.AC5.4`
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Memory Seeding & Strategy Wiring
**Goal:** Seed capabilities into agent memory and wire strategy through existing systems.

**Components:**
- `src/extensions/spacemolt/seed.ts` — `seedSpaceMoltCapabilities()` idempotent seeding of pinned working memory block describing the game, available actions, what to track, and encouragement to predict/reflect
- `src/extensions/spacemolt/index.ts` — barrel exports for all SpaceMolt extension components

**Dependencies:** Phase 2 (types), Phase 3 (tool provider — capabilities reference tool names)

**Done when:** Capabilities block seeded into working memory (pinned, readonly). Seeding is idempotent. Block content describes the game, suggests tracking trade routes/combat outcomes/resources in memory, encourages prediction journaling. Tests verify seeding, idempotency, and block content.

**Covers:** `spacemolt-integration.AC6.1`, `spacemolt-integration.AC6.2`, `spacemolt-integration.AC6.3`
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: ToolRegistry Extension & Per-Turn Tool Cycling
**Goal:** Add `unregister()` to ToolRegistry and implement per-turn tool cycling for SpaceMolt.

**Components:**
- `src/tool/types.ts` — add `unregister(name: string): void` to `ToolRegistry` interface
- `src/tool/registry.ts` — implement `unregister()` (remove tool by name, no-op if not found)
- `src/extensions/spacemolt/tool-cycling.ts` — `cycleSpaceMoltTools()` function: unregister previous `spacemolt:*` tools, query game state, filter, register new subset

**Dependencies:** Phase 2 (tool filter, game state), Phase 3 (tool provider), Phase 6 (barrel exports)

**Done when:** `unregister()` removes tools from registry. Per-turn cycling correctly swaps tool subsets based on game state. Native tools unaffected by cycling. Tests cover unregister, cycling between states, and non-interference with native tools.

**Covers:** `spacemolt-integration.AC3.6`, `spacemolt-integration.AC3.7`
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: Composition Root Wiring
**Goal:** Wire SpaceMolt extension into the composition root alongside Bluesky.

**Components:**
- `src/index.ts` — when `config.spacemolt.enabled`: create SpaceMolt source + tool provider, register with DataSource registry (with highPriorityFilter and per-source instructions), seed capabilities, wire session lifecycle to activity manager wake/sleep, integrate tool cycling into agent turn
- `src/extensions/spacemolt/index.ts` — ensure all public API exported

**Dependencies:** All previous phases

**Done when:** `config.spacemolt.enabled = true` activates SpaceMolt integration. DataSource registered with highPriorityFilter for combat events. Tools discovered and cycled per turn. Session tied to wake/sleep. Memory seeded. `bun run build` succeeds. End-to-end smoke test with mocked SpaceMolt responses passes.

**Covers:** `spacemolt-integration.AC7.1`, `spacemolt-integration.AC7.2`, `spacemolt-integration.AC7.3`, `spacemolt-integration.AC7.4`, `spacemolt-integration.AC7.5`
<!-- END_PHASE_8 -->

## Additional Considerations

**MCP session vs WebSocket session:** SpaceMolt's HTTP API uses `X-Session-Id` headers, and the MCP transport likely manages sessions similarly. The WebSocket authenticates via login message and stays authenticated for the connection lifetime. These are separate sessions that happen to use the same credentials. Session management must handle both independently — MCP session expiry doesn't imply WebSocket disconnection and vice versa.

**Tool count and context budget:** Even with state-based filtering, the agent may see 20-30 tools per turn (SpaceMolt subset + native tools). Each tool definition consumes context tokens. This interacts with the existing context budget issue (the compaction trigger that undercounts). Monitor actual token usage after integration.

**Schema translation fidelity:** The lossy JSON Schema → ToolParameter translation means some complex parameter structures (nested objects with specific field requirements) will appear as opaque `object` types to the LLM. In practice, SpaceMolt's tools tend to have flat parameter lists (item_id, quantity, target_id), so this is unlikely to be a problem. If specific tools have complex schemas that the LLM struggles with, individual tool descriptions can be enriched during translation.

**Tick pacing and LLM latency:** SpaceMolt ticks every ~10 seconds. MCP calls block until tick resolution. If the LLM takes 5+ seconds to decide, the agent effectively plays every other tick at best. During combat, this could be a disadvantage against faster agents. The hybrid urgency approach (combat events fast-tracked) mitigates this but doesn't eliminate it.

**`efficient-agent-loop` dependency:** This design assumes the DataSource registry, `DataSourceRegistration` with `highPriorityFilter`, generic activity interceptor, and unified agent are all merged. If implementing before that branch merges, the WebSocket DataSource and combat urgency features would need to be wired manually in the composition root using the older Bluesky-specific pattern.
