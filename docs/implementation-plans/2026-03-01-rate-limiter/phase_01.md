# Rate Limiter Implementation Plan — Phase 1: Token Bucket Core

**Goal:** Pure functional token bucket implementation with full test coverage.

**Architecture:** Three independent token buckets (RPM, ITPM, OTPM) using continuous refill. Pure functions operate on immutable state, returning new state values. No side effects, no I/O — Functional Core only.

**Tech Stack:** Bun, TypeScript (strict mode), bun:test

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### rate-limiter.AC6: Token bucket mechanics
- **rate-limiter.AC6.1 Success:** Bucket refills continuously based on elapsed time (not at fixed intervals)
- **rate-limiter.AC6.2 Success:** Bucket never exceeds capacity after refill
- **rate-limiter.AC6.3 Success:** `tryConsume` returns exact `waitMs` needed for requested amount to become available
- **rate-limiter.AC6.4 Success:** `getStatus` returns current remaining, capacity, and next refill time

### rate-limiter.AC1 (partial): Rate limiting prevents 429 errors
- **rate-limiter.AC1.5 Success:** Post-response, buckets are corrected with actual `response.usage` values (not estimates)
- **rate-limiter.AC1.6 Edge:** When actual consumption exceeds estimate, bucket goes negative and subsequent calls wait for refill past zero
- **rate-limiter.AC1.7 Edge:** When actual consumption is less than estimate, excess capacity is credited back to bucket

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create rate-limit module types and CLAUDE.md

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/rate-limit/types.ts`
- Create: `src/rate-limit/CLAUDE.md`

**Implementation:**

Create `src/rate-limit/types.ts`:

```typescript
// pattern: Functional Core

export type TokenBucketConfig = {
  readonly capacity: number;
  readonly refillRate: number; // tokens per millisecond
};

export type TokenBucket = {
  readonly capacity: number;
  readonly refillRate: number;
  readonly tokens: number;
  readonly lastRefill: number; // timestamp in ms
};

export type ConsumeResult = {
  readonly allowed: boolean;
  readonly bucket: TokenBucket;
  readonly waitMs: number;
};

export type RateLimiterConfig = {
  readonly requestsPerMinute: number;
  readonly inputTokensPerMinute: number;
  readonly outputTokensPerMinute: number;
  readonly minOutputReserve?: number;
};

export type BucketStatus = {
  readonly remaining: number;
  readonly capacity: number;
  readonly refillRate: number; // tokens per millisecond (continuous refill — no discrete "next refill time")
};

export type RateLimitStatus = {
  readonly rpm: BucketStatus;
  readonly inputTokens: BucketStatus;
  readonly outputTokens: BucketStatus;
  readonly queueDepth: number;
};
```

Create `src/rate-limit/CLAUDE.md`:

```markdown
# Rate Limit

Last verified: 2026-03-01

## Purpose
Client-side token bucket rate limiter that wraps `ModelProvider` to enforce per-model throughput limits. Prevents 429 errors from API rate limit exhaustion by proactively throttling requests.

## Contracts
- **Exposes**: `TokenBucket` type, `createTokenBucket()`, `tryConsume()`, `recordConsumption()`, `getStatus()` (pure functions), `createRateLimitedProvider()` (imperative wrapper), `RateLimiterConfig`, `RateLimitStatus`, `ConsumeResult`, `TokenBucketConfig`
- **Guarantees**:
  - Token buckets refill continuously based on elapsed time, never exceeding capacity
  - `tryConsume` returns exact wait time when insufficient capacity
  - `recordConsumption` corrects buckets with actual usage, allowing negative balances
  - `RateLimitedProvider` serialises concurrent callers via mutex
  - Requests are queued (never dropped) when rate limited
- **Expects**: Valid `RateLimiterConfig` with positive values, `ModelProvider` interface for wrapping

## Dependencies
- **Uses**: `src/model/` (`ModelProvider` interface for wrapping)
- **Used by**: `src/index.ts` (composition root), `src/agent/` (via context provider)
- **Boundary**: Rate limiter wraps `ModelProvider` transparently. Consumers see the same interface.

## Key Decisions
- Pure functional token bucket (Functional Core) with imperative wrapper (Imperative Shell)
- Continuous refill based on elapsed time (not interval-based)
- chars/4 heuristic for pre-request estimation, corrected post-response with actual usage
- Promise-based mutex for concurrent access serialisation
- Negative bucket balances allowed (natural backpressure from underestimation)

## Key Files
- `types.ts` -- Domain types: `TokenBucket`, `TokenBucketConfig`, `ConsumeResult`, `RateLimiterConfig`, `RateLimitStatus`
- `bucket.ts` -- Pure token bucket functions: `createTokenBucket`, `refill`, `tryConsume`, `recordConsumption`, `getStatus`
- `provider.ts` -- `RateLimitedProvider` imperative wrapper with mutex
- `index.ts` -- Barrel exports
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(rate-limit): add token bucket domain types and module docs`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Token bucket pure functions and tests

**Verifies:** rate-limiter.AC6.1, rate-limiter.AC6.2, rate-limiter.AC6.3, rate-limiter.AC6.4, rate-limiter.AC1.5, rate-limiter.AC1.6, rate-limiter.AC1.7

**Files:**
- Create: `src/rate-limit/bucket.ts`
- Create: `src/rate-limit/bucket.test.ts`

**Implementation:**

Create `src/rate-limit/bucket.ts` with the following pure functions. All functions take a `TokenBucket` and return a new `TokenBucket` (or result containing one) — no mutation.

`createTokenBucket(config, now)`: Creates a new bucket at full capacity. `now` is a timestamp in ms.

`refill(bucket, now)`: Returns a new bucket with tokens refilled based on elapsed time since `lastRefill`. Tokens are capped at `capacity` (AC6.2). Updates `lastRefill` to `now`.

`tryConsume(bucket, amount, now)`: Refills first, then checks if `amount` tokens are available. If yes, returns `{ allowed: true, bucket: <deducted>, waitMs: 0 }`. If no, returns `{ allowed: false, bucket: <refilled but not deducted>, waitMs: <exact ms until amount is available> }` (AC6.3). The `waitMs` calculation: `(amount - bucket.tokens) / bucket.refillRate`.

`recordConsumption(bucket, estimated, actual, now)`: Corrects the bucket after a response. Credits back `estimated - actual` tokens (which goes negative if `actual > estimated`, per AC1.6). Refills first based on elapsed time since last refill.

`getStatus(bucket, now)`: Returns `{ remaining, capacity }` after refilling to current time (AC6.4).

```typescript
// pattern: Functional Core

