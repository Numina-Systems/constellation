# Context Overflow Guard Design

## Summary

Constellation's agent loop currently checks whether message history is getting too long before deciding to compress it, but that check ignores everything *else* that consumes context: the system prompt, the serialised tool definitions the model receives every turn, and the token budget reserved for the model's own output. The result is that compaction can trigger too late — or not at all — and in the worst case the agent sends a request that the model simply rejects as too large.

This feature adds three independent layers of protection. First, the budget check is corrected so it subtracts all known overhead before comparing against the model's limit. Second, the compaction pipeline — which summarises older messages into condensed form — becomes resilient to timeouts: it retries with progressively smaller chunks before giving up. Third, a pre-flight guard sits between compaction and the actual model call and hard-truncates the oldest messages if the estimate still exceeds the limit after compaction. Messages are never deleted from the database; they're already persisted there. The guard is a safety valve for estimation error and compaction failure, not a replacement for either. A new optional `timeout` field on `ModelRequest` threads per-request timeout support through all four model adapters to enable the compaction timeout.

## Definition of Done

The agent never sends a request that exceeds the model's context limit. Specifically:

1. **Budget math is accurate** — `shouldCompress` accounts for system prompt, tool definitions, and output token reservation, not just message content
2. **Compaction is resilient** — summarisation LLM calls have a configurable timeout, use exponential backoff with smaller chunks on retry
3. **Failsafe truncation** — when compaction fails entirely, the agent hard-truncates oldest messages (they're already in the DB) rather than sending an oversized request
4. **Timeout is a first-class concept** — `ModelRequest` gains an optional `timeout` field respected by all adapters

## Acceptance Criteria

### context-overflow-guard.AC1: Budget math accounts for overhead
- **context-overflow-guard.AC1.1 Success:** `shouldCompress` returns `true` when message tokens alone are under budget but message tokens + overhead exceed it
- **context-overflow-guard.AC1.2 Success:** Overhead calculation includes system prompt, serialised tool definitions, and `max_tokens` output reservation
- **context-overflow-guard.AC1.3 Failure:** `shouldCompress` returns `false` when message tokens + overhead are within budget (no false positives)
- **context-overflow-guard.AC1.4 Edge:** Zero tools and empty system prompt produce zero overhead (only `max_tokens` contributes)

### context-overflow-guard.AC2: Compaction retries with chunk reduction
- **context-overflow-guard.AC2.1 Success:** Compaction retries on timeout error with exponential backoff
- **context-overflow-guard.AC2.2 Success:** Chunk size is halved on each retry attempt
- **context-overflow-guard.AC2.3 Success:** Chunk size never goes below a minimum floor (2 messages)
- **context-overflow-guard.AC2.4 Failure:** Non-retryable errors (auth, 400) fail immediately without retry
- **context-overflow-guard.AC2.5 Success:** Compaction timeout is passed through to `ModelRequest.timeout` on summarisation calls
- **context-overflow-guard.AC2.6 Edge:** Retry exhaustion returns original history unchanged (existing graceful degradation preserved)

### context-overflow-guard.AC3: Pre-flight guard truncates when needed
- **context-overflow-guard.AC3.1 Success:** Agent never calls `model.complete()` with estimated tokens exceeding `modelMaxTokens`
- **context-overflow-guard.AC3.2 Success:** Truncation preserves leading system messages (clip-archive summaries)
- **context-overflow-guard.AC3.3 Success:** Truncation preserves the most recent user message
- **context-overflow-guard.AC3.4 Success:** Oldest non-system messages are dropped first
- **context-overflow-guard.AC3.5 Success:** Warning is logged when the pre-flight guard fires
- **context-overflow-guard.AC3.6 Edge:** History with only system message + latest user message is never truncated further (minimum viable context)

### context-overflow-guard.AC4: ModelRequest timeout support
- **context-overflow-guard.AC4.1 Success:** All four adapters (OpenRouter, OpenAI-compat, Anthropic, Ollama) respect `timeout` when provided
- **context-overflow-guard.AC4.2 Success:** Omitting `timeout` uses adapter/SDK defaults (no behaviour change)
- **context-overflow-guard.AC4.3 Failure:** Timeout expiry produces a `ModelError` with `code: 'timeout'` and `retryable: true`

## Glossary

- **`shouldCompress`**: Function in `src/agent/context.ts` that decides whether the current message history is long enough to warrant compaction. Being extended here to account for overhead tokens beyond just message content.
- **compaction**: The pipeline (`src/compaction/compactor.ts`) that summarises older conversation messages into shorter form to free up context space. Controlled by `CompactionConfig`.
- **`CompactionConfig`**: Configuration type for the compaction pipeline; fields like `chunkSize`, `keepRecent`, and `maxSummaryTokens` tune its behaviour. This feature adds `timeout` and `maxRetries`.
- **context window / `modelMaxTokens`**: The hard upper limit on how many tokens a model can receive in a single request, including system prompt, tool definitions, message history, and the reserved space for the model's reply.
- **overhead tokens**: Everything in a model request that isn't part of the message array — system prompt text, serialised tool definitions, and the `max_tokens` output reservation. Currently not accounted for in the budget check.
- **`max_tokens` (output reservation)**: The number of tokens the caller asks the model to reserve for its response. Counts against the context window even though the response hasn't been generated yet.
- **pre-flight guard**: A new check inserted between compaction and `model.complete()` that truncates the oldest non-system messages as a last resort if the estimated request size still exceeds the model limit.
- **clip-archive summary**: A leading system message injected into conversation history containing a compressed summary of older context that has been archived. Must be preserved by truncation logic.
- **`ModelRequest`**: The shared request type passed to all model adapters. Gaining an optional `timeout` field in this feature.
- **exponential backoff**: A retry strategy where the wait time between retries doubles each attempt (e.g., 1s, 2s, 4s). Used in compaction retries and already present in `src/model/retry.ts`.
- **chunk size halving**: On each compaction retry, the number of messages per summarisation call is halved, producing smaller, faster requests less likely to time out.
- **`callWithRetry`**: Existing utility in `src/model/retry.ts` that wraps model calls with exponential backoff for transient errors. The compaction retry loop is separate because it also restructures input between attempts.
- **`AbortController`**: Web API used to cancel in-flight `fetch()` requests. Used in the Ollama adapter to implement the new `timeout` field.
- **token estimation heuristic**: `Math.ceil(text.length / 4)` — a rough approximation used in `src/agent/context.ts` and `src/compaction/compactor.ts`. Inaccurate enough that the pre-flight guard exists partly to catch its errors.

## Architecture

Three independent layers of defence prevent context overflow. Each layer works independently — if one fails, the next catches it.

**Layer 1 — Overhead-aware budget math.** `shouldCompress` gains an `overheadTokens` parameter representing everything outside the message array that consumes context: system prompt, serialised tool definitions, and output token reservation (`max_tokens`). The agent loop computes this overhead before calling `shouldCompress`, so compaction triggers when messages approach the *available* budget after overhead is subtracted.

**Layer 2 — Compaction resilience.** The compaction pipeline's summarisation calls get a configurable timeout (default 120s) and retry loop with exponential backoff. On retry, chunk size is halved to produce smaller, faster summarisation requests. This is a compaction-specific retry loop separate from the model-level retry in `src/model/retry.ts`, because it needs to restructure input between attempts. The model-level retry still handles transient rate limits within each attempt.

**Layer 3 — Pre-flight guard with hard truncation.** After compaction runs (or fails), and before `model.complete()` is called, the agent loop estimates the total request size (system prompt + tools + messages + output reservation). If the estimate exceeds `modelMaxTokens`, the oldest non-system messages are dropped from the history array until it fits. Messages aren't deleted from the database — they're already persisted. This is a safety valve, not a quality operation.

**Cross-cutting: `ModelRequest.timeout`.** An optional `timeout` field on `ModelRequest` makes per-request timeouts a first-class concept across all model adapters. Compaction uses this to set its summarisation timeout; the agent loop's own `model.complete()` calls continue using the SDK default.

## Existing Patterns

**Retry with exponential backoff** — `src/model/retry.ts` provides `callWithRetry` with hardcoded 3 retries and exponential backoff (1s, 2s, 4s). The compaction retry loop follows the same backoff pattern but is separate because it needs chunk-size reduction between attempts. `callWithRetry` stays unchanged.

**Graceful degradation in compaction** — `src/compaction/compactor.ts` already catches all errors in the `compress` method and returns original history unchanged (lines 705-718). Layer 2 extends this by retrying before giving up. Layer 3 adds a backstop after giving up.

**Token estimation heuristic** — `estimateTokens(text)` in both `src/agent/context.ts` and `src/compaction/compactor.ts` uses `Math.ceil(text.length / 4)`. This design reuses the same heuristic for overhead estimation. No new estimation approach is introduced.

**Factory functions over classes** — all new functionality follows the existing `createFoo()` pattern. No classes are introduced.

**`CompactionConfig` as the tuning surface** — existing config fields (`chunkSize`, `keepRecent`, `maxSummaryTokens`, etc.) control compaction behaviour. New fields (`timeout`, `maxRetries`) follow the same pattern.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: ModelRequest Timeout Support

**Goal:** Add optional `timeout` field to `ModelRequest` and wire it through all four model adapters.

**Components:**
- `src/model/types.ts` — add `timeout?: number` to `ModelRequest`
- `src/model/openrouter.ts` — pass `{ timeout: request.timeout }` as second arg to `client.chat.completions.create()`
- `src/model/openai-compat.ts` — same pattern as OpenRouter
- `src/model/anthropic.ts` — pass `{ timeout: request.timeout }` to `client.messages.create()`
- `src/model/ollama.ts` — implement via `AbortController` + `setTimeout` on the raw `fetch()` call

**Dependencies:** None (first phase)

**Done when:** Each adapter respects `timeout` when provided and uses SDK defaults when omitted. Tests verify timeout is passed through and that omitting it doesn't change existing behaviour.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Overhead-Aware Budget Check

**Goal:** Make `shouldCompress` account for system prompt, tool definitions, and output token reservation.

**Components:**
- `src/agent/context.ts` — modify `shouldCompress` to accept `overheadTokens` parameter and subtract it from the budget before comparing against message tokens
- `src/agent/agent.ts` — compute overhead (system prompt + tools + max_tokens) before calling `shouldCompress`

**Dependencies:** None (independent of Phase 1)

**Done when:** `shouldCompress` triggers compaction earlier when overhead is high. Tests verify that overhead is subtracted from the budget and that the function behaves correctly at boundary values.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Compaction Retry with Chunk Reduction

**Goal:** Make compaction summarisation resilient to timeouts with retries and progressively smaller chunks.

**Components:**
- `src/compaction/types.ts` — add `timeout?: number` and `maxRetries?: number` to `CompactionConfig`
- `src/compaction/compactor.ts` — add retry loop around `summarizeChunk` with exponential backoff and chunk-size halving on retry. Pass `CompactionConfig.timeout` through to `ModelRequest.timeout` on summarisation calls.
- `src/config/schema.ts` — add `compaction_timeout` and `compaction_max_retries` to the config schema with defaults (120000ms and 2 respectively)

**Dependencies:** Phase 1 (needs `ModelRequest.timeout` support)

**Done when:** Compaction retries on timeout with halved chunk sizes and exponential backoff. Non-retryable errors (auth, 400) fail immediately. Tests verify retry count, chunk reduction, and backoff timing.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Pre-flight Guard with Hard Truncation

**Goal:** Add a last-resort guard that prevents oversized requests by truncating oldest messages.

**Components:**
- `src/agent/context.ts` — new pure function `truncateOldest(history, modelMaxTokens, overheadTokens)` that drops oldest non-system messages until estimated total fits. Preserves leading system messages (clip-archive) and the most recent user message.
- `src/agent/agent.ts` — insert pre-flight check between compaction and the tool loop. Estimate total request size, call `truncateOldest` if it exceeds `modelMaxTokens`, log a warning when the guard fires.

**Dependencies:** Phase 2 (uses the same overhead calculation approach)

**Done when:** Agent never calls `model.complete()` with an estimated token count exceeding `modelMaxTokens`. Tests verify truncation preserves system messages and latest user message, drops oldest messages first, and logs a warning.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Wiring and Config

**Goal:** Wire new config fields through the composition root and validate end-to-end.

**Components:**
- `src/config/schema.ts` — ensure new compaction config fields have defaults and validation
- `src/index.ts` — pass new config values when constructing the compactor
- `config.toml.example` — document new config fields with comments

**Dependencies:** Phases 1-4

**Done when:** New config fields are parsed, validated, and flow through to the compactor. Existing tests still pass. Example config documents the new options.
<!-- END_PHASE_5 -->

## Additional Considerations

**Token estimation accuracy.** The `length / 4` heuristic is rough. Tool definitions serialised as JSON may have a different token density than natural language. The pre-flight guard (Layer 3) exists precisely because estimation can be wrong — it's the backstop for estimation errors, not a replacement for better estimation.

**Truncation visibility.** When the pre-flight guard fires, it means Layers 1 and 2 failed to keep context within budget. The warning log should be noticeable so the operator can investigate. Consider whether the agent should also mention the truncation in its response so the user knows context was lost.

**Chunk-size floor.** When halving chunk size on retry, there should be a minimum (e.g., 2 messages per chunk). A chunk of 1 message produces poor summaries and the overhead of the summarisation prompt dominates.
