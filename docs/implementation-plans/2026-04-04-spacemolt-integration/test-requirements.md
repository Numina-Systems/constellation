# Test Requirements: SpaceMolt Integration

## Automated Tests

### AC1: Config schema accepts SpaceMolt configuration

**spacemolt-integration.AC1.1** -- Config with `[spacemolt]` section including `enabled = true`, `username`, `mcp_url`, `ws_url` parses successfully
- Test type: Unit
- Test file: `src/config/schema.test.ts`
- Description: Parse a full SpaceMolt config object through `SpaceMoltConfigSchema` and assert all fields resolve to expected values, including defaults for `mcp_url`, `ws_url`, and `event_queue_capacity`.

**spacemolt-integration.AC1.2** -- `SPACEMOLT_PASSWORD` env var overrides config `password` when spacemolt is enabled
- Test type: Unit
- Test file: `src/config/env-override.test.ts`
- Description: Write a TOML config with `[spacemolt]` section containing a password. Set `SPACEMOLT_PASSWORD` env var to a different value. Load config via `loadConfig()`. Assert the loaded password matches the env var, not the TOML value.

**spacemolt-integration.AC1.3** -- `SPACEMOLT_USERNAME` env var overrides config `username`
- Test type: Unit
- Test file: `src/config/env-override.test.ts`
- Description: Same pattern as AC1.2 but for `SPACEMOLT_USERNAME`. Assert the loaded username matches the env var value.

**spacemolt-integration.AC1.4** -- Config with `mcp_url = "not-a-url"` is rejected by schema validation
- Test type: Unit
- Test file: `src/config/schema.test.ts`
- Description: Pass an object with `mcp_url: "not-a-url"` to `SpaceMoltConfigSchema.parse()`. Assert it throws `ZodError` with a validation message on the `mcp_url` path.

---

### AC2: MCP ToolProvider discovers and executes tools

**spacemolt-integration.AC2.1** -- `discover()` connects to MCP server and returns `ToolDefinition[]` with `spacemolt:` prefixed names
- Test type: Unit (mocked MCP client)
- Test file: `src/extensions/spacemolt/tool-provider.test.ts`
- Description: Inject a mock MCP client that returns a predetermined tool list from `listTools()`. Call `discover()` and assert all returned `ToolDefinition` names are prefixed with `spacemolt:`.

**spacemolt-integration.AC2.2** -- JSON Schema `string`/`number`/`boolean` properties translate to matching `ToolParameter` types
- Test type: Unit
- Test file: `src/extensions/spacemolt/schema.test.ts`
- Description: Pass an MCP tool with `inputSchema` containing `string`, `number`/`integer`, and `boolean` typed properties to `translateMcpTool()`. Assert each resulting `ToolParameter` has the correct mapped type.

**spacemolt-integration.AC2.3** -- JSON Schema `object`/`array` properties translate to `ToolParameter` with type `"object"` or `"array"`
- Test type: Unit
- Test file: `src/extensions/spacemolt/schema.test.ts`
- Description: Pass an MCP tool with `object` and `array` typed properties. Assert the translated `ToolParameter` types are `"object"` and `"array"` respectively.

**spacemolt-integration.AC2.4** -- `execute()` strips `spacemolt:` prefix and calls MCP `callTool()` with correct name
- Test type: Unit (mocked MCP client)
- Test file: `src/extensions/spacemolt/tool-provider.test.ts`
- Description: Call `execute("spacemolt:mine", {})`. Assert the mock MCP client's `callTool` was invoked with `name: "mine"`, not `"spacemolt:mine"`.

**spacemolt-integration.AC2.5** -- MCP content blocks (text) are flattened into `ToolResult.output` string
- Test type: Unit
- Test file: `src/extensions/spacemolt/schema.test.ts`
- Description: Pass `[{ type: "text", text: "Line 1" }, { type: "text", text: "Line 2" }]` to `flattenMcpContent()`. Assert result is `"Line 1\nLine 2"`.

**spacemolt-integration.AC2.6** -- `notifications/tools/list_changed` triggers tool list refresh
- Test type: Unit (mocked MCP client)
- Test file: `src/extensions/spacemolt/tool-provider.test.ts`
- Description: After `discover()`, simulate the `notifications/tools/list_changed` notification via the mock client's `on` handler. Assert `listTools()` is called a second time and the tool cache is updated.

---

### AC3: Game state tracking and tool filtering

**spacemolt-integration.AC3.1** -- Initial state derived from `logged_in` response (docked_at_base -> DOCKED, else UNDOCKED)
- Test type: Unit
- Test file: `src/extensions/spacemolt/state.test.ts`
- Description: Test pure reducers: `nextStateFromEvent` and `nextStateFromToolResult`. Also test factory: `createGameStateManager()` with `reset("DOCKED")` → `getGameState()` returns `"DOCKED"`.