import type { TokenBucket, TokenBucketConfig, ConsumeResult } from './types.js';

export function createTokenBucket(config: TokenBucketConfig, now: number): TokenBucket {
  return {
    capacity: config.capacity,
    refillRate: config.refillRate,
    tokens: config.capacity,
    lastRefill: now,
  };
}

export function refill(bucket: TokenBucket, now: number): TokenBucket {
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return bucket;

  const added = elapsed * bucket.refillRate;
  const newTokens = Math.min(bucket.tokens + added, bucket.capacity);

  return { ...bucket, tokens: newTokens, lastRefill: now };
}

export function tryConsume(bucket: TokenBucket, amount: number, now: number): ConsumeResult {
  const refilled = refill(bucket, now);

  if (refilled.tokens >= amount) {
    return {
      allowed: true,
      bucket: { ...refilled, tokens: refilled.tokens - amount },
      waitMs: 0,
    };
  }

  const deficit = amount - refilled.tokens;
  const waitMs = deficit / refilled.refillRate;

  return {
    allowed: false,
    bucket: refilled,
    waitMs,
  };
}

export function recordConsumption(
  bucket: TokenBucket,
  estimated: number,
  actual: number,
  now: number,
): TokenBucket {
  const refilled = refill(bucket, now);
  const correction = estimated - actual;
  return { ...refilled, tokens: refilled.tokens + correction };
}

export function getStatus(
  bucket: TokenBucket,
  now: number,
): { readonly remaining: number; readonly capacity: number; readonly refillRate: number } {
  const refilled = refill(bucket, now);
  return { remaining: refilled.tokens, capacity: refilled.capacity, refillRate: refilled.refillRate };
}
```

**Testing:**

Tests must verify each AC listed above. Follow the project's test patterns:
- Use `describe`/`it` blocks from `bun:test`
- Name describe blocks with AC references: `describe('tryConsume returns exact waitMs (rate-limiter.AC6.3)', ...)`
- Use deterministic timestamps (no `Date.now()`)
- Create helper `createTestBucket(overrides?)` for test fixtures
- File starts with `// pattern: Functional Core`

Tests to write:

- **rate-limiter.AC6.1:** Create bucket at t=0 with capacity 100 and refillRate 1/ms. At t=50, refill should add 50 tokens. Verify tokens increase based on elapsed time.
- **rate-limiter.AC6.2:** Create bucket at capacity. Refill after time passes. Verify tokens never exceed capacity.
- **rate-limiter.AC6.3:** Create bucket with 10 tokens, try to consume 30. Verify `allowed: false` and `waitMs` equals `(30 - 10) / refillRate`. Then create bucket with 50 tokens, consume 30 — verify `allowed: true`, `waitMs: 0`, and bucket has 20 tokens remaining.
- **rate-limiter.AC6.4:** Create bucket, consume some tokens, call `getStatus`. Verify it returns current remaining and capacity. Verify status reflects refill at current time.
- **rate-limiter.AC1.5:** Create bucket, consume estimated 100 tokens. Call `recordConsumption(bucket, 100, 80, now)` — verify 20 tokens are credited back.
- **rate-limiter.AC1.6:** Create bucket with 50 tokens. Consume 50 (estimated). Call `recordConsumption(bucket, 50, 80, now)` — verify bucket goes to -30. Then `tryConsume` should return `allowed: false` with waitMs to refill past zero.
- **rate-limiter.AC1.7:** Create bucket with 50 tokens. Consume 50 (estimated). Call `recordConsumption(bucket, 50, 30, now)` — verify 20 tokens credited back (bucket at 20).

Edge cases:
- `tryConsume` with amount 0 should always succeed
- `refill` with no time elapsed returns same bucket
- `recordConsumption` where estimated equals actual — no change
- `createTokenBucket` starts at full capacity

**Verification:**

Run: `bun test src/rate-limit/bucket.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(rate-limit): implement token bucket pure functions with tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/rate-limit/index.ts`

**Implementation:**

Create `src/rate-limit/index.ts` following the project's barrel export pattern:

```typescript
// pattern: Functional Core

export type { TokenBucket, TokenBucketConfig, ConsumeResult, RateLimiterConfig, RateLimitStatus, BucketStatus } from './types.js';
export { createTokenBucket, refill, tryConsume, recordConsumption, getStatus } from './bucket.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/rate-limit/`
Expected: All tests still pass

**Commit:** `feat(rate-limit): add barrel exports`

<!-- END_TASK_3 -->
