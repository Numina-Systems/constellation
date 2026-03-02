# Rate Limiter Design

## Summary

Constellation is an AI agent daemon ("the spirit") that can process events from multiple sources simultaneously -- a user-facing REPL and a Bluesky social firehose. Both paths call Anthropic's LLM API, and event bursts from the firehose can exhaust the API's token-per-minute ceiling, triggering 429 errors that break both flows. This design adds a client-side rate limiter to prevent that.

The implementation wraps each `ModelProvider` instance in a `RateLimitedProvider` decorator that maintains three independent token buckets -- one each for requests per minute, input tokens per minute, and output tokens per minute. Before every LLM call, the wrapper estimates cost and checks all three buckets; if any would be exceeded, it waits until capacity refills rather than dropping the request. After each response, actual token usage from the API replaces the estimate, crediting or debiting the difference. A mutex serialises concurrent access so two callers cannot both observe sufficient capacity and both consume it. Finally, the agent's system prompt is extended with a live resource budget section, letting the spirit reason about its own throughput constraints when deciding what to attend to.

## Definition of Done
A general-purpose, per-model rate limiter that wraps `ModelProvider` to proactively throttle LLM calls below the Anthropic token-per-minute ceiling, with rate limit state injected into the agent's system prompt so the spirit can reason about its own throughput budget.

- Bluesky event bursts no longer trigger 429 errors
- Each model provider instance has its own configurable token budget
- The spirit sees its remaining budget in context and can make informed decisions about what to attend to
- The REPL remains responsive (the rate limiter queues/delays, not drops)
- Existing retry wrapper (`retry.ts`) remains as a safety net below the rate limiter
- Out of scope: hardcoded priority between REPL and bluesky (agent decides), embedding rate limits, token counting beyond `chars/4` heuristic

## Acceptance Criteria

### rate-limiter.AC1: Rate limiting prevents 429 errors
- **rate-limiter.AC1.1 Success:** When input token budget is available, requests pass through without delay
- **rate-limiter.AC1.2 Success:** When input token budget is exhausted, subsequent requests wait until budget refills, then succeed
- **rate-limiter.AC1.3 Success:** When RPM budget is exhausted, subsequent requests wait until budget refills
- **rate-limiter.AC1.4 Success:** When OTPM budget is below `minOutputReserve`, requests wait until sufficient output budget exists
- **rate-limiter.AC1.5 Success:** Post-response, buckets are corrected with actual `response.usage` values (not estimates)
- **rate-limiter.AC1.6 Edge:** When actual consumption exceeds estimate, bucket goes negative and subsequent calls wait for refill past zero
- **rate-limiter.AC1.7 Edge:** When actual consumption is less than estimate, excess capacity is credited back to bucket

### rate-limiter.AC2: Per-model configurable budgets
- **rate-limiter.AC2.1 Success:** Each `ModelProvider` instance gets its own independent rate limit buckets
- **rate-limiter.AC2.2 Success:** Rate limit config fields on `ModelConfigSchema` are optional; when absent, provider is not wrapped
- **rate-limiter.AC2.3 Success:** Summarization model can have different rate limits than the main model
- **rate-limiter.AC2.4 Failure:** Invalid rate limit config values (zero, negative) are rejected by Zod validation

### rate-limiter.AC3: Spirit sees resource budget in context
- **rate-limiter.AC3.1 Success:** System prompt includes current remaining capacity for input tokens, output tokens, and queue depth
- **rate-limiter.AC3.2 Success:** Budget display updates each round (reflects consumption from previous round)
- **rate-limiter.AC3.3 Success:** When no rate limiter is configured, no budget section appears in system prompt

### rate-limiter.AC4: REPL remains responsive
- **rate-limiter.AC4.1 Success:** Requests are queued and eventually processed, never dropped
- **rate-limiter.AC4.2 Success:** Concurrent callers (REPL agent + bluesky agent) are serialised by mutex -- both eventually proceed
- **rate-limiter.AC4.3 Edge:** Two concurrent callers cannot both observe sufficient capacity and both consume it (no double-spend)

