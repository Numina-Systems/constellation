# Rate Limiter -- Test Requirements

Generated from design: docs/design-plans/2026-03-01-rate-limiter.md

## Automated Test Coverage

### rate-limiter.AC1: Rate limiting prevents 429 errors

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC1.1 | When input token budget is available, requests pass through without delay | unit | `src/rate-limit/provider.test.ts` | Create provider with high limits. Call `complete()`. Verify response passes through and elapsed time is < 100ms. | 2 |
| rate-limiter.AC1.2 | When input token budget is exhausted, subsequent requests wait until budget refills, then succeed | unit | `src/rate-limit/provider.test.ts` | Create provider with ITPM budget of 200. Send request consuming ~200 input tokens (estimate). First call succeeds immediately; second call is delayed until budget refills. | 2 |
| rate-limiter.AC1.3 | When RPM budget is exhausted, subsequent requests wait until budget refills | unit | `src/rate-limit/provider.test.ts` | Create provider with RPM of 1. Call `complete()` twice in quick succession. Second call waits for RPM refill. | 2 |
| rate-limiter.AC1.4 | When OTPM budget is below `minOutputReserve`, requests wait until sufficient output budget exists | unit | `src/rate-limit/provider.test.ts` | Create provider with OTPM of 500 and minOutputReserve of 1024. Call `complete()`. Should wait because OTPM (500) < minOutputReserve (1024). | 2 |
| rate-limiter.AC1.5 | Post-response, buckets are corrected with actual `response.usage` values (not estimates) | unit | `src/rate-limit/bucket.test.ts` | Create bucket, consume estimated 100 tokens. Call `recordConsumption(bucket, 100, 80, now)` -- verify 20 tokens are credited back. | 1 |
| rate-limiter.AC1.5 | Post-response, buckets are corrected with actual `response.usage` values (provider-level) | unit | `src/rate-limit/provider.test.ts` | Create provider with known budget. Call `complete()`. Verify bucket state reflects actual usage from `response.usage`, not the pre-request estimate. | 2 |
| rate-limiter.AC1.6 | When actual consumption exceeds estimate, bucket goes negative and subsequent calls wait for refill past zero | unit | `src/rate-limit/bucket.test.ts` | Create bucket with 50 tokens. Consume 50 (estimated). Call `recordConsumption(bucket, 50, 80, now)` -- verify bucket goes to -30. Then `tryConsume` returns `allowed: false` with waitMs to refill past zero. | 1 |
| rate-limiter.AC1.7 | When actual consumption is less than estimate, excess capacity is credited back to bucket | unit | `src/rate-limit/bucket.test.ts` | Create bucket with 50 tokens. Consume 50 (estimated). Call `recordConsumption(bucket, 50, 30, now)` -- verify 20 tokens credited back (bucket at 20). | 1 |

### rate-limiter.AC2: Per-model configurable budgets

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC2.1 | Each `ModelProvider` instance gets its own independent rate limit buckets | integration | `src/index.ts` (structural verification via `bun run build` + `bun test`) | Verified structurally: each model provider gets its own `createRateLimitedProvider` call with independent buckets. Type-check confirms wiring. | 5 |
| rate-limiter.AC2.2 | Rate limit config fields on `ModelConfigSchema` are optional; when absent, provider is not wrapped | unit | `src/config/schema.test.ts` | Parse full `AppConfigSchema` config with no rate limit fields on `[model]`. Verify parse succeeds and rate limit fields are `undefined`. Also: parse config with all four fields present, verify values are preserved. | 3 |
| rate-limiter.AC2.3 | Summarization model can have different rate limits than the main model | unit | `src/config/schema.test.ts` | Parse config with rate limit fields on `[model]` and different rate limit fields on `[summarization]`. Verify both parse independently with their own values. | 3 |
| rate-limiter.AC2.4 | Invalid rate limit config values (zero, negative) are rejected by Zod validation | unit | `src/config/schema.test.ts` | Parse config with `requests_per_minute: 0` -- Zod rejects (`.positive()`). Parse with `input_tokens_per_minute: -100` -- Zod rejects. Parse with `output_tokens_per_minute: 1.5` -- Zod rejects (`.int()`). | 3 |