**spacemolt-integration.AC3.2** -- `combat_update` event transitions state to COMBAT
- Test type: Unit
- Test file: `src/extensions/spacemolt/state.test.ts`
- Description: Call `nextStateFromEvent("UNDOCKED", { type: "combat_update", payload: {} })`. Assert result is `"COMBAT"`. Also test via factory `updateFromEvent`.

**spacemolt-integration.AC3.3** -- Tool result with destination/arrival_tick transitions state to TRAVELING
- Test type: Unit
- Test file: `src/extensions/spacemolt/state.test.ts`
- Description: Call `nextStateFromToolResult("UNDOCKED", "travel", { destination: "Alpha Centauri", arrival_tick: 100 })`. Assert result is `"TRAVELING"`.

**spacemolt-integration.AC3.4** -- `filterToolsByState("DOCKED", tools)` returns docked tools
- Test type: Unit
- Test file: `src/extensions/spacemolt/tool-filter.test.ts`
- Description: Create mock `ToolDefinition` array. Call `filterToolsByState(allTools, "DOCKED")`. Assert includes `spacemolt:buy`, `spacemolt:sell`, excludes `spacemolt:mine`, `spacemolt:attack`.

**spacemolt-integration.AC3.5** -- "Always" group included in all states
- Test type: Unit
- Test file: `src/extensions/spacemolt/tool-filter.test.ts`
- Description: For each state, call `filterToolsByState()` and assert always-tools present.

**spacemolt-integration.AC3.6** -- Per-turn cycling unregisters previous `spacemolt:*` tools and registers new subset
- Test type: Unit
- Test file: `src/extensions/spacemolt/tool-cycling.test.ts`
- Description: Register docked tools. Cycle to COMBAT. Assert docked-only tools gone, combat tools present. Also test consecutive cycling doesn't throw.

**spacemolt-integration.AC3.7** -- Native tools are unaffected by SpaceMolt tool cycling
- Test type: Unit
- Test file: `src/extensions/spacemolt/tool-cycling.test.ts`
- Description: Register native `memory_read` + SpaceMolt tools. Cycle. Assert `memory_read` still present.

---

### AC4: WebSocket DataSource streams real-time events

**spacemolt-integration.AC4.1** -- WebSocket connects and authenticates via login message
- Test type: Unit (mocked WebSocket)
- Test file: `src/extensions/spacemolt/source.test.ts`
- Description: Mock WebSocket sends `welcome`, expects `login`, responds `logged_in`. Assert `connect()` completes.

**spacemolt-integration.AC4.2** -- `combat_update` events classified as high priority
- Test type: Unit
- Test file: `src/extensions/spacemolt/events.test.ts`
- Description: `classifyEvent("combat_update")` returns `"high"`. `isHighPriority("combat_update")` returns `true`.

**spacemolt-integration.AC4.3** -- `chat_message` events classified as normal priority
- Test type: Unit
- Test file: `src/extensions/spacemolt/events.test.ts`
- Description: `classifyEvent("chat_message")` returns `"normal"`.

**spacemolt-integration.AC4.4** -- `tick` events not forwarded as `IncomingMessage`
- Test type: Unit
- Test file: `src/extensions/spacemolt/source.test.ts`
- Description: Simulate `tick` event. Assert message handler NOT called. Assert game state manager updated.

**spacemolt-integration.AC4.5** -- `IncomingMessage.content` contains human-readable summary
- Test type: Unit
- Test file: `src/extensions/spacemolt/events.test.ts`
- Description: `formatEventContent` for combat event includes attacker, target, damage.