### rate-limiter.AC5: Retry wrapper coexists
- **rate-limiter.AC5.1 Success:** Rate limiter sits above `retry.ts`; if a 429 sneaks through, retry handles it
- **rate-limiter.AC5.2 Success:** Rate limiter does not interfere with retry's exponential backoff behaviour

### rate-limiter.AC6: Token bucket mechanics
- **rate-limiter.AC6.1 Success:** Bucket refills continuously based on elapsed time (not at fixed intervals)
- **rate-limiter.AC6.2 Success:** Bucket never exceeds capacity after refill
- **rate-limiter.AC6.3 Success:** `tryConsume` returns exact `waitMs` needed for requested amount to become available
- **rate-limiter.AC6.4 Success:** `getStatus` returns current remaining, capacity, and next refill time

## Glossary

- **Token bucket**: A rate-limiting algorithm where capacity refills continuously over time at a fixed rate, up to a maximum. Requests consume from the bucket; when it's empty, callers wait for it to refill.
- **RPM (Requests Per Minute)**: A dimension of Anthropic's API rate limits tracking how many API calls can be made per minute.
- **ITPM (Input Tokens Per Minute)**: The per-minute cap on tokens sent to the API in requests.
- **OTPM (Output Tokens Per Minute)**: The per-minute cap on tokens the API returns in responses.
- **`minOutputReserve`**: A configurable minimum output-token reservation held back from the OTPM bucket before a request is sent, ensuring the model has room to produce a meaningful reply.
- **`ModelProvider`**: The port interface in `src/model/` that abstracts LLM backends (Anthropic, OpenAI-compatible). The rate limiter wraps any `ModelProvider` transparently.
- **`ContextProvider`**: A new extension type introduced by this design. A function that returns an optional string appended to the agent's system prompt each round.
- **`RateLimitedProvider`**: The decorator this design introduces -- a `ModelProvider` wrapper that enforces token bucket limits before delegating to the underlying provider.
- **Functional Core / Imperative Shell**: Constellation's architectural pattern. Pure business logic (no side effects) lives in the functional core; I/O and orchestration live in the imperative shell.
- **Mutex (promise-based)**: A mutual exclusion lock implemented with chained promises. Ensures the check-wait-deduct sequence is atomic -- concurrent callers are serialised rather than allowed to race.
- **Bucket underflow**: When actual token consumption exceeds the pre-request estimate, the bucket is corrected to a negative value after the response. Subsequent calls must wait for the bucket to refill past zero.
- **Backpressure**: The mechanism by which a downstream bottleneck (API rate limits) slows upstream callers. Here, the rate limiter translates API limits into wait time rather than errors.
- **429**: HTTP status code meaning "Too Many Requests" -- the error Anthropic returns when a client exceeds its rate limit.
- **`chars/4` heuristic**: A rough approximation of token count used for pre-request estimation (4 characters ~ 1 token). Replaced by actual usage post-response.
- **Composition root**: The application entry point (`src/index.ts`) where all dependencies are wired together. Rate limiter wrapping is conditional here -- present when configured, zero overhead when not.
- **Zod**: A TypeScript-first schema validation library used throughout the project for config parsing and runtime type enforcement.

## Architecture

Client-side token bucket rate limiter that wraps `ModelProvider` to enforce per-model throughput limits. Three independent token buckets per provider instance track requests per minute (RPM), input tokens per minute (ITPM), and output tokens per minute (OTPM).

### Core Components

**TokenBucket** (pure, functional core): Tracks capacity for a single dimension. Refills continuously based on elapsed time. Supports `tryConsume` (pre-request check returning wait time if over budget) and `recordConsumption` (post-response correction with actual token counts).

