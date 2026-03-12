# Test Requirements

## Automated Tests

### AC1: Config schema accepts OpenRouter provider

**AC1.1** -- Config with `provider = "openrouter"` and `name = "anthropic/claude-sonnet-4"` parses successfully
- Type: Unit
- File: `src/config/schema.test.ts`
- Verifies: `ModelConfigSchema.parse()` succeeds with `provider: "openrouter"` and a model name string. Assert parsed output matches input.

**AC1.2** -- Nested `[model.openrouter]` with sort/allow_fallbacks/referer/title parses successfully
- Type: Unit
- File: `src/config/schema.test.ts`
- Verifies: `ModelConfigSchema.parse()` succeeds when `openrouter` nested object includes all four optional fields (`sort: "price"`, `allow_fallbacks: false`, `referer: "https://example.com"`, `title: "My App"`). Assert all fields present in parsed output.

**AC1.3** -- `OPENROUTER_API_KEY` env var overrides config `api_key` when provider is `"openrouter"`
- Type: Unit
- File: `src/config/schema.test.ts`
- Verifies: With `OPENROUTER_API_KEY` set in `process.env`, the config loading path resolves the env var for `"openrouter"` provider. Test the `providerEnvKeys` mapping or call `loadConfig` with a temp TOML file and assert `api_key` matches the env value.

**AC1.4** -- Config with `sort = "invalid"` is rejected by schema validation
- Type: Unit
- File: `src/config/schema.test.ts`
- Verifies: `ModelConfigSchema.parse()` throws `ZodError` when `openrouter.sort` is not one of `"price" | "throughput" | "latency"`.

---

### AC2: Adapter implements ModelProvider

**AC2.1** -- `complete()` returns normalized `ModelResponse` with correct content blocks, stop reason, and usage stats
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Against a local `Bun.serve()` mock returning a text completion response, `complete()` returns `ModelResponse` with a `TextBlock` in `content`, correct `stop_reason` (mapped from `finish_reason`), and `usage` with `input_tokens`/`output_tokens`.

**AC2.2** -- `complete()` normalizes tool use responses (tool call ID, name, arguments)
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Against a mock response containing `tool_calls`, `complete()` returns `ModelResponse` with `ToolUseBlock`(s) having correct `id`, `name`, and parsed `input` (JSON arguments).

**AC2.3** -- `complete()` extracts `reasoning_content` when present
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Against a mock response with `reasoning_content` on the choice message, `complete()` returns `ModelResponse` with `reasoning_content` populated.

**AC2.4** -- `stream()` emits correct `StreamEvent` sequence
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Against a mock SSE streaming response, collect all emitted `StreamEvent`s and assert the sequence includes `message_start`, `content_block_start`, `content_block_delta`(s), and `message_stop` in order.

**AC2.5** -- `stream()` assembles tool calls across multiple chunks
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Against a mock SSE response with tool call chunks split across multiple events (partial function name, partial arguments), assert the adapter emits `content_block_start` with tool use type/id and `content_block_delta` events with `input_json_delta`.

---

### AC3: Cost logging

**AC3.1** -- After `complete()`, cost is logged at info level as `[openrouter] cost=$X model=Y tokens=I/O`
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Mock response includes `x-openrouter-cost` header. Spy on `console.info`, call `complete()`, assert the spy was called with a string matching the format `[openrouter] cost=$<value> model=<name> tokens=<in>/<out>`.

**AC3.2** -- After `stream()` completes, cost from initial response headers is logged
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Mock streaming response includes `x-openrouter-cost` header on the initial HTTP response. Spy on `console.info`, consume the stream, assert the spy was called with the cost log format. Token counts in the log will be `0/0` since usage isn't known until stream completion.

---

### AC4: Rate limit header integration

**AC4.1** -- `X-RateLimit-*` headers are parsed and passed to `syncFromServer`
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Mock response includes `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` headers. Provide a spy as `onServerRateLimit`, call `complete()`, assert the spy was called with `{ limit, remaining, resetAt }` matching the header values.

**AC4.2** -- `syncFromServer` overwrites RPM bucket tokens with `remaining` and capacity with `limit`
- Type: Unit
- File: `src/rate-limit/provider.test.ts`
- Verifies: Call `syncFromServer({ limit: 50, remaining: 30, resetAt: <future> })`, then `getStatus()`. Assert `rpm.capacity === 50` and `rpm.remaining` is approximately 30.

**AC4.3** -- `syncFromServer` recalculates refill rate from `resetAt`
- Type: Unit
- File: `src/rate-limit/provider.test.ts`
- Verifies: Call `syncFromServer` with `resetAt` 30 seconds in the future. Assert `rpm.refillRate` is approximately `limit / 30000`.

**AC4.4** -- `syncFromServer` is a no-op when limit and remaining are both 0
- Type: Unit
- File: `src/rate-limit/provider.test.ts`
- Verifies: Record `getStatus().rpm` before call, call `syncFromServer({ limit: 0, remaining: 0, resetAt: Date.now() })`, assert `getStatus().rpm` is unchanged.

---

### AC5: Attribution headers

