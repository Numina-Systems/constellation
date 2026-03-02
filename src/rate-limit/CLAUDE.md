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
- `estimate.ts` -- Input token estimation: `estimateInputTokens` heuristic (chars/4)
- `provider.ts` -- `RateLimitedProvider` imperative wrapper with mutex
- `context.ts` -- Config helpers (`hasRateLimitConfig`, `buildRateLimiterConfig`) and `createRateLimitContextProvider` factory (Functional Core)
- `index.ts` -- Barrel exports
