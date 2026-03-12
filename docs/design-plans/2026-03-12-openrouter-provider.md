# OpenRouter Model Provider Design

## Summary

Constellation routes all LLM calls through a `ModelProvider` interface with pluggable adapters per provider (Anthropic, Ollama, OpenAI-compatible). The OpenAI-compatible adapter currently works with OpenRouter, but it goes in blind: the OpenAI SDK doesn't expose HTTP response headers, so cost data and server-side rate limit signals are silently dropped.

This design adds a dedicated `openrouter` adapter that wraps the OpenAI SDK with a custom `fetch` interceptor to capture those headers before they disappear. Cost per request is extracted from `X-OpenRouter-Cost` and logged after every call. Rate limit state from `X-RateLimit-*` headers is fed back into the existing client-side token bucket limiter via a new `syncFromServer()` method, overwriting the client's estimates with authoritative server values. The adapter also handles an OpenRouter-specific streaming failure mode — SSE chunks carrying `finish_reason: "error"` instead of normal completion — and throws a retryable `ModelError` so the existing retry wrapper can recover transparently. Normalization helpers shared between the new adapter and the existing OpenAI-compatible one are extracted into a `openai-shared.ts` module to avoid duplication.

## Definition of Done

A first-class `openrouter` model provider that implements the `ModelProvider` interface (complete + stream), with a dedicated config schema (`provider: "openrouter"` + nested `[model.openrouter]` section), per-request cost logging via the `X-OpenRouter-Cost` response header (structured, info level), rate limit header integration (`X-RateLimit-*`) feeding the existing client-side rate limiter, mid-stream error detection for SSE chunks with `finish_reason: "error"`, configurable app attribution headers (referer, title), and pass-through model IDs. The provider enables proper cost visibility and rate limit awareness that the generic `openai-compat` path cannot provide.

**Out of scope:** Generation stats endpoint polling, full provider routing config (order/only/ignore), OAuth PKCE flow, model ID format validation.

## Acceptance Criteria

### openrouter-provider.AC1: Config schema accepts OpenRouter provider
- **openrouter-provider.AC1.1 Success:** Config with `provider = "openrouter"` and `name = "anthropic/claude-sonnet-4"` parses successfully
- **openrouter-provider.AC1.2 Success:** Nested `[model.openrouter]` with sort/allow_fallbacks/referer/title parses successfully
- **openrouter-provider.AC1.3 Success:** `OPENROUTER_API_KEY` env var overrides config `api_key` when provider is `"openrouter"`
- **openrouter-provider.AC1.4 Failure:** Config with `sort = "invalid"` is rejected by schema validation

### openrouter-provider.AC2: Adapter implements ModelProvider
- **openrouter-provider.AC2.1 Success:** `complete()` returns normalized `ModelResponse` with correct content blocks, stop reason, and usage stats
- **openrouter-provider.AC2.2 Success:** `complete()` normalizes tool use responses (tool call ID, name, arguments)
- **openrouter-provider.AC2.3 Success:** `complete()` extracts `reasoning_content` when present
- **openrouter-provider.AC2.4 Success:** `stream()` emits correct `StreamEvent` sequence (message_start → content_block_start → deltas → message_stop)
- **openrouter-provider.AC2.5 Success:** `stream()` assembles tool calls across multiple chunks

### openrouter-provider.AC3: Cost logging
- **openrouter-provider.AC3.1 Success:** After `complete()`, cost is logged at info level as `[openrouter] cost=$X model=Y tokens=I/O`
- **openrouter-provider.AC3.2 Success:** After `stream()` completes, cost from initial response headers is logged in the same format

### openrouter-provider.AC4: Rate limit header integration
- **openrouter-provider.AC4.1 Success:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers are parsed and passed to `syncFromServer`
- **openrouter-provider.AC4.2 Success:** `syncFromServer` overwrites RPM bucket tokens with `remaining` and capacity with `limit`
- **openrouter-provider.AC4.3 Success:** `syncFromServer` recalculates refill rate from `resetAt`
- **openrouter-provider.AC4.4 Edge:** `syncFromServer` is a no-op when limit and remaining are both 0

