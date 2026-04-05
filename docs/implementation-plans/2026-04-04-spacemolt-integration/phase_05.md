# SpaceMolt Integration — Phase 5: Session Lifecycle

**Goal:** Tie SpaceMolt connections to constellation's activity cycle with transparent reconnection.

**Architecture:** Session expiry detection integrated directly into the MCP tool provider (retry on `session_invalid` via MCP re-connect + re-auth) and WebSocket source (reconnect on unexpected close during wake). Lifecycle coordinator manages start/stop of both connections tied to activity manager wake/sleep.

**Tech Stack:** TypeScript

**Scope:** 8 phases from original design (phase 5 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC5: Session lifecycle tied to activity cycle
- **spacemolt-integration.AC5.1 Success:** Wake event creates MCP + WebSocket sessions and authenticates both
- **spacemolt-integration.AC5.2 Success:** Sleep event disconnects WebSocket and closes MCP client
- **spacemolt-integration.AC5.3 Success:** `session_invalid` error during `execute()` triggers transparent reconnect and retry
- **spacemolt-integration.AC5.4 Edge:** No reconnection attempted during sleep hours

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add session expiry retry to MCP ToolProvider

**Verifies:** spacemolt-integration.AC5.3

**Files:**
- Modify: `src/extensions/spacemolt/tool-provider.ts`
- Test: `src/extensions/spacemolt/tool-provider.test.ts` (add tests)

**Implementation:**

Modify `execute()` in the tool provider to detect session expiry and retry transparently. Session expiry manifests as an error with code `session_invalid` from the MCP server (returned as an error in the callTool response or thrown as an exception).

The retry flow:
1. First `callTool()` fails with session-related error
2. Disconnect and reconnect the MCP client transport
3. Re-authenticate via `callTool("login", { username, password })` (same as initial discover flow)
4. Retry the original `callTool()`

Add a helper `isSessionExpired(error: unknown): boolean` that checks for `session_invalid` in the error message or code.

Add `reconnect()` method to the tool provider that:
- Closes the existing MCP client
- Creates a new `StreamableHTTPClientTransport`
- Reconnects the client
- Re-authenticates via login tool call

Note: This uses the MCP protocol's own transport and tool-call auth — NOT a separate REST API layer. SpaceMolt authenticates via a `login` tool exposed on the MCP server (SpaceMolt-specific, not standard MCP auth).

**Testing:**

Mock the MCP client. Tests:
- AC5.3: First `callTool("mine")` throws `session_invalid` → `reconnect()` called → retry `callTool("mine")` succeeds → returns result
- Non-session error → no reconnect, returns error ToolResult
- Retry after reconnect also fails → returns error ToolResult (no infinite retry)
- `isSessionExpired` correctly identifies `session_invalid` errors vs other errors

**Verification:**
Run: `bun test src/extensions/spacemolt/tool-provider.test.ts`
Expected: All tests pass

**Commit:** `feat: add transparent session reconnection to MCP tool provider`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add reconnection to WebSocket source

**Verifies:** spacemolt-integration.AC5.3 (WebSocket side), spacemolt-integration.AC5.4

**Files:**
- Modify: `src/extensions/spacemolt/source.ts`
- Test: `src/extensions/spacemolt/source.test.ts` (add tests)

**Implementation:**

Add an `onclose` handler to the WebSocket in `createSpaceMoltSource()`. When the WebSocket closes unexpectedly during wake hours:
1. Check if lifecycle is running (via callback or flag)
2. If running: wait briefly (1s), then call `connect()` again (re-opens WS, re-authenticates via login message)
3. If not running (sleep): do nothing

Add `shouldReconnect` flag or callback to source options. Set to `false` when `disconnect()` is called explicitly (sleep), so the `onclose` handler knows not to reconnect.

**Testing:**

- WebSocket closes unexpectedly while `shouldReconnect = true` → reconnects
- WebSocket closes while `shouldReconnect = false` (explicit disconnect) → no reconnect
- AC5.4: After `disconnect()` is called, `shouldReconnect` is false, no reconnection attempted

**Verification:**
Run: `bun test src/extensions/spacemolt/source.test.ts`
Expected: All tests pass

**Commit:** `feat: add WebSocket reconnection to spacemolt source`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Lifecycle coordinator

**Verifies:** spacemolt-integration.AC5.1, spacemolt-integration.AC5.2, spacemolt-integration.AC5.4

**Files:**
- Create: `src/extensions/spacemolt/lifecycle.ts`
- Test: `src/extensions/spacemolt/lifecycle.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/lifecycle.ts` with `// pattern: Imperative Shell`. Export `createSpaceMoltLifecycle(options)`.

```typescript
type SpaceMoltLifecycleOptions = {
  readonly source: SpaceMoltDataSource;
  readonly toolProvider: SpaceMoltToolProvider;
};

type SpaceMoltLifecycle = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
};
```

- `start()`: Connect source (`source.connect()`), discover tools (`toolProvider.discover()`). Set `running = true`.
- `stop()`: Disconnect source (`source.disconnect()`), close provider (`toolProvider.close()`). Set `running = false`.
- `isRunning()`: Return current state.

AC5.4 is enforced at the composition root level — `start()` is only called on wake, `stop()` on sleep.

**Testing:**

Mock source and tool provider. Tests:
- AC5.1: `start()` calls `source.connect()` then `toolProvider.discover()`
- AC5.2: `stop()` calls `source.disconnect()` then `toolProvider.close()`
- `isRunning()` returns correct state after start/stop

**Verification:**
Run: `bun test src/extensions/spacemolt/lifecycle.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt lifecycle coordinator for wake/sleep`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update barrel exports

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to barrel exports:
```typescript
export { createSpaceMoltLifecycle } from "./lifecycle.ts";
```

Note: No separate `session.ts` export — session handling is integrated into tool-provider.ts and source.ts directly.

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: export lifecycle from spacemolt barrel`
<!-- END_TASK_4 -->