**spacemolt-integration.AC4.6** -- Event queue drops oldest at capacity
- Test type: Unit
- Test file: `src/extensions/spacemolt/source.test.ts`
- Description: Verify source calls `messageHandler` for non-internal events (queue backpressure handled by DataSource registry's shared `createEventQueue`).

---

### AC5: Session lifecycle tied to activity cycle

**spacemolt-integration.AC5.1** -- Wake creates sessions
- Test type: Unit
- Test file: `src/extensions/spacemolt/lifecycle.test.ts`
- Description: `start()` calls `source.connect()` then `toolProvider.discover()`. `isRunning()` is `true`.

**spacemolt-integration.AC5.2** -- Sleep disconnects
- Test type: Unit
- Test file: `src/extensions/spacemolt/lifecycle.test.ts`
- Description: `stop()` calls `source.disconnect()` then `toolProvider.close()`. `isRunning()` is `false`.

**spacemolt-integration.AC5.3** -- Session expiry retry
- Test type: Unit
- Test file: `src/extensions/spacemolt/tool-provider.test.ts`
- Description: First `callTool` throws `session_invalid` → reconnect → retry succeeds. Also: non-session error → no reconnect.

**spacemolt-integration.AC5.4** -- No reconnection during sleep
- Test type: Unit
- Test file: `src/extensions/spacemolt/source.test.ts`
- Description: `shouldReconnect = false` → WebSocket close → no reconnect attempt.

---

### AC6: Memory seeding and strategy

**spacemolt-integration.AC6.1** -- Capabilities block seeded
- Test type: Unit
- Test file: `src/extensions/spacemolt/seed.test.ts`
- Description: After seed, `createBlock` called with `spacemolt:capabilities`, working tier, pinned, readonly.

**spacemolt-integration.AC6.2** -- Idempotent seeding
- Test type: Unit
- Test file: `src/extensions/spacemolt/seed.test.ts`
- Description: Second call with existing block → `createBlock` NOT called. Single check sufficient since only one block is seeded.

**spacemolt-integration.AC6.3** -- Capabilities mentions prediction journaling
- Test type: Unit
- Test file: `src/extensions/spacemolt/seed.test.ts`
- Description: Block content contains "predict", "annotate_prediction", "memory_write".

---

### AC7: Composition root wiring

**spacemolt-integration.AC7.1** -- Enabled config activates integration
- Test type: Integration
- Test file: `src/extensions/spacemolt/wiring.test.ts`
- Description: With enabled config and mocks, assert all factory functions called.

**spacemolt-integration.AC7.2** -- DataSource registered with highPriorityFilter
- Test type: Integration
- Test file: `src/extensions/spacemolt/wiring.test.ts`
- Description: Registration has `source.name === "spacemolt"` and `highPriorityFilter` returns true for combat events.

**spacemolt-integration.AC7.3** -- Per-source instructions injected
- Test type: Integration
- Test file: `src/extensions/spacemolt/wiring.test.ts`
- Description: Registration has non-empty `instructions` string mentioning SpaceMolt.

**spacemolt-integration.AC7.4** -- Tool cycling in agent turn
- Test type: Integration
- Test file: `src/extensions/spacemolt/wiring.test.ts`
- Description: Agent has `beforeTurn` callback. State change → next `toModelTools()` reflects new subset.

**spacemolt-integration.AC7.5** -- Disabled config creates nothing
- Test type: Unit
- Test file: `src/extensions/spacemolt/wiring.test.ts`
- Description: Without spacemolt config, no factory functions called, no registrations.

---

## Human Verification

### spacemolt-integration.AC4.1 (partial) -- WebSocket authentication against live server
- **Why:** Mocks verify message format but not live server compatibility.
- **How:** Start constellation with valid SpaceMolt credentials. Check logs for `"SpaceMolt connected: N tools discovered"`.

### spacemolt-integration.AC2.1 (partial) -- MCP tool discovery against live server
- **Why:** Mocks verify translation logic but not actual schema compatibility.
- **How:** Start constellation with credentials. Check tool count in logs. Run `spacemolt:get_status` via REPL.

### spacemolt-integration.AC5.1 / AC5.2 (partial) -- Activity cycle integration
- **Why:** Lifecycle tested with mocks. Real wiring depends on ActivityManager interface.
- **How:** Start with activity schedule including sleep window. Observe connect on wake, disconnect on sleep.

### spacemolt-integration.AC5.3 (partial) -- Session expiry under real conditions
- **Why:** Real expiry depends on 30-minute timeout and actual error format.
- **How:** Idle 30+ minutes, trigger tool call. Check logs for reconnection.

### spacemolt-integration.AC7.4 (partial) -- Tool cycling during live gameplay
- **Why:** Real gameplay transitions may have different payload shapes.
- **How:** Play via REPL. Dock → docked tools appear. Undock → undocked tools. Combat → combat tools.

---

## Test File Summary

| Test File | Type | ACs Covered |
|-----------|------|-------------|
| `src/config/schema.test.ts` | Unit | AC1.1, AC1.4 |
| `src/config/env-override.test.ts` | Unit | AC1.2, AC1.3 |
| `src/extensions/spacemolt/state.test.ts` | Unit | AC3.1, AC3.2, AC3.3 |
| `src/extensions/spacemolt/tool-filter.test.ts` | Unit | AC3.4, AC3.5 |
| `src/extensions/spacemolt/schema.test.ts` | Unit | AC2.2, AC2.3, AC2.5 |
| `src/extensions/spacemolt/tool-provider.test.ts` | Unit | AC2.1, AC2.4, AC2.6, AC5.3 |
| `src/extensions/spacemolt/events.test.ts` | Unit | AC4.2, AC4.3, AC4.5 |
| `src/extensions/spacemolt/source.test.ts` | Unit | AC4.1, AC4.4, AC4.6, AC5.4 |
| `src/extensions/spacemolt/lifecycle.test.ts` | Unit | AC5.1, AC5.2 |
| `src/extensions/spacemolt/seed.test.ts` | Unit | AC6.1, AC6.2, AC6.3 |
| `src/extensions/spacemolt/tool-cycling.test.ts` | Unit | AC3.6, AC3.7 |
| `src/extensions/spacemolt/wiring.test.ts` | Integration | AC7.1, AC7.2, AC7.3, AC7.4, AC7.5 |