### openrouter-provider.AC5: Attribution headers
- **openrouter-provider.AC5.1 Success:** When `referer` is configured, `HTTP-Referer` header is sent with requests
- **openrouter-provider.AC5.2 Success:** When `title` is configured, `X-Title` header is sent with requests

### openrouter-provider.AC6: Provider routing
- **openrouter-provider.AC6.1 Success:** When `sort` is configured, `provider.sort` is included in request body
- **openrouter-provider.AC6.2 Success:** When `allow_fallbacks` is configured, `provider.allow_fallbacks` is included in request body

### openrouter-provider.AC7: Mid-stream error handling
- **openrouter-provider.AC7.1 Success:** SSE chunk with `finish_reason: "error"` throws `ModelError("api_error", true)`
- **openrouter-provider.AC7.2 Success:** Retry wrapper catches mid-stream error and retries the full request
- **openrouter-provider.AC7.3 Edge:** SSE keepalive comments (`: OPENROUTER PROCESSING`) are ignored without error

### openrouter-provider.AC8: Factory and composition wiring
- **openrouter-provider.AC8.1 Success:** `createModelProvider({ provider: "openrouter", ... })` returns a working `ModelProvider`
- **openrouter-provider.AC8.2 Success:** Composition root passes `syncFromServer` when rate limiting is active for an openrouter provider
- **openrouter-provider.AC8.3 Success:** Composition root passes `undefined` for `onServerRateLimit` when rate limiting is not configured

## Glossary

- **`ModelProvider`**: The internal port interface all LLM adapters implement. Defines `complete()` for single-turn completions and `stream()` for streaming responses. Adapters normalise provider-native wire formats into canonical `ModelResponse` / `StreamEvent` types.
- **OpenRouter**: An API aggregation service that proxies requests to multiple LLM providers (Anthropic, OpenAI, Mistral, etc.) under a single OpenAI-compatible endpoint. It adds its own HTTP response headers for cost and rate limit data.
- **`openai-compat` adapter**: The existing adapter that speaks the OpenAI API wire format. Currently used for OpenRouter among other providers, but cannot access HTTP response headers.
- **OpenAI SDK**: The official `openai` Node/Bun library. Accepts a custom `fetch` function at construction time, which is the mechanism used to intercept response headers the SDK otherwise discards.
- **Custom fetch wrapper**: A `fetch`-compatible function passed to the OpenAI SDK constructor. Intercepts HTTP responses before the SDK processes them, allowing header extraction without modifying the response body.
- **`X-OpenRouter-Cost`**: HTTP response header set by OpenRouter containing the USD cost of the completed request as a floating-point string.
- **`X-RateLimit-*` headers**: HTTP response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) carrying OpenRouter's current RPM quota state for the authenticated key.
- **Token bucket rate limiter**: The client-side rate limiting implementation in `src/rate-limit/`. Maintains a bucket of available tokens that refills at a fixed rate. Existing adapters drive it from `response.usage`; the OpenRouter adapter adds server-driven correction via `syncFromServer()`.
- **`syncFromServer()`**: New method on the rate-limited provider wrapper. Accepts `{ limit, remaining, resetAt }` parsed from response headers and overwrites the RPM bucket's current state, correcting any drift between client estimates and server reality.
- **RPM bucket**: The requests-per-minute token bucket within the rate limiter. Distinct from input/output token budgets, which track LLM context consumption.
- **SSE (Server-Sent Events)**: The streaming transport used by OpenAI-format APIs. The server sends a series of `data: {...}` lines over a persistent HTTP connection. OpenRouter can inject keepalive comments (`: OPENROUTER PROCESSING`) and can signal failures mid-stream via `finish_reason: "error"`.
- **`finish_reason: "error"`**: An OpenRouter-specific SSE chunk value indicating an upstream provider failure during generation. Not part of the standard OpenAI spec.
- **`ModelError`**: Internal error type that wraps LLM provider failures with a code (e.g., `"api_error"`, `"rate_limit"`) and a `retryable` boolean consumed by the `callWithRetry` wrapper.
- **Provider routing**: OpenRouter-specific request body fields (`provider.sort`, `provider.allow_fallbacks`) that hint at which upstream providers OpenRouter should prefer or permit.
- **Attribution headers**: `HTTP-Referer` and `X-Title` request headers that OpenRouter uses for usage attribution in its dashboard.
- **`openai-shared.ts`**: New module extracted from `openai-compat.ts` containing message normalisation, tool definition normalisation, content block normalisation, stop reason mapping, and usage stats normalisation.
- **Composition root**: `src/index.ts` — where all adapters, providers, and services are wired together. The only place that knows about concrete implementations.
- **Zod schema**: Runtime validation library used throughout the config layer. Defines the shape and constraints of TOML config fields and rejects invalid values at startup.

