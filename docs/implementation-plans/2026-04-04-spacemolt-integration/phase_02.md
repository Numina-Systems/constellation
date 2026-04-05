# SpaceMolt Integration — Phase 2: Game State Manager & Tool Filter

**Goal:** Pure functions for tracking game state and filtering tools by state.

**Architecture:** Functional Core module. Game state enum with transition logic driven by WebSocket events and tool results. Tool filter maps game states to tool name subsets.

**Tech Stack:** TypeScript (pure functions, no dependencies)

**Scope:** 8 phases from original design (phase 2 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC3: Game state tracking and tool filtering
- **spacemolt-integration.AC3.1 Success:** Initial state derived from `logged_in` response (docked_at_base → DOCKED, else UNDOCKED)
- **spacemolt-integration.AC3.2 Success:** `combat_update` event transitions state to COMBAT
- **spacemolt-integration.AC3.3 Success:** Tool result with destination/arrival_tick transitions state to TRAVELING
- **spacemolt-integration.AC3.4 Success:** `filterToolsByState("DOCKED", tools)` returns docked tools (buy, sell, repair, undock, etc.)
- **spacemolt-integration.AC3.5 Success:** "Always" group (get_status, get_ship, chat, help, catalog, analyze_market, find_route) included in all states

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: SpaceMolt extension types

**Files:**
- Create: `src/extensions/spacemolt/types.ts`

**Implementation:**

Create the types file with pattern annotation `// pattern: Functional Core`. Define:

```typescript
type GameState = "DOCKED" | "UNDOCKED" | "COMBAT" | "TRAVELING";

type GameStateManager = {
  getGameState(): GameState;
  updateFromEvent(event: SpaceMoltEvent): void;
  updateFromToolResult(toolName: string, result: Record<string, unknown>): void;
  reset(initialState: GameState): void;
};

type SpaceMoltEvent = {
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

// Extended interfaces matching design contracts
interface SpaceMoltDataSource extends DataSource {
  readonly name: "spacemolt";
  getGameState(): GameState;
}

interface SpaceMoltToolProvider extends ToolProvider {
  readonly name: "spacemolt";
  refreshTools(): Promise<void>;
  close(): Promise<void>;
}
```

Import `DataSource` from `../data-source.ts` and `ToolProvider` from `../tool-provider.ts`. Also re-export `ToolDefinition` from `../../tool/types.ts` for convenience.

**Commit:** `feat: add spacemolt extension types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Game state manager

**Verifies:** spacemolt-integration.AC3.1, spacemolt-integration.AC3.2, spacemolt-integration.AC3.3

**Files:**
- Create: `src/extensions/spacemolt/state.ts`
- Test: `src/extensions/spacemolt/state.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/state.ts` with `// pattern: Functional Core`. Export pure reducer functions and a factory that wraps them with mutable state.

**Pure reducers (Functional Core):**

Export `nextStateFromEvent(current: GameState, event: SpaceMoltEvent): GameState`:
- `combat_update` → COMBAT
- `player_died` → DOCKED (respawn at base)
- `mining_yield` → UNDOCKED (confirms we're in space mining)
- Unknown events: return `current` unchanged

Export `nextStateFromToolResult(current: GameState, toolName: string, result: Record<string, unknown>): GameState`:
- `dock` → DOCKED
- `undock` → UNDOCKED
- `travel` or `jump` (when result has `destination` or `arrival_tick`) → TRAVELING
- `attack` → COMBAT
- Unknown: return `current` unchanged

**Factory wrapper (Imperative Shell — holds mutable ref):**

Export `createGameStateManager(initialState?: GameState)`:
- Internal: `let currentState: GameState = initialState ?? "UNDOCKED"`
- `getGameState()`: returns `currentState`
- `updateFromEvent(event)`: `currentState = nextStateFromEvent(currentState, event)`
- `updateFromToolResult(toolName, result)`: `currentState = nextStateFromToolResult(currentState, toolName, result)`
- `reset(state)`: `currentState = state`

For AC3.1, the caller (composition root) will call `reset()` based on the `logged_in` payload's `docked_at_base` field.

Note: The pure reducers are testable without any state. The factory is a thin Imperative Shell wrapper. Annotate the file `// pattern: Functional Core` since the pure reducers are the primary exports; the factory is convenience wiring.

**Testing:**

Tests must verify each AC:
- AC3.1: `reset("DOCKED")` sets state to DOCKED; `reset("UNDOCKED")` sets state to UNDOCKED
- AC3.2: `updateFromEvent({ type: "combat_update", payload: {} })` transitions to COMBAT from any state
- AC3.3: `updateFromToolResult("travel", { destination: "Alpha Centauri", arrival_tick: 100 })` transitions to TRAVELING

Additional:
- `player_died` → DOCKED
- `dock` result → DOCKED
- `undock` result → UNDOCKED
- Unknown event type → no state change
- Unknown tool name → no state change

**Verification:**
Run: `bun test src/extensions/spacemolt/state.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt game state manager with event/result transitions`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Tool filter with state-based groups

**Verifies:** spacemolt-integration.AC3.4, spacemolt-integration.AC3.5

**Files:**
- Create: `src/extensions/spacemolt/tool-filter.ts`
- Test: `src/extensions/spacemolt/tool-filter.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/tool-filter.ts` with `// pattern: Functional Core`. Define tool group mappings as const arrays of tool names (without `spacemolt:` prefix — the filter operates on raw MCP tool names):

```typescript
const ALWAYS_TOOLS: ReadonlyArray<string> = [
  "get_status", "get_ship", "get_cargo", "get_skills", "get_version",
  "chat", "get_chat_history", "help", "catalog",
  "analyze_market", "find_route", "search_systems", "get_map",
  "get_notifications", "get_commands", "get_guide",
  "get_notes", "create_note", "read_note", "write_note",
  "captains_log_add", "captains_log_list", "captains_log_get",
  "get_action_log", "forum_list", "forum_get_thread",
];

const DOCKED_TOOLS: ReadonlyArray<string> = [
  "buy", "sell", "undock", "repair", "refuel", "craft",
  "get_base", "view_market", "view_orders", "view_storage",
  "deposit_items", "withdraw_items", "send_gift",
  "browse_ships", "switch_ship", "list_ships",
  "buy_listed_ship", "sell_ship", "commission_ship",
  "install_mod", "uninstall_mod", "repair_module",
  "get_missions", "accept_mission", "complete_mission",
  "get_insurance_quote", "buy_insurance", "set_home_base",
  "create_buy_order", "create_sell_order", "modify_order", "cancel_order",
  "estimate_purchase", "refit_ship", "use_item", "name_ship",
  "get_trades", "trade_accept", "trade_decline", "trade_cancel",
  "facility",
];

const UNDOCKED_TOOLS: ReadonlyArray<string> = [
  "travel", "jump", "dock", "mine", "survey_system",
  "attack", "scan", "cloak", "reload",
  "get_poi", "get_system", "get_nearby", "get_wrecks",
  "trade_offer", "jettison", "refuel", "repair",
  "tow_wreck", "release_tow", "loot_wreck", "salvage_wreck",
  "scrap_wreck", "sell_wreck", "self_destruct",
  "battle", "get_battle_status",
  "fleet",
];

const COMBAT_TOOLS: ReadonlyArray<string> = [
  "attack", "scan", "cloak", "reload",
  "get_battle_status", "battle", "self_destruct",
  "get_nearby", "get_poi", "get_system",
  "refuel", "repair", "use_item",
];

const TRAVELING_TOOLS: ReadonlyArray<string> = [
  "get_system", "get_poi",
];
```

Export `filterToolsByState(allTools: ReadonlyArray<ToolDefinition>, state: GameState): Array<ToolDefinition>`:
1. Look up the state-specific tool set
2. Combine with ALWAYS_TOOLS into a `Set<string>`
3. Filter `allTools` to include only tools whose name (after stripping `spacemolt:` prefix) is in the set

**Testing:**

Create a helper that generates mock `ToolDefinition` objects from tool names. Tests:
- AC3.4: `filterToolsByState(allTools, "DOCKED")` includes `buy`, `sell`, `repair`, `undock` but NOT `mine`, `attack`
- AC3.5: `filterToolsByState(allTools, "DOCKED")` includes always-tools like `get_status`, `chat`, `catalog`. Same for UNDOCKED, COMBAT, TRAVELING.
- COMBAT state includes combat tools but NOT `buy`, `sell`
- TRAVELING state includes traveling tools + always tools only

**Verification:**
Run: `bun test src/extensions/spacemolt/tool-filter.test.ts`
Expected: All tests pass

**Commit:** `feat: add state-based tool filter for spacemolt`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Barrel exports for spacemolt extension

**Files:**
- Create: `src/extensions/spacemolt/index.ts`

**Implementation:**

Create barrel export file:
```typescript
export type { GameState, GameStateManager, SpaceMoltEvent } from "./types.ts";
export { createGameStateManager } from "./state.ts";
export { filterToolsByState } from "./tool-filter.ts";
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: add spacemolt extension barrel exports`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
