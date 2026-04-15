# SpaceMolt Auto-Registration Implementation Plan - Phase 5

**Goal:** Wire the new auth flow into the composition root and update the lifecycle to enforce correct startup ordering (tool provider auth before source connect).

**Architecture:** Update `src/index.ts` to pass `registrationCode`, `store`, and `embedding` to the tool provider, and `getCredentials` (backed by `readCredentials`) to the source. Reverse lifecycle ordering so `discover()` (which registers/logs in and writes credentials to memory) runs before `source.connect()` (which reads credentials from memory). Update barrel exports.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-auto-register.AC5: Composition root wiring
- **spacemolt-auto-register.AC5.1 Success:** Agent starts with only `registration_code` in config, registers on first run, persists credentials
- **spacemolt-auto-register.AC5.2 Success:** Agent starts with existing credentials in memory, logs in without registration code being consumed
- **spacemolt-auto-register.AC5.3 Success:** WebSocket source connects after tool provider auth completes (sequential startup preserved)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Reverse lifecycle startup ordering (discover before connect)

**Verifies:** spacemolt-auto-register.AC5.3

**Files:**
- Modify: `src/extensions/spacemolt/lifecycle.ts:22-33`

**Implementation:**

The current lifecycle `start()` calls `source.connect()` then `toolProvider.discover()`. After the auth refactor, the tool provider must authenticate first (writing credentials to memory), then the source connects (reading credentials from memory).

Replace the `start()` function body at lines 22-33:

```typescript
async function start(): Promise<void> {
  if (running) {
    return;
  }

  // Discover tools first (registers/logs in, writes credentials to memory)
  await toolProvider.discover();

  // Then connect source (reads credentials from memory via getCredentials)
  await source.connect();

  running = true;
}
```

Key change: `toolProvider.discover()` before `source.connect()`. This ensures credentials exist in memory before the source tries to read them.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `refactor(spacemolt): reverse lifecycle ordering — discover before connect`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update lifecycle tests for new ordering

**Verifies:** spacemolt-auto-register.AC5.3

**Files:**
- Modify: `src/extensions/spacemolt/lifecycle.test.ts`

**Testing:**

Update the AC5.1 test to verify that `discover()` is called BEFORE `connect()`. The test should track call order:

```typescript
const callOrder: Array<string> = [];

const source: SpaceMoltDataSource = {
  ...createMockSource(),
  async connect() { callOrder.push('connect'); },
};

const toolProvider: SpaceMoltToolProvider = {
  ...createMockToolProvider(),
  async discover() { callOrder.push('discover'); return []; },
};

// After start()
expect(callOrder).toEqual(['discover', 'connect']);
```

The existing AC5.2 test for `stop()` order (disconnect then close) should remain unchanged.

**Verification:**

Run: `bun test src/extensions/spacemolt/lifecycle.test.ts`
Expected: All lifecycle tests pass

**Commit:** `test(spacemolt): update lifecycle test for discover-before-connect ordering`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Update composition root SpaceMolt wiring

**Verifies:** spacemolt-auto-register.AC5.1, spacemolt-auto-register.AC5.2

**Files:**
- Modify: `src/index.ts:770-806`

**Implementation:**

Replace the SpaceMolt initialization block. The key changes:
1. Remove `spacemoltPassword`/`spacemoltUsername` extraction from config
2. Remove the `!spacemoltPassword || !spacemoltUsername` guard
3. Pass `registrationCode`, `store`, `embedding` to tool provider
4. Pass `getCredentials` (backed by `readCredentials`) to source
5. Import `readCredentials` from the spacemolt barrel

Add import at top of file (near other spacemolt imports):
```typescript
import { readCredentials } from '@/extensions/spacemolt';
```

Replace lines 770-816:

```typescript
if (config.spacemolt?.enabled) {
  const registrationCode = config.spacemolt.registration_code;

  if (!registrationCode) {
    console.error("SpaceMolt enabled but registration_code missing");
  } else {
    try {
      // Seed capabilities
      gameStateManager = createGameStateManager();
      await seedSpaceMoltCapabilities(memoryStore, embedding);

      // Create tool provider with registration support
      spacemoltToolProvider = createSpaceMoltToolProvider({
        mcpUrl: config.spacemolt.mcp_url,
        registrationCode,
        usernameHint: config.spacemolt.username,
        empireHint: config.spacemolt.empire,
        store: memoryStore,
        embedding,
      });

      // Create source with deferred credential reading
      spacemoltSource = createSpaceMoltSource({
        wsUrl: config.spacemolt.ws_url,
        getCredentials: () => readCredentials(memoryStore),
        gameStateManager,
        eventQueueCapacity: config.spacemolt.event_queue_capacity,
      });

      // Create lifecycle coordinator
      spacemoltLifecycle = createSpaceMoltLifecycle({
        source: spacemoltSource,
        toolProvider: spacemoltToolProvider,
      });

      // Start lifecycle: discover (register/login) then connect (read creds from memory)
      try {
        await spacemoltLifecycle.start();
        // start() calls discover() internally but doesn't return tools; second call hits cache
        spacemoltToolCache = await spacemoltToolProvider.discover();
        console.log(`SpaceMolt connected: ${spacemoltToolCache.length} tools discovered`);
      } catch (error) {
        console.error("SpaceMolt connection failed:", error);
        spacemoltLifecycle = null;
      }
    } catch (error) {
      console.error("SpaceMolt initialization failed:", error);
      spacemoltLifecycle = null;
    }
  }
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes. No remaining compile errors from old `username`/`password` references.

**Commit:** `feat(spacemolt): wire registration auth flow into composition root`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update barrel exports and wiring tests

**Verifies:** spacemolt-auto-register.AC5.1, spacemolt-auto-register.AC5.2, spacemolt-auto-register.AC5.3

**Files:**
- Modify: `src/extensions/spacemolt/wiring.test.ts`

**Implementation:**

**Note:** Barrel exports for `readCredentials`/`writeCredentials`/`Credentials` were already added in Phase 2 Task 2. No barrel changes needed here.

**Testing:**

Update `wiring.test.ts` to reflect the new composition flow. The key changes:

1. The integration test ("full wiring scenario") should verify that `toolProvider.discover()` is called before `source.connect()` (matching the lifecycle order change).

2. The AC7.1 tests should use the new options shapes (no username/password).

3. The mock tool provider should simulate the register-or-login flow by accepting the new options shape. Since wiring tests use mocks that don't call real MCP, the mocks just need to match the updated interfaces.

4. Add a new test verifying that the composition root passes `getCredentials` to the source instead of static credentials. This is a structural test — verify the options pattern is correct.

The wiring tests are primarily structural (verifying components compose correctly), not behavioral (not testing registration logic). Registration behavior is tested in Phase 3's tool-provider.test.ts.

**Verification:**

Run: `bun test src/extensions/spacemolt/wiring.test.ts`
Expected: All wiring tests pass

Run: `bun run build`
Expected: Clean build with no errors

Run: `bun test src/extensions/spacemolt/`
Expected: All SpaceMolt tests pass

**Commit:** `feat(spacemolt): update barrel exports and wiring tests for auto-registration`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update CLAUDE.md files

**Verifies:** None (documentation)

**Files:**
- Modify: `src/config/CLAUDE.md`
- Modify: `src/extensions/spacemolt/CLAUDE.md`
- Modify: `CLAUDE.md` (root)

**Implementation:**

Update `src/config/CLAUDE.md`:
- Replace references to `username`, `password` with `registration_code`
- Update `SpaceMoltConfig` description to mention `registration_code` instead of `username`/`password`
- Update env override list: remove `SPACEMOLT_USERNAME`, `SPACEMOLT_PASSWORD`, add `SPACEMOLT_REGISTRATION_CODE`
- Update Invariants section similarly

Update `src/extensions/spacemolt/CLAUDE.md`:
- Add `credentials.ts` to Key Files
- Update Expects section: replace "Config section `[spacemolt]` with `username`, `password`" with "`registration_code`"
- Add note about `readCredentials`/`writeCredentials` and `Credentials` type to Contracts

Update root `CLAUDE.md`:
- In Environment overrides section: replace `SPACEMOLT_USERNAME`, `SPACEMOLT_PASSWORD` with `SPACEMOLT_REGISTRATION_CODE`

**Verification:**

Review the updated docs for accuracy.

**Commit:** `docs: update CLAUDE.md files for spacemolt auto-registration`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Final build and full test suite verification

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Clean type-check with zero errors

Run: `bun test`
Expected: All tests pass across the entire project

If any tests fail due to the config schema change affecting other test files that reference SpaceMolt config with `username`/`password`, identify and fix them.

**Commit:** No commit unless fixes are needed.
<!-- END_TASK_6 -->