## Architecture

Standalone OpenRouter adapter implementing `ModelProvider`, using the OpenAI SDK with a custom `fetch` wrapper to intercept response headers that the SDK doesn't expose. The adapter shares message/tool normalization helpers with the existing `openai-compat` adapter via an extracted `openai-shared.ts` module.

### Components

**OpenRouter Adapter** (`src/model/openrouter.ts`): Implements `complete()` and `stream()`. Creates an OpenAI SDK client pointed at `https://openrouter.ai/api/v1` with a custom fetch that captures `X-OpenRouter-Cost` and `X-RateLimit-*` headers from every response. Augments requests with OpenRouter-specific fields (provider routing, attribution headers). Detects mid-stream errors (`finish_reason: "error"`) during streaming.

**Shared Helpers** (`src/model/openai-shared.ts`): Extracted from `openai-compat.ts` — message normalization, tool definition normalization, content block normalization, stop reason mapping, usage stats normalization. Both `openai-compat.ts` and `openrouter.ts` import from here.

**Config Extension** (`src/config/schema.ts`, `src/config/config.ts`): Adds `"openrouter"` to provider enum. Adds optional nested `openrouter` object to `ModelConfigSchema` for sort strategy, allow_fallbacks, referer, and title. Adds `OPENROUTER_API_KEY` env override.

**Rate Limiter Extension** (`src/rate-limit/provider.ts`): Adds `syncFromServer()` method to the rate-limited provider. Accepts `{ limit, remaining, resetAt }` from OpenRouter's response headers and overwrites the RPM bucket state. Input/output token buckets remain driven by `response.usage` as today.

**Factory** (`src/model/factory.ts`): Adds `case "openrouter"` dispatching to `createOpenRouterAdapter`.

**Composition Root** (`src/index.ts`): When provider is `"openrouter"` and rate limiting is active, passes `rateLimitedModel.syncFromServer` to the adapter factory. Otherwise passes `undefined`.

### Contracts

```typescript
// OpenRouter-specific config (nested under ModelConfig)
type OpenRouterOptions = {
  sort?: "price" | "throughput" | "latency";
  allow_fallbacks?: boolean;
  referer?: string;
  title?: string;
};

// Extended ModelConfig when provider is "openrouter"
type OpenRouterModelConfig = ModelConfig & {
  openrouter?: OpenRouterOptions;
};

// Callback for syncing server rate limits into client-side limiter
type ServerRateLimitSync = (status: {
  limit: number;
  remaining: number;
  resetAt: number; // unix timestamp ms
}) => void;

// Factory signature
function createOpenRouterAdapter(
  config: OpenRouterModelConfig,
  onServerRateLimit?: ServerRateLimitSync,
): ModelProvider;

// Rate limiter extension
type RateLimitedProvider = ModelProvider & {
  getStatus(): RateLimitStatus;
  syncFromServer: ServerRateLimitSync;
};
```

### Data Flow

1. **Request path**: Agent loop calls `model.complete()` or `model.stream()` → adapter builds OpenAI-format request, injects `provider` object (sort/fallbacks) and attribution headers → custom fetch sends request to `openrouter.ai/api/v1`

2. **Response path (complete)**: Custom fetch intercepts response → extracts cost and rate limit headers → logs cost → calls `onServerRateLimit` if provided → returns response to OpenAI SDK → SDK parses body → adapter normalizes to `ModelResponse`

3. **Response path (stream)**: Custom fetch intercepts initial response headers (cost + rate limits logged/synced) → SDK processes SSE stream → adapter emits `StreamEvent`s → on each chunk, checks for `finish_reason: "error"` → if error detected, throws `ModelError("api_error", true)`

### Header Interception

The OpenAI SDK accepts a custom `fetch` function in its constructor. The adapter wraps the global `fetch`:

```typescript
// Contract only — shows the boundary, not the implementation
const customFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  // Extract headers from response (non-destructive read)
  // Log cost, sync rate limits
  return response; // SDK receives unmodified response
};

const client = new OpenAI({
  apiKey: config.api_key,
  baseURL: "https://openrouter.ai/api/v1",
  fetch: customFetch,
});
```

## Existing Patterns

This design follows established patterns from the existing model provider architecture:

- **Factory function pattern**: `createOpenRouterAdapter()` returns `ModelProvider`, same as `createAnthropicAdapter()`, `createOpenAICompatAdapter()`, `createOllamaAdapter()`
- **Error classification**: Maps errors to `ModelError(code, retryable)` with `isRetryableError` predicate passed to `callWithRetry()`
- **Normalization**: Converts provider-native format to canonical `ContentBlock[]` / `StreamEvent` types
- **Provider-aware env overrides**: `OPENROUTER_API_KEY` applied only when `provider === "openrouter"`, matching existing `ANTHROPIC_API_KEY` / `OPENAI_COMPAT_API_KEY` pattern
- **Rate limiter composition**: Wrapped at composition root via `createRateLimitedProvider()`, same as existing providers

**Divergence from existing patterns:**

- **Shared helpers extraction**: Moving normalization functions from `openai-compat.ts` into `openai-shared.ts` is new. Justified because OpenRouter and OpenAI-compat share the same wire format — duplicating these functions would violate DRY. The extraction is purely mechanical (move + re-export), no behaviour change.
- **`syncFromServer` on rate limiter**: The rate limiter currently only corrects post-response. Adding server-driven sync is additive and backward-compatible (existing providers don't call it). Justified because OpenRouter provides authoritative rate limit state that's more accurate than client-side estimation.
- **Custom fetch**: No existing adapter intercepts HTTP headers. Justified because the OpenAI SDK doesn't expose response headers, and cost/rate-limit data lives exclusively in headers.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Extract Shared Helpers
**Goal:** Extract OpenAI-format normalization helpers into a shared module without changing any behaviour.

**Components:**
- `src/model/openai-shared.ts` — new module containing extracted helpers: `normalizeMessages()`, `normalizeToolDefinitions()`, `normalizeContentBlocks()`, `normalizeStopReason()`, `normalizeUsage()`
- `src/model/openai-compat.ts` — modified to import from `openai-shared.ts` instead of defining locally
- `src/model/index.ts` — updated barrel export if needed

**Dependencies:** None (first phase)

**Done when:** All existing tests pass unchanged. `openai-compat` behaviour is identical. `openai-shared.ts` exports all normalization helpers. `bun run build` succeeds.

**Covers:** No acceptance criteria (mechanical refactor, verified operationally).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Config Schema Extension
**Goal:** Accept `"openrouter"` as a provider with nested OpenRouter-specific configuration.

**Components:**
- `src/config/schema.ts` — add `"openrouter"` to provider enum, add optional `openrouter` nested Zod object (sort, allow_fallbacks, referer, title)
- `src/config/config.ts` — add `OPENROUTER_API_KEY` env override when `provider === "openrouter"`

**Dependencies:** None (independent of Phase 1)

**Done when:** Config with `provider = "openrouter"` and `[model.openrouter]` section parses and validates. Invalid sort values are rejected. `OPENROUTER_API_KEY` env var overrides config. Tests pass for valid configs, invalid configs, and env overrides.

**Covers:** `openrouter-provider.AC1.1`, `openrouter-provider.AC1.2`, `openrouter-provider.AC1.3`, `openrouter-provider.AC1.4`
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Rate Limiter Extension
**Goal:** Add `syncFromServer()` to the rate-limited provider so it can accept external rate limit signals.

**Components:**
- `src/rate-limit/provider.ts` — add `syncFromServer()` method that overwrites RPM bucket state from `{ limit, remaining, resetAt }`
- `src/rate-limit/types.ts` — export `ServerRateLimitSync` type if needed

**Dependencies:** None (independent of Phases 1-2)

**Done when:** `syncFromServer()` overwrites RPM bucket tokens and capacity. Refill rate recalculated from resetAt. Mutex acquired during sync. No-op when remaining and limit are both 0. Existing rate limiter behaviour unchanged for providers that don't call sync. Tests cover sync, no-op, and non-interference.

**Covers:** `openrouter-provider.AC4.1`, `openrouter-provider.AC4.2`, `openrouter-provider.AC4.3`, `openrouter-provider.AC4.4`
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: OpenRouter Adapter — Complete
**Goal:** Implement `complete()` with custom fetch header interception, cost logging, and rate limit sync.

**Components:**
- `src/model/openrouter.ts` — new adapter with `createOpenRouterAdapter()` factory, custom fetch wrapper, `complete()` method
- Uses shared helpers from `openai-shared.ts`

**Dependencies:** Phase 1 (shared helpers), Phase 3 (syncFromServer callback type)

**Done when:** `complete()` returns normalized `ModelResponse`. Cost logged at info level in `[openrouter] cost=$X model=Y tokens=I/O` format. Rate limit headers extracted and synced via callback. Attribution headers (referer, title) sent when configured. Provider routing params (sort, allow_fallbacks) included in request body. Error classification matches existing pattern (auth, rate_limit, api_error). Tests cover happy path, cost logging, rate limit sync, attribution, routing, and error cases.

**Covers:** `openrouter-provider.AC2.1`, `openrouter-provider.AC2.2`, `openrouter-provider.AC2.3`, `openrouter-provider.AC3.1`, `openrouter-provider.AC3.2`, `openrouter-provider.AC5.1`, `openrouter-provider.AC5.2`, `openrouter-provider.AC6.1`, `openrouter-provider.AC6.2`
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: OpenRouter Adapter — Stream
**Goal:** Implement `stream()` with mid-stream error detection, cost logging, and rate limit sync.

**Components:**
- `src/model/openrouter.ts` — add `stream()` method with mid-stream error detection

**Dependencies:** Phase 4 (adapter scaffold, custom fetch)

**Done when:** `stream()` emits correct `StreamEvent` sequence. Mid-stream `finish_reason: "error"` detected and thrown as `ModelError("api_error", true)`. Cost and rate limits captured from initial response headers. SSE keepalive comments handled gracefully. Tests cover normal stream, mid-stream error, and tool call streaming.

**Covers:** `openrouter-provider.AC2.4`, `openrouter-provider.AC2.5`, `openrouter-provider.AC7.1`, `openrouter-provider.AC7.2`, `openrouter-provider.AC7.3`
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Factory & Composition Root Wiring
**Goal:** Wire the OpenRouter adapter into the provider factory and composition root.

**Components:**
- `src/model/factory.ts` — add `case "openrouter"` dispatching to `createOpenRouterAdapter`
- `src/model/index.ts` — export OpenRouter adapter
- `src/index.ts` — when provider is `"openrouter"` + rate limiting active, pass `syncFromServer` to adapter; otherwise pass `undefined`

**Dependencies:** Phase 2 (config), Phase 4 (adapter)

**Done when:** `createModelProvider({ provider: "openrouter", ... })` returns working adapter. Composition root passes `syncFromServer` when rate limiting active. Summarization model also supports `"openrouter"`. `bun run build` succeeds. End-to-end smoke test with mocked OpenRouter responses passes.

**Covers:** `openrouter-provider.AC8.1`, `openrouter-provider.AC8.2`, `openrouter-provider.AC8.3`
<!-- END_PHASE_6 -->

## Additional Considerations

**Mid-stream error retryability:** Mid-stream errors from OpenRouter typically indicate upstream provider failure (timeout, provider went down). Classifying them as retryable (`ModelError("api_error", true)`) means the retry wrapper will attempt the full request again. This is appropriate because the partial response is unusable anyway.

**Cost header availability during streaming:** OpenRouter sends the `X-OpenRouter-Cost` header with the initial HTTP response before any SSE chunks. For streaming, this means cost is captured when the custom fetch sees the response, not after the stream completes. The logged cost reflects OpenRouter's estimate at request acceptance time.

**Rate limiter sync granularity:** `syncFromServer` only overwrites the RPM bucket because OpenRouter's `X-RateLimit-*` headers track request count, not token count. Input/output token budgets continue to be managed by the existing post-response correction via `response.usage`.