### rate-limiter.AC3: Spirit sees resource budget in context

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC3.1 | System prompt includes current remaining capacity for input tokens, output tokens, and queue depth | unit | `src/agent/context.test.ts` | Call `buildSystemPrompt(mockMemory, [() => '## Resource Budget\nInput tokens: 1000/5000'])`. Verify the resource budget section is appended after the memory prompt. | 4 |
| rate-limiter.AC3.1 | System prompt includes resource budget (composition root wiring) | integration | `src/index.ts` (structural verification via `bun run build`) | Verified structurally: when `hasRateLimitConfig` returns true, a context provider calling `getStatus()` is registered and passed to agent creation. | 5 |
| rate-limiter.AC3.2 | Budget display updates each round (reflects consumption from previous round) | unit | `src/agent/context.test.ts` | Call `buildSystemPrompt` twice with a provider that returns different values each time (simulating consumption between rounds). Verify each call reflects the current provider output. | 4 |
| rate-limiter.AC3.3 | When no rate limiter is configured, no budget section appears in system prompt | unit | `src/agent/context.test.ts` | Call `buildSystemPrompt(mockMemory)` with no context providers. Verify output equals `memory.buildSystemPrompt()` result exactly. Also test with empty array -- same result. | 4 |
| rate-limiter.AC3.3 | No budget section when unconfigured (composition root level) | integration | `src/index.ts` (structural verification via `bun run build`) | Verified structurally: when `hasRateLimitConfig` returns false, no context provider is created, so `contextProviders` is `undefined`. | 5 |

### rate-limiter.AC4: REPL remains responsive

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC4.1 | Requests are queued and eventually processed, never dropped | unit | `src/rate-limit/provider.test.ts` | Send multiple concurrent requests to a rate-limited provider. All eventually resolve -- none are rejected or dropped. | 2 |
| rate-limiter.AC4.2 | Concurrent callers (REPL agent + bluesky agent) are serialised by mutex -- both eventually proceed | unit | `src/rate-limit/provider.test.ts` | Launch two `complete()` calls concurrently. Both resolve. Verify serialisation via timing or call order on the mock provider. | 2 |
| rate-limiter.AC4.3 | Two concurrent callers cannot both observe sufficient capacity and both consume it (no double-spend) | unit | `src/rate-limit/provider.test.ts` | Create provider with exact budget for 1 request. Launch two concurrent `complete()` calls. Verify only one proceeds immediately, the other waits for refill. | 2 |

### rate-limiter.AC5: Retry wrapper coexists

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC5.1 | Rate limiter sits above `retry.ts`; if a 429 sneaks through, retry handles it | unit | `src/rate-limit/provider.test.ts` | Rate limiter wraps provider. If wrapped provider throws a ModelError with `rate_limit` code, the error propagates up unchanged (retry is inside the adapter, below the rate limiter). | 2 |
| rate-limiter.AC5.1 | Rate limiter sits above retry (composition root level) | integration | `src/index.ts` (structural verification via `bun run build`) | Verified structurally: `createRateLimitedProvider` wraps the `ModelProvider` returned by `createModelProvider`, which internally contains retry logic. The rate limiter is above. | 5 |
| rate-limiter.AC5.2 | Rate limiter does not interfere with retry's exponential backoff behaviour | unit | `src/rate-limit/provider.test.ts` | Verify rate limiter does not catch or transform errors from the underlying provider. Errors propagate unmodified. | 2 |

### rate-limiter.AC6: Token bucket mechanics

| AC ID | Criterion | Test Type | Test File | What the Test Verifies | Phase |
|-------|-----------|-----------|-----------|----------------------|-------|
| rate-limiter.AC6.1 | Bucket refills continuously based on elapsed time (not at fixed intervals) | unit | `src/rate-limit/bucket.test.ts` | Create bucket at t=0 with capacity 100 and refillRate 1/ms. At t=50, refill should add 50 tokens. Verify tokens increase proportionally to elapsed time. | 1 |
| rate-limiter.AC6.2 | Bucket never exceeds capacity after refill | unit | `src/rate-limit/bucket.test.ts` | Create bucket at capacity. Refill after time passes. Verify tokens never exceed capacity. | 1 |
| rate-limiter.AC6.3 | `tryConsume` returns exact `waitMs` needed for requested amount to become available | unit | `src/rate-limit/bucket.test.ts` | Create bucket with 10 tokens, try to consume 30. Verify `allowed: false` and `waitMs` equals `(30 - 10) / refillRate`. Also: bucket with 50 tokens, consume 30 -- verify `allowed: true`, `waitMs: 0`, and 20 tokens remaining. | 1 |
| rate-limiter.AC6.4 | `getStatus` returns current remaining, capacity, and refill rate | unit | `src/rate-limit/bucket.test.ts` | Create bucket, consume some tokens, call `getStatus`. Verify it returns current remaining, capacity, and refillRate. Verify status reflects refill at current time. | 1 |

