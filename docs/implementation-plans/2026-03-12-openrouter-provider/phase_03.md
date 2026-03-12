# OpenRouter Provider Implementation Plan — Phase 3

**Goal:** Add `syncFromServer()` to the rate-limited provider so it can accept external rate limit signals from OpenRouter's response headers.

**Architecture:** Add a `ServerRateLimitSync` callback type and `syncFromServer()` method to the rate-limited provider wrapper. The method overwrites the RPM bucket state using authoritative server values.

**Tech Stack:** TypeScript, Bun

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-provider.AC4: Rate limit header integration
- **openrouter-provider.AC4.1 Success:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers are parsed and passed to `syncFromServer`
- **openrouter-provider.AC4.2 Success:** `syncFromServer` overwrites RPM bucket tokens with `remaining` and capacity with `limit`
- **openrouter-provider.AC4.3 Success:** `syncFromServer` recalculates refill rate from `resetAt`
- **openrouter-provider.AC4.4 Edge:** `syncFromServer` is a no-op when limit and remaining are both 0

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `ServerRateLimitSync` type to rate-limit types

**Verifies:** openrouter-provider.AC4.1

**Files:**
- Modify: `src/rate-limit/types.ts` (add new type after `RateLimitStatus`)
- Modify: `src/rate-limit/index.ts` (export new type)

**Implementation:**

Add the `ServerRateLimitSync` type to `src/rate-limit/types.ts`:

```typescript
export type ServerRateLimitSync = (status: {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number; // unix timestamp in ms
}) => void;
```

Add `ServerRateLimitSync` to the type export in `src/rate-limit/index.ts`.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add ServerRateLimitSync type`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `syncFromServer()` method to rate-limited provider

**Verifies:** openrouter-provider.AC4.2, openrouter-provider.AC4.3, openrouter-provider.AC4.4

**Files:**
- Modify: `src/rate-limit/provider.ts:10-141` (add `syncFromServer` method and update return type)

**Implementation:**

In `src/rate-limit/provider.ts`:

1. Update the return type of `createRateLimitedProvider` (line 11) to include `syncFromServer`:
   ```typescript
   export function createRateLimitedProvider(
     provider: ModelProvider,
     config: RateLimiterConfig,
   ): ModelProvider & { getStatus(): RateLimitStatus; syncFromServer: ServerRateLimitSync } {
   ```

2. Import `ServerRateLimitSync` from `'./types.js'`.

3. Add the `syncFromServer` function inside `createRateLimitedProvider`, after the `status()` function (after line 134). The function must:
   - Accept `{ limit, remaining, resetAt }` matching the `ServerRateLimitSync` signature
   - No-op when both `limit` and `remaining` are 0 (AC4.4)
   - Overwrite `rpmBucketState` with:
     - `capacity` set to `limit`
     - `tokens` set to `remaining`
     - `lastRefill` set to `Date.now()`
     - `refillRate` recalculated as `limit / ((resetAt - Date.now()) || 60000)` — the rate needed to refill `limit` tokens by `resetAt`. If `resetAt` is in the past or now, default to 60s window.
   - Use the existing mutex (`withMutex`) to ensure thread-safety with concurrent requests

   ```typescript
   function syncFromServer(status: { readonly limit: number; readonly remaining: number; readonly resetAt: number }): void {
     if (status.limit === 0 && status.remaining === 0) return;

     const now = Date.now();
     const windowMs = Math.max(status.resetAt - now, 1000); // at least 1s window
     const refillRate = status.limit / windowMs;

     rpmBucketState = {
       capacity: status.limit,
       tokens: status.remaining,
       refillRate,
       lastRefill: now,
     };
   }
   ```

   **Design deviation — mutex not used for syncFromServer:**
   The design specifies "Mutex acquired during sync", but `syncFromServer` is intentionally synchronous (no mutex). Reasons:
   1. `syncFromServer` is called from the custom fetch wrapper inside a `complete()` call, which already holds the mutex. Using `withMutex` would deadlock.
   2. Making `syncFromServer` return `Promise<void>` would complicate the callback interface for the adapter (which calls it from a sync fetch callback context).
   3. The synchronous reference assignment is safe in JavaScript's single-threaded event loop — no interleaving within a synchronous block.
   4. Even in the theoretical case of a stale write, the next `tryConsume` cycle will refill from `lastRefill`, and subsequent `syncFromServer` calls will re-correct.

   This is an accepted trade-off: simpler API, no deadlock risk, correctness maintained by the continuous refill mechanism.

4. Add `syncFromServer` to the returned object (line 136-140):
   ```typescript
   return {
     complete,
     stream,
     getStatus: status,
     syncFromServer,
   };
   ```

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add syncFromServer to rate-limited provider`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for `syncFromServer`

**Verifies:** openrouter-provider.AC4.2, openrouter-provider.AC4.3, openrouter-provider.AC4.4

**Files:**
- Modify: `src/rate-limit/provider.test.ts` (add new describe block)

**Implementation:**

Add a new `describe('syncFromServer()')` block to the existing test file at `src/rate-limit/provider.test.ts`. Use the existing `createMockProvider` and `createRequest` helpers already defined in the file.

Tests must verify:
- openrouter-provider.AC4.2: Call `syncFromServer({ limit: 50, remaining: 30, resetAt })`, then `getStatus()` and verify `rpm.capacity === 50` and `rpm.remaining` is approximately 30
- openrouter-provider.AC4.3: Call `syncFromServer` with a `resetAt` 30 seconds in the future, verify `rpm.refillRate` is approximately `limit / 30000` (tokens per ms)
- openrouter-provider.AC4.4: Call `syncFromServer({ limit: 0, remaining: 0, resetAt: Date.now() })`, verify `getStatus().rpm` is unchanged from before the call

Follow the existing test patterns in the file: `describe`/`it` blocks, `createMockProvider()` for mock setup, `expect` assertions.

**Verification:**

Run: `bun test src/rate-limit/provider.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test: add syncFromServer tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