**AC5.1** -- When `referer` is configured, `HTTP-Referer` header is sent with requests
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Configure adapter with `openrouter.referer = "https://example.com"`. Call `complete()` against mock server. Capture incoming request headers on the mock, assert `HTTP-Referer` equals the configured value.

**AC5.2** -- When `title` is configured, `X-Title` header is sent with requests
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Configure adapter with `openrouter.title = "My App"`. Call `complete()` against mock server. Capture incoming request headers on the mock, assert `X-Title` equals the configured value.

---

### AC6: Provider routing

**AC6.1** -- When `sort` is configured, `provider.sort` is included in request body
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Configure adapter with `openrouter.sort = "price"`. Call `complete()` against mock server. Capture incoming request body on the mock, assert `body.provider.sort === "price"`.

**AC6.2** -- When `allow_fallbacks` is configured, `provider.allow_fallbacks` is included in request body
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Configure adapter with `openrouter.allow_fallbacks = false`. Call `complete()` against mock server. Capture incoming request body on the mock, assert `body.provider.allow_fallbacks === false`.

---

### AC7: Mid-stream error handling

**AC7.1** -- SSE chunk with `finish_reason: "error"` throws `ModelError("api_error", true)`
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Mock SSE stream emits a chunk with `finish_reason: "error"`. Call `stream()` and consume the async iterable. Assert it throws `ModelError` with `code === "api_error"` and `retryable === true`.

**AC7.2** -- Retry wrapper catches mid-stream error and retries the full request
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: The thrown `ModelError` from AC7.1 has `retryable: true`. This confirms the retry wrapper's predicate will match.

**AC7.3** -- SSE keepalive comments (`: OPENROUTER PROCESSING`) are ignored without error
- Type: Unit
- File: `src/model/openrouter.test.ts`
- Verifies: Mock SSE stream includes keepalive comment lines interleaved with valid data chunks. `stream()` completes successfully without errors and emits the expected `StreamEvent` sequence.

---

### AC8: Factory and composition wiring

**AC8.1** -- `createModelProvider({ provider: "openrouter", ... })` returns a working `ModelProvider`
- Type: Unit
- File: `src/model/factory.test.ts`
- Verifies: Call `createModelProvider` with `provider: "openrouter"` and a model name. Assert the returned object is non-null with `complete` and `stream` methods.

**AC8.2** -- Composition root passes `syncFromServer` when rate limiting is active for an openrouter provider
- Type: Unit
- File: `src/model/factory.test.ts`
- Verifies: Call `createOpenRouterAdapter(config, callbackFn)` and confirm it accepts the callback without error. Assert the returned adapter has `complete` and `stream` methods.

**AC8.3** -- Composition root passes `undefined` for `onServerRateLimit` when rate limiting is not configured
- Type: Unit
- File: `src/model/factory.test.ts`
- Verifies: Call `createOpenRouterAdapter(config)` without a second argument. Assert it returns a working adapter without throwing.

---

## Human Verification

### AC8.2 -- Composition root wiring (full integration)
- **Why it can't be fully automated:** The composition root (`src/index.ts`) orchestrates real services (database, config file, environment). Verifying the mutable callback holder pattern correctly connects `syncFromServer` from the rate-limited wrapper to the adapter requires the full daemon.
- **Verification approach:**
  1. Configure `config.toml` with `provider = "openrouter"` and rate limiting enabled
  2. Set `OPENROUTER_API_KEY` env var
  3. Run `bun run start`
  4. Send a message that triggers a model call
  5. Confirm cost log line appears: `[openrouter] cost=$X model=Y tokens=I/O`
  6. Confirm no errors related to rate limit sync in output

### AC3.1 / AC3.2 -- Cost log format (visual confirmation)
- **Why it can't be fully automated:** The automated tests verify the log was emitted with the correct format string. Confirming the log is at "info level" and renders correctly in production logging output requires visual inspection.
- **Verification approach:**
  1. Run the daemon with an OpenRouter provider configured
  2. Trigger a `complete()` call and a `stream()` call
  3. Confirm both produce `[openrouter] cost=$X model=Y tokens=I/O` in stdout at info level

### AC7.3 -- Keepalive handling under real conditions
- **Why it can't be fully automated:** The SSE keepalive behaviour depends on OpenRouter's server sending `: OPENROUTER PROCESSING` comments during slow upstream responses. Reproducing this reliably in a mock is possible (and covered above) but confirming it works against the real API requires a slow model response.
- **Verification approach:**
  1. Configure a model known to have slower responses via OpenRouter
  2. Use `stream()` and observe that the stream completes without errors even when OpenRouter injects keepalive comments

### Phase 1 -- Shared helpers extraction (no ACs)
- **Why it can't be automated as AC-specific tests:** This phase has no acceptance criteria; it's a mechanical refactor verified by existing tests passing unchanged.
- **Verification approach:**
  1. Run `bun run build` -- type-check succeeds
  2. Run `bun test src/model/` -- all existing model tests pass with no changes
  3. Confirm `openai-compat.ts` imports from `openai-shared.ts` and no normalization functions are duplicated