**RateLimitedProvider** (imperative shell): Wraps any `ModelProvider`, implementing the same interface transparently. Pre-request: estimates input tokens via `chars/4` heuristic, checks RPM and ITPM buckets, reserves `minOutputReserve` from OTPM bucket. If any bucket is insufficient, awaits until capacity refills. Post-response: corrects all three buckets with actual `response.usage` values, crediting or debiting the difference between estimated and actual.

**ContextProvider** (agent extension): A general-purpose mechanism for injecting additional context into the system prompt. The rate limiter registers a context provider that exposes current bucket state (remaining capacity, queue depth) so the spirit can reason about its throughput budget. The `ContextProvider` type lives in `src/agent/types.ts`; the agent loop appends context provider output to the system prompt each round.

### Data Flow

```
caller (agent/compactor)
  → RateLimitedProvider.complete(request)
    → estimate input tokens from request
    → acquire mutex (serialize concurrent callers)
    → tryConsume RPM bucket (1 request)
    → tryConsume ITPM bucket (estimated input tokens)
    → tryConsume OTPM bucket (minOutputReserve)
    → if any bucket insufficient: await sleep(max waitMs), retry check
    → release mutex
    → delegate to underlying ModelProvider.complete(request)
    → recordConsumption on all 3 buckets with actual response.usage
    → return response unchanged
```

### Configuration

Rate limit fields are added directly to `ModelConfigSchema` (and by extension `SummarizationConfigSchema`) as optional fields. When present, the composition root wraps the provider. When absent, no wrapping — zero overhead.

```typescript
type RateLimiterConfig = {
  readonly requestsPerMinute: number;
  readonly inputTokensPerMinute: number;
  readonly outputTokensPerMinute: number;
  readonly minOutputReserve?: number;    // default: 1024
};
```

### Context Injection

The agent's dependency contract gains a `contextProviders?: ReadonlyArray<ContextProvider>` field. Each provider returns an optional string appended to the system prompt. The composition root creates a closure that reads `RateLimitedProvider.getStatus()` and formats it as a `## Resource Budget` section visible to the spirit.

The spirit sees:
```
## Resource Budget
Input tokens: 12000/30000 remaining this minute
Output tokens: 8000/10000 remaining this minute
Queued requests: 3
```

### Concurrency

Two agents (REPL and bluesky) share the same `RateLimitedProvider` instance. A promise-based mutex serialises the check-wait-deduct sequence so concurrent callers cannot both observe sufficient capacity and both consume it.

## Existing Patterns

Investigation found the following patterns this design follows:

**Factory function pattern**: All modules use `createXxx(config): Interface` — e.g., `createModelProvider()` in `src/model/factory.ts:8`, `createSearchChain()` in `src/web/chain.ts:20`, `createCompactor()` in `src/compaction/compactor.ts:434`. The rate limiter follows this with `createRateLimitedProvider(provider, config): ModelProvider & { getStatus() }`.

**Module structure**: Every module has `types.ts` (domain types), `index.ts` (barrel exports), implementation files with `// pattern:` annotations, tests, and `CLAUDE.md`. Confirmed across `src/web/`, `src/compaction/`, `src/tool/`.

**Optional config sections**: `SummarizationConfigSchema` and `WebConfigSchema` in `src/config/schema.ts` demonstrate the pattern: define a Zod schema, add to `AppConfigSchema` with `.optional()`, export inferred type. Rate limit fields follow this pattern but are added to `ModelConfigSchema` directly rather than as a separate section, since they're per-model.

**Conditional composition root wiring**: `src/index.ts` checks `if (config.web)` before creating web tools, and conditionally creates `summarizationModel` vs reusing `model`. Rate limiter wrapping follows the same pattern: `hasRateLimitConfig(config.model) ? createRateLimitedProvider(rawModel, ...) : rawModel`.

