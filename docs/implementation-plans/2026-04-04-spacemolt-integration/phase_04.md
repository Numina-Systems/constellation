# SpaceMolt Integration — Phase 4: WebSocket DataSource

**Goal:** Real-time event streaming from SpaceMolt with event classification.

**Architecture:** Implements `DataSource` interface following Bluesky pattern. WebSocket connection to SpaceMolt, login auth, event classification into tiers (high/normal/internal), conversion to `IncomingMessage`. Reuses bounded event queue.

**Tech Stack:** TypeScript, native WebSocket (Bun built-in)

**Scope:** 8 phases from original design (phase 4 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC4: WebSocket DataSource streams real-time events
- **spacemolt-integration.AC4.1 Success:** WebSocket connects and authenticates via login message
- **spacemolt-integration.AC4.2 Success:** `combat_update` events classified as high priority and converted to `IncomingMessage`
- **spacemolt-integration.AC4.3 Success:** `chat_message` events classified as normal priority
- **spacemolt-integration.AC4.4 Success:** `tick` events update state manager but are not forwarded as `IncomingMessage`
- **spacemolt-integration.AC4.5 Success:** `IncomingMessage.content` contains human-readable event summary
- **spacemolt-integration.AC4.6 Edge:** Event queue drops oldest when at capacity

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Event classification and message formatting

**Verifies:** spacemolt-integration.AC4.2, spacemolt-integration.AC4.3, spacemolt-integration.AC4.4, spacemolt-integration.AC4.5

**Files:**
- Create: `src/extensions/spacemolt/events.ts`
- Test: `src/extensions/spacemolt/events.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/events.ts` with `// pattern: Functional Core`. Define event tier classification and message formatting as pure functions.

```typescript
type EventTier = "high" | "normal" | "internal";
```

Export `classifyEvent(eventType: string): EventTier`:
- HIGH: `combat_update`, `player_died`, `trade_offer_received`, `scan_detected`, `pilotless_ship`
- INTERNAL: `tick`, `welcome`, `logged_in`
- NORMAL: everything else

Export `formatEventContent(event: SpaceMoltEvent): string` — human-readable summary:
- `combat_update`: `"Combat: ${attacker} attacked ${target} for ${damage} damage (${damage_type})"`
- `player_died`: `"Death: Killed by ${killer_name}. Respawning at ${respawn_base}."`
- `chat_message`: `"Chat [${channel}] ${sender}: ${content}"`
- `trade_offer_received`: `"Trade offer from ${offerer_name}: offering ${offer_credits} credits"`
- `mining_yield`: `"Mined ${quantity} ${resource_name} (${remaining} remaining)"`
- `scan_detected`: `"Scan detected: ${scanner_username} scanned you"`
- `skill_level_up`: `"Skill up: ${skill_id} reached level ${new_level}"`
- Default: `"SpaceMolt event: ${type}"`

Export `isHighPriority(eventType: string): boolean` — returns true for high-tier events. Used as the `highPriorityFilter` predicate for DataSource registration.

**Testing:**

- AC4.2: `classifyEvent("combat_update")` returns `"high"`
- AC4.3: `classifyEvent("chat_message")` returns `"normal"`
- AC4.4: `classifyEvent("tick")` returns `"internal"`, `classifyEvent("welcome")` returns `"internal"`
- AC4.5: `formatEventContent({ type: "combat_update", payload: { attacker: "X", target: "Y", damage: 45, damage_type: "kinetic" } })` contains "Combat:" and damage info
- Test all event types produce non-empty strings
- `isHighPriority("combat_update")` returns true, `isHighPriority("chat_message")` returns false

**Verification:**
Run: `bun test src/extensions/spacemolt/events.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt event classification and formatting`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: WebSocket DataSource

**Verifies:** spacemolt-integration.AC4.1, spacemolt-integration.AC4.6

**Files:**
- Create: `src/extensions/spacemolt/source.ts`
- Test: `src/extensions/spacemolt/source.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/source.ts` with `// pattern: Imperative Shell`. Export `createSpaceMoltSource(options)` factory.

Options type:
```typescript
type SpaceMoltSourceOptions = {
  readonly wsUrl: string;
  readonly username: string;
  readonly password: string;
  readonly gameStateManager: GameStateManager;
  readonly eventQueueCapacity: number;
};
```

The factory follows the Bluesky DataSource pattern:
1. Internal state: `let ws: WebSocket | null`, `let messageHandler: ((msg: IncomingMessage) => void) | null`
2. `connect()`:
   - Open WebSocket to `wsUrl`
   - Wait for `welcome` message
   - Send `{ type: "login", payload: { username, password } }`
   - Wait for `logged_in` response
   - Initialize game state from `logged_in` payload (`docked_at_base` → DOCKED, else UNDOCKED)
   - Set up `ws.onmessage` handler that:
     a. Parses JSON
     b. Updates game state manager via `updateFromEvent()`
     c. Classifies event tier
     d. If not `internal`, creates `IncomingMessage` and calls `messageHandler()`
   - Returns when authenticated
3. `disconnect()`: Close WebSocket, null out references
4. `onMessage(handler)`: Store handler callback
5. `name`: `"spacemolt"` (readonly)

Returns object satisfying `DataSource` interface plus `getGameState()` delegating to the game state manager.

For AC4.6: The bounded event queue is handled by the DataSource registry (from `efficient-agent-loop`), not inside the source itself. The source calls `messageHandler()` for each event; the registry's event queue applies backpressure.

**Testing:**

Testing WebSocket connections requires a mock. Create a minimal mock WebSocket that:
- Accepts connection
- Sends `welcome` on connect
- Accepts `login` message, sends `logged_in` response
- Can be triggered to send events

Tests:
- AC4.1: `connect()` completes successfully, sends login message, receives logged_in
- AC4.6: Verified via the shared `createEventQueue` from Bluesky (already tested) — just verify integration by confirming `messageHandler` is called for each non-internal event
- Verify internal events (tick) do NOT call messageHandler
- Verify game state manager is updated for all events

**Verification:**
Run: `bun test src/extensions/spacemolt/source.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt WebSocket DataSource`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to barrel exports:
```typescript
export { classifyEvent, formatEventContent, isHighPriority } from "./events.ts";
export { createSpaceMoltSource } from "./source.ts";
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: export spacemolt source and events from barrel`
<!-- END_TASK_3 -->
