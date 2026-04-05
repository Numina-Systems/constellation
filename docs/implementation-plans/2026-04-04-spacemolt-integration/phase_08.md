# SpaceMolt Integration — Phase 8: Composition Root Wiring

**Goal:** Wire SpaceMolt extension into the composition root alongside Bluesky.

**Architecture:** When `config.spacemolt.enabled`, create SpaceMolt source + tool provider, register with DataSource registry (with highPriorityFilter and per-source instructions), seed capabilities, wire session lifecycle to activity manager wake/sleep, integrate tool cycling into agent turn.

**Tech Stack:** TypeScript, composition root (`src/index.ts`)

**Scope:** 8 phases from original design (phase 8 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC7: Composition root wiring
- **spacemolt-integration.AC7.1 Success:** `config.spacemolt.enabled = true` activates SpaceMolt integration
- **spacemolt-integration.AC7.2 Success:** SpaceMolt DataSource registered with DataSource registry including `highPriorityFilter`
- **spacemolt-integration.AC7.3 Success:** Per-source instructions injected for SpaceMolt event formatting
- **spacemolt-integration.AC7.4 Success:** Tool cycling integrated into agent turn
- **spacemolt-integration.AC7.5 Edge:** `config.spacemolt.enabled = false` (or absent) does not create any SpaceMolt components

---

**PREREQUISITE:** The `efficient-agent-loop` branch must be merged into the working branch before this phase. Verify that `DataSourceRegistration` type exists in `src/extensions/data-source.ts` with `highPriorityFilter` and `instructions` properties, and that `createDataSourceRegistry()` exists in `src/extensions/data-source-registry.ts`. If not merged, fall back to manual wiring following the Bluesky pattern in `src/index.ts` (direct `onMessage()` handler with activity interceptor wrapping, as described in the design's "Additional Considerations" section).

<!-- START_TASK_1 -->
### Task 1: Wire SpaceMolt into composition root

**Verifies:** spacemolt-integration.AC7.1, spacemolt-integration.AC7.2, spacemolt-integration.AC7.3, spacemolt-integration.AC7.5

**Files:**
- Modify: `src/index.ts`
- Modify: `src/extensions/index.ts` (add SpaceMolt re-exports)

**Implementation:**

Add imports at the top of `src/index.ts`:

```typescript
import {
  createSpaceMoltSource,
  createSpaceMoltToolProvider,
  createGameStateManager,
  createSpaceMoltLifecycle,
  seedSpaceMoltCapabilities,
  isHighPriority,
} from '@/extensions/spacemolt';
```

In `src/extensions/index.ts`, add SpaceMolt re-exports:
```typescript
export {
  createSpaceMoltSource,
  createSpaceMoltToolProvider,
  createGameStateManager,
  createSpaceMoltLifecycle,
  seedSpaceMoltCapabilities,
  isHighPriority,
  cycleSpaceMoltTools,
  filterToolsByState,
} from './spacemolt/index.ts';
```

In the composition root (after Bluesky wiring), add SpaceMolt initialization:

```typescript
let spacemoltLifecycle: SpaceMoltLifecycle | null = null;
let spacemoltToolCache: Array<ToolDefinition> = [];

if (config.spacemolt?.enabled) {
  const spacemoltPassword = config.spacemolt.password;
  const spacemoltUsername = config.spacemolt.username;

  if (!spacemoltPassword || !spacemoltUsername) {
    console.error("SpaceMolt enabled but username or password missing");
  } else {
    // Seed capabilities
    await seedSpaceMoltCapabilities(memoryStore, embedding);

    // Create game state manager
    const gameStateManager = createGameStateManager();

    // Create source and tool provider
    const spacemoltSource = createSpaceMoltSource({
      wsUrl: config.spacemolt.ws_url,
      username: spacemoltUsername,
      password: spacemoltPassword,
      gameStateManager,
      eventQueueCapacity: config.spacemolt.event_queue_capacity,
    });

    const spacemoltToolProvider = createSpaceMoltToolProvider({
      mcpUrl: config.spacemolt.mcp_url,
      username: spacemoltUsername,
      password: spacemoltPassword,
    });

    // Create lifecycle coordinator
    spacemoltLifecycle = createSpaceMoltLifecycle({
      source: spacemoltSource,
      toolProvider: spacemoltToolProvider,
      isActive: () => activityManager?.isActive() ?? Promise.resolve(true),
    });

    // Register as DataSource with highPriorityFilter
    // (for DataSourceRegistry from efficient-agent-loop)
    dataSourceRegistrations.push({
      source: spacemoltSource,
      instructions: "You are playing SpaceMolt, a multiplayer space game. Evaluate events and decide whether to act. In combat, prioritise survival. Track interesting information (trade routes, resource locations, combat outcomes) in memory using memory_write. Use predict to record gameplay predictions.",
      highPriorityFilter: (message: IncomingMessage) => {
        const eventType = message.metadata?.["type"] as string | undefined;
        return eventType ? isHighPriority(eventType) : false;
      },
    });

    // Start if activity is active (or no activity manager)
    try {
      await spacemoltLifecycle.start();
      spacemoltToolCache = await spacemoltToolProvider.discover();
      console.log(`SpaceMolt connected: ${spacemoltToolCache.length} tools discovered`);
    } catch (error) {
      console.error("SpaceMolt connection failed:", error);
      spacemoltLifecycle = null;
    }
  }
}
```

For AC7.5: The `if (config.spacemolt?.enabled)` guard ensures nothing is created when disabled or absent.

**Testing:**

This is composition root wiring — verify operationally. Existing wiring tests (if any in `src/index.wiring.test.ts`) should continue to pass. Add a test:
- AC7.1: With spacemolt enabled config, SpaceMolt components are created (mock everything)
- AC7.5: Without spacemolt config, no SpaceMolt components created

**Verification:**
Run: `bun run build`
Expected: No errors

Run: `bun test`
Expected: All existing tests pass

**Commit:** `feat: wire spacemolt extension into composition root`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integrate tool cycling into agent turn

**Verifies:** spacemolt-integration.AC7.4

**Files:**
- Modify: `src/agent/agent.ts` (add pre-turn hook for tool cycling)
- Modify: `src/index.ts` (pass cycling callback to agent)

**Implementation:**

The agent needs to cycle SpaceMolt tools before each turn. Add an optional `beforeTurn` callback to the agent dependencies:

In `src/agent/agent.ts`, add to the deps type:
```typescript
beforeTurn?: () => void;
```

Call it before building the model request (around line 140, before `toModelTools()`):
```typescript
if (deps.beforeTurn) {
  deps.beforeTurn();
}
```

In `src/index.ts`, when creating the agent, pass the cycling callback:
```typescript
beforeTurn: spacemoltLifecycle?.isRunning() ? () => {
  const gameState = gameStateManager.getGameState();
  cycleSpaceMoltTools({
    registry,
    allTools: spacemoltToolCache,
    gameState,
    toolProvider: spacemoltToolProvider,
  });
} : undefined,
```

**Testing:**

- AC7.4: With SpaceMolt active, `beforeTurn` is called before `toModelTools()`. Verify by checking that after a state change, the next `toModelTools()` reflects the new tool set.

**Verification:**
Run: `bun test`
Expected: All tests pass

**Commit:** `feat: integrate spacemolt tool cycling into agent turn`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire activity wake/sleep to SpaceMolt lifecycle

**Verifies:** spacemolt-integration.AC5.1, spacemolt-integration.AC5.2, spacemolt-integration.AC5.4

**Files:**
- Modify: `src/index.ts` (add wake/sleep handlers)

**Implementation:**

In the activity manager setup section of `src/index.ts`, add SpaceMolt lifecycle hooks:

```typescript
// On wake: start SpaceMolt
if (spacemoltLifecycle) {
  activityManager.onWake(async () => {
    if (!spacemoltLifecycle.isRunning()) {
      try {
        await spacemoltLifecycle.start();
        spacemoltToolCache = await spacemoltToolProvider.discover();
        console.log("SpaceMolt reconnected on wake");
      } catch (error) {
        console.error("SpaceMolt wake connection failed:", error);
      }
    }
  });

  // On sleep: stop SpaceMolt
  activityManager.onSleep(async () => {
    if (spacemoltLifecycle.isRunning()) {
      await spacemoltLifecycle.stop();
      // Unregister all spacemolt tools
      for (const def of registry.getDefinitions()) {
        if (def.name.startsWith("spacemolt:")) {
          registry.unregister(def.name);
        }
      }
      console.log("SpaceMolt disconnected for sleep");
    }
  });
}
```

Note: If the activity manager doesn't have `onWake`/`onSleep` methods, this wiring will need to integrate with whatever event pattern the activity system uses. Check the actual `ActivityManager` interface. The implementation may need to use scheduler tasks or direct lifecycle calls from the sleep/wake transition code.

**Testing:**

This is composition root wiring — verify operationally.
- AC5.1: On wake, SpaceMolt starts (connect + discover)
- AC5.2: On sleep, SpaceMolt stops (disconnect, tools removed)
- AC5.4: During sleep, no reconnection (lifecycle is stopped, `isRunning()` is false)

**Verification:**
Run: `bun run build`
Expected: No errors

Run: `bun test`
Expected: All tests pass

**Commit:** `feat: wire spacemolt lifecycle to activity wake/sleep`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final verification

**Files:** None (verification only)

**Step 1: Type check**

Run: `bun run build`
Expected: No errors

**Step 2: All tests**

Run: `bun test`
Expected: All tests pass

**Step 3: Verify structure**

Run: `ls src/extensions/spacemolt/`
Expected: types.ts, state.ts, state.test.ts, tool-filter.ts, tool-filter.test.ts, schema.ts, schema.test.ts, tool-provider.ts, tool-provider.test.ts, events.ts, events.test.ts, source.ts, source.test.ts, session.ts, session.test.ts, lifecycle.ts, lifecycle.test.ts, tool-cycling.ts, tool-cycling.test.ts, seed.ts, seed.test.ts, index.ts

**Commit:** No commit needed — verification only
<!-- END_TASK_4 -->