**System prompt assembly**: Currently `buildSystemPrompt()` in `src/agent/context.ts:17` delegates entirely to `memory.buildSystemPrompt()` which assembles core memory blocks. No existing `contextProviders` mechanism exists — this design introduces one. This is a new pattern, justified by the need to inject non-memory context without coupling the memory module to rate limiting.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Token Bucket Core
**Goal:** Pure functional token bucket implementation with full test coverage.

**Components:**
- `TokenBucket` type and pure functions (`createTokenBucket`, `tryConsume`, `recordConsumption`, `getStatus`) in `src/rate-limit/bucket.ts`
- Domain types (`TokenBucket`, `RateLimiterConfig`, `RateLimitStatus`, `ConsumeResult`) in `src/rate-limit/types.ts`
- Barrel exports in `src/rate-limit/index.ts`
- Module documentation in `src/rate-limit/CLAUDE.md`

**Dependencies:** None (first phase).

**Done when:** Token bucket functions correctly track capacity, refill over time, report wait times when over budget, and handle negative balances from post-response correction. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: RateLimitedProvider Wrapper
**Goal:** ModelProvider wrapper that enforces rate limits using token buckets.

**Components:**
- `createRateLimitedProvider(provider, config)` factory in `src/rate-limit/provider.ts`
- Promise-based mutex for serialising concurrent callers
- Pre-request estimation, bucket checks, and post-response correction logic
- `getStatus()` extension method for context injection

**Dependencies:** Phase 1 (token bucket core).

**Done when:** Wrapped provider throttles calls when buckets are exhausted, waits for refill, delegates to underlying provider, corrects buckets post-response with actual usage, and handles concurrent callers safely. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Configuration
**Goal:** Rate limit configuration integrated into existing config system.

**Components:**
- Optional rate limit fields added to `ModelConfigSchema` in `src/config/schema.ts`
- Optional rate limit fields added to `SummarizationConfigSchema` in `src/config/schema.ts`
- Type exports updated in `src/config/config.ts`
- `config.toml.example` updated with rate limit examples

**Dependencies:** Phase 1 (types exist for validation).

**Done when:** Config loads and validates rate limit fields when present, ignores them when absent, and existing tests still pass. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Context Provider System
**Goal:** General-purpose context injection mechanism for the agent's system prompt.

**Components:**
- `ContextProvider` type added to `src/agent/types.ts`
- `contextProviders` field added to agent dependency contract
- System prompt assembly in `src/agent/context.ts` updated to append context provider output
- Agent creation in `src/agent/agent.ts` updated to accept and use context providers

**Dependencies:** Phase 2 (getStatus exists to read from).

**Done when:** Agent appends context provider strings to system prompt each round. Existing agent tests still pass. Context providers are optional — no providers means no change to prompt. All tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Composition Root Wiring
**Goal:** Wire rate limiter into the application at `src/index.ts`.

**Components:**
- Conditional wrapping of main model provider based on config presence
- Conditional wrapping of summarization model provider based on config presence
- Rate limit context provider closure created and passed to agent
- Console logging when rate limiting is active

**Dependencies:** Phase 2, Phase 3, Phase 4.

**Done when:** Application starts with rate limiting when configured, without rate limiting when not configured, and the spirit sees resource budget in its system prompt. All tests pass.
<!-- END_PHASE_5 -->

## Additional Considerations

**Estimation accuracy:** The `chars/4` heuristic is rough but self-correcting. Pre-request estimates are replaced by actual `response.usage` values post-response. Persistent under-estimation means occasional 429s caught by the existing retry wrapper. Persistent over-estimation means wasted throughput. Neither is catastrophic.

**Bucket underflow:** When actual consumption exceeds estimation, the bucket goes negative after correction. Subsequent calls wait until the bucket refills past zero. This is natural backpressure, not an error condition.

**Logging:** Waits exceeding 5 seconds are logged at info level with model name and wait duration for operational visibility.
