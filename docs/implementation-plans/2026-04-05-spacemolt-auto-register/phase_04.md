# SpaceMolt Auto-Registration Implementation Plan - Phase 4

**Goal:** Replace direct credential injection in the WebSocket source with deferred credential reading via a `getCredentials` function.

**Architecture:** Change `SpaceMoltSourceOptions` from static `username`/`password` fields to a `getCredentials` function that reads credentials from memory at connection time. This defers credential resolution until after the tool provider has completed auth in `discover()`.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-auto-register.AC4: WebSocket source uses deferred credentials
- **spacemolt-auto-register.AC4.1 Success:** Source authenticates using credentials from `getCredentials()` function
- **spacemolt-auto-register.AC4.2 Failure:** Null credentials from `getCredentials()` throws clear error before sending login message
- **spacemolt-auto-register.AC4.3 Success:** Reconnection re-reads credentials via `getCredentials()`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Update SpaceMoltSourceOptions and auth flow in source.ts

**Verifies:** spacemolt-auto-register.AC4.1, spacemolt-auto-register.AC4.2, spacemolt-auto-register.AC4.3

**Files:**
- Modify: `src/extensions/spacemolt/source.ts:7-18` (options type and destructuring)
- Modify: `src/extensions/spacemolt/source.ts:55-68` (welcome handler auth flow)

**Implementation:**

Replace the `SpaceMoltSourceOptions` type at lines 7-13:

```typescript
export type SpaceMoltSourceOptions = {
  readonly wsUrl: string;
  readonly getCredentials: () => Promise<{ username: string; password: string } | null>;
  readonly gameStateManager: GameStateManager;
  readonly eventQueueCapacity: number;
};
```

Update the destructuring at line 18:

```typescript
const {wsUrl, getCredentials, gameStateManager, eventQueueCapacity: _} = options;
```

Replace the welcome message handler (lines 55-68). The key change is that `getCredentials()` is now async, so the handler needs to call it and handle the null case:

```typescript
// Handle welcome message
if (data.type === 'welcome') {
  if (resolveWelcome) resolveWelcome();
  // Read credentials from memory (deferred resolution)
  getCredentials().then(credentials => {
    if (!credentials) {
      reject(new Error('SpaceMolt credentials not available: getCredentials() returned null'));
      return;
    }
    const loginMsg = {
      type: 'login',
      payload: {
        username: credentials.username,
        password: credentials.password,
      },
    };
    if (ws) {
      ws.send(JSON.stringify(loginMsg));
    }
  }).catch(err => {
    reject(err);
  });
  return;
}
```

Note: The `reject` function is from the outer `connect()` Promise constructor. The welcome handler already has access to it in the current code since it's inside the `new Promise()` callback.

For reconnection (AC4.3): The `connect()` function is called again on unexpected close (via the `onclose` handler at lines 111-122). Since `connect()` creates a fresh WebSocket and goes through the full welcome→getCredentials→login flow, reconnection automatically re-reads credentials from memory. No additional changes needed for AC4.3 — it's handled by the existing reconnection logic calling `connect()` which calls `getCredentials()`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes for source.ts. Test file will have errors (expected — updated in Task 2).

**Commit:** `feat(spacemolt): replace static credentials with getCredentials in WebSocket source`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update source tests for getCredentials pattern

**Verifies:** spacemolt-auto-register.AC4.1, spacemolt-auto-register.AC4.2, spacemolt-auto-register.AC4.3

**Files:**
- Modify: `src/extensions/spacemolt/source.test.ts`

**Testing:**

All existing tests need their `createSpaceMoltSource` options updated from `username`/`password` to `getCredentials`. The mock `getCredentials` function is simple:

```typescript
const mockGetCredentials = async () => ({
  username: 'testuser',
  password: 'testpass',
});
```

Replace every occurrence of the options object pattern:
```typescript
// Before
const source = createSpaceMoltSource({
  wsUrl: 'ws://localhost:8080/game',
  username: 'testuser',
  password: 'testpass',
  gameStateManager,
  eventQueueCapacity: 100,
});

// After
const source = createSpaceMoltSource({
  wsUrl: 'ws://localhost:8080/game',
  getCredentials: mockGetCredentials,
  gameStateManager,
  eventQueueCapacity: 100,
});
```

Add new tests:

- **spacemolt-auto-register.AC4.1:** Already covered by the existing "connects and authenticates via login message" test once updated to use `getCredentials`. Verify the login message sent contains the credentials returned by `getCredentials`.

- **spacemolt-auto-register.AC4.2:** New test: `getCredentials` returns null. After receiving welcome message, `connect()` should reject with error message containing "credentials not available".

```typescript
test('spacemolt-auto-register.AC4.2: throws when getCredentials returns null', async () => {
  // ... mock WebSocket setup ...

  const source = createSpaceMoltSource({
    wsUrl: 'ws://localhost:8080/game',
    getCredentials: async () => null,
    gameStateManager,
    eventQueueCapacity: 100,
  });

  const connectPromise = source.connect();
  createdSocket!.triggerOpen();
  createdSocket!.simulateMessage({ type: 'welcome', payload: {} });

  await expect(connectPromise).rejects.toThrow('credentials not available');
});
```

- **spacemolt-auto-register.AC4.3:** Already covered by the existing "handler persists through reconnection after unexpected close" test. After reconnection, `getCredentials()` is called again during the new welcome→login flow. Enhance the existing reconnection test to track how many times `getCredentials` was called:

```typescript
let getCredentialsCalls = 0;
const trackingGetCredentials = async () => {
  getCredentialsCalls++;
  return { username: 'testuser', password: 'testpass' };
};
```

After reconnection completes, verify `getCredentialsCalls >= 2` (initial connect + reconnect).

**Verification:**

Run: `bun test src/extensions/spacemolt/source.test.ts`
Expected: All source tests pass

**Commit:** `test(spacemolt): update source tests for deferred credential resolution`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