### Additional Edge Case Tests (not mapped to specific ACs)

| Test Description | Test Type | Test File | Phase |
|-----------------|-----------|-----------|-------|
| `tryConsume` with amount 0 always succeeds | unit | `src/rate-limit/bucket.test.ts` | 1 |
| `refill` with no time elapsed returns same bucket | unit | `src/rate-limit/bucket.test.ts` | 1 |
| `recordConsumption` where estimated equals actual produces no change | unit | `src/rate-limit/bucket.test.ts` | 1 |
| `createTokenBucket` starts at full capacity | unit | `src/rate-limit/bucket.test.ts` | 1 |
| `estimateInputTokens` with empty request returns 0 | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` with system prompt only | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` with single text message | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` with ContentBlock array (TextBlock, ToolUseBlock, ToolResultBlock) | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` with ToolResultBlock string vs array content | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` with tools array (name, description, input_schema) | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` combined system + messages + tools | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `estimateInputTokens` rounds up via `Math.ceil` (e.g., 5 chars = 2 tokens) | unit | `src/rate-limit/estimate.test.ts` | 2 |
| `buildSystemPrompt` with empty context providers array -- no extra content | unit | `src/agent/context.test.ts` | 4 |
| Context provider returning `undefined` is skipped -- no empty sections | unit | `src/agent/context.test.ts` | 4 |
| Multiple context providers -- all non-undefined sections appended in order, separated by `\n\n` | unit | `src/agent/context.test.ts` | 4 |

## Human Verification

| AC ID | Criterion | Verification Approach | Justification |
|-------|-----------|----------------------|---------------|
| rate-limiter.AC2.1 | Each `ModelProvider` instance gets its own independent rate limit buckets | Code review of `src/index.ts` composition root wiring. Verify that main model and summarization model each get separate `createRateLimitedProvider` calls with independent config. Run `bun run start` with rate limits configured on both `[model]` and `[summarization]` and confirm both log rate-limiting-active messages with independent values. | This is structural wiring in the composition root. Automated testing would require starting the full application with two real model providers. The independent-buckets guarantee is enforced by the factory function pattern (each call creates new state), but confirming the wiring correctness at the composition root level is best done via code review and a startup smoke test. |
| rate-limiter.AC5.1 | Rate limiter sits above `retry.ts`; if a 429 sneaks through, retry handles it | Code review of `src/index.ts` to confirm wrapping order: `createRateLimitedProvider(createModelProvider(...))`. The inner `createModelProvider` contains the retry adapter. Also confirmable via the unit test in `provider.test.ts` that verifies errors propagate unmodified. | The layering guarantee is architectural. The unit test confirms errors pass through, but the actual ordering (rate limiter above retry) is a composition root concern verified by structural inspection, not by a test that exercises both layers simultaneously. |

## Notes

### Test strategy overview

Tests are organized in three layers:

1. **Pure function unit tests** -- `bucket.test.ts` and `estimate.test.ts` test the Functional Core directly: token bucket arithmetic, refill mechanics, consumption correction, and input token estimation. These are fast, deterministic, and cover the bulk of AC1 and AC6.

2. **Provider wrapper unit tests** -- `provider.test.ts` tests the Imperative Shell wrapper using mock `ModelProvider` objects. These verify the mutex serialisation, wait-for-refill behaviour, post-response correction wiring, and error passthrough. Covers AC1 (provider-level), AC4, and AC5.

3. **Config schema unit tests** -- `schema.test.ts` tests Zod validation of rate limit fields: optional presence, positive integer constraints, independent model/summarization config. Covers AC2.

4. **Context provider unit tests** -- `context.test.ts` tests the system prompt assembly with context providers: appending budget sections, skipping absent providers, updating each round. Covers AC3.

5. **Structural integration verification** -- Phase 5 wiring is verified by `bun run build` (type-check) and `bun test` (no regressions). The composition root wiring for AC2.1, AC3.1, AC3.3, and AC5.1 is confirmed structurally rather than via dedicated integration tests.

### No real LLM calls

All automated tests use mock model providers. The actual 429-prevention behaviour under real API load is not testable via automation -- that is an implicit operational verification during real-world usage with rate limits configured.

### AC coverage is intentionally redundant

Several ACs (AC1.5, AC3.1, AC3.3, AC5.1) appear in both unit tests and structural/integration verification. Unit tests catch functional regressions; structural verification confirms composition correctness.

### Deterministic time in tests

All token bucket tests use explicit timestamps passed as arguments (`now` parameter) rather than `Date.now()`. This ensures deterministic, reproducible test behaviour with no timing-dependent flakiness.
