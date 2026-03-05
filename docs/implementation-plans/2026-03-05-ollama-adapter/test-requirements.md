# Ollama Model Provider Adapter -- Test Requirements

Generated from implementation plans: phases 1-5

---

## AC-to-Test Summary

| AC ID | Description | Test Type | Test File | Phase |
|-------|-------------|-----------|-----------|-------|
| ollama-adapter.AC1.1 | `provider = "ollama"` validates in `[model]` config section | Unit | `src/config/schema.test.ts` | 1 |
| ollama-adapter.AC1.2 | `provider = "ollama"` validates in `[summarization]` config section | Unit | `src/config/schema.test.ts` | 1 |
| ollama-adapter.AC1.3 | `base_url` defaults to `http://localhost:11434` when omitted | Unit | `src/config/schema.test.ts` + `src/model/ollama.test.ts` | 1, 3 |
| ollama-adapter.AC1.4 | Config with `api_key` omitted validates (no auth required) | Unit | `src/config/schema.test.ts` | 1 |
| ollama-adapter.AC2.1 | `complete()` returns `ModelResponse` with non-empty `content` array | Integration | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC2.2 | `stream()` yields `StreamEvent` sequence: `MessageStart` -> content events -> `MessageStop` | Unit | `src/model/ollama.test.ts` | 4 |
| ollama-adapter.AC2.3 | `stream()` handles NDJSON lines correctly (parses valid JSON, skips empty lines) | Unit | `src/model/ollama.test.ts` | 4 |
| ollama-adapter.AC2.4 | Malformed NDJSON line during streaming throws error | Unit | `src/model/ollama.test.ts` | 4 |
| ollama-adapter.AC3.1 | `ToolDefinition` translates to Ollama `{ type: "function", function: { name, description, parameters } }` | Unit | `src/model/ollama.test.ts` | 2 |
| ollama-adapter.AC3.2 | Ollama `tool_calls` response maps to `ToolUseBlock` array with generated UUIDs | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC3.3 | `stop_reason` is `"tool_use"` when response contains `tool_calls` | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC3.4 | `ToolResultBlock` maps to Ollama `role: "tool"` message | Unit | `src/model/ollama.test.ts` | 2 |
| ollama-adapter.AC3.5 | Multiple parallel tool calls translate to `ToolUseBlock` entries | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC4.1 | Request includes `think: true` parameter | Unit | `src/model/ollama.test.ts` | 2 |
| ollama-adapter.AC4.2 | Ollama `message.thinking` maps to `reasoning_content` on `ModelResponse` | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC4.3 | Thinking chunks emit before content chunks with correct state transition | Unit | `src/model/ollama.test.ts` | 4 |
| ollama-adapter.AC5.1 | HTTP 429 classifies as `ModelError("rate_limit", retryable: true)` | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC5.2 | HTTP 500/502 classifies as `ModelError("api_error", retryable: true)` | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC5.3 | HTTP 400/404 classifies as `ModelError("api_error", retryable: false)` | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC5.4 | Network errors (ECONNREFUSED, fetch failure) classify as retryable | Unit | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC5.5 | Retryable errors are retried via `callWithRetry` with adapter-specific predicate | Structural | `src/model/ollama.test.ts` | 3 |
| ollama-adapter.AC6.1 | `createRateLimitedProvider` wraps Ollama adapter without modification | Unit | `src/model/ollama.test.ts` | 5 |
| ollama-adapter.AC6.2 | Summarization config with `provider = "ollama"` creates working `ModelProvider` | Unit | `src/model/ollama.test.ts` | 5 |

---

## Detailed Test Descriptions

### ollama-adapter.AC1: Config Validation

**Test file:** `src/config/schema.test.ts`

These tests follow the existing schema test pattern using `AppConfigSchema.parse()` with full config objects.

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| Config with `provider = "ollama"` in `[model]` section parses without error | AC1.1 | Zod enum accepts `"ollama"` as a valid model provider value |
| Config with `provider = "ollama"` in `[summarization]` section parses without error | AC1.2 | Zod enum accepts `"ollama"` as a valid summarization provider value |
| Config with `provider = "ollama"` and no `base_url` parses without error | AC1.3 | `base_url` is `z.string().url().optional()` -- omission is valid at schema level. Runtime default is the adapter's responsibility (see AC1.3 runtime test below) |
| Config with `provider = "ollama"` and no `api_key` parses without error | AC1.4 | `api_key` is `z.string().optional()` -- Ollama requires no authentication |

**AC1.3 runtime default test** (in `src/model/ollama.test.ts`, Phase 3):

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| `createOllamaAdapter` with no `base_url` in config creates adapter (default applied at runtime) | AC1.3 | Adapter applies `http://localhost:11434` when `config.base_url` is undefined. Verified structurally -- `createModelProvider({ provider: "ollama", name: "..." })` returns a valid `ModelProvider` without `base_url`. |

---

### ollama-adapter.AC2: ModelProvider Contract

**Test file:** `src/model/ollama.test.ts`

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| `complete()` returns `ModelResponse` with non-empty `content` array (integration, skipped when Ollama unavailable) | AC2.1 | Full round-trip: HTTP POST to `/api/chat` with `stream: false`, parse response, normalize to `ModelResponse`. Gated on `OLLAMA_ENDPOINT` env var. |
| Text-only streaming produces `message_start` -> `content_block_start(text)` -> `content_block_delta(text_delta)` -> `message_stop` | AC2.2 | `mapChunksToStreamEvents` with synthetic text-only chunks yields correct `StreamEvent` sequence. Pure function test, no I/O. |
| Tool call streaming produces `content_block_start(tool_use)` -> `content_block_delta(input_json_delta)` -> `message_stop(tool_use)` | AC2.2 | `mapChunksToStreamEvents` with tool call chunk yields tool use events and correct stop reason. |
| Valid NDJSON lines parse to correct chunk count | AC2.3 | `parseNDJSON` given multi-line NDJSON stream produces expected number of parsed chunks. |
| Empty lines between valid NDJSON lines are skipped | AC2.3 | `parseNDJSON` given stream with blank lines between JSON lines only yields the JSON lines. |
| Malformed JSON line throws `ModelError` with `code: "api_error"` and `retryable: false` | AC2.4 | `parseNDJSON` given invalid JSON throws a non-retryable `ModelError`. |
| Mid-stream error object (`{ error: "..." }`) throws `ModelError` | AC2.4 | `parseNDJSON` given an Ollama error JSON object throws `ModelError` rather than yielding it. |
| Remaining buffer after stream ends is processed | AC2.3 | `parseNDJSON` given NDJSON without trailing newline still parses the final line. |
| Full `stream()` round-trip yields `message_start` first and `message_stop` last (integration, skipped when Ollama unavailable) | AC2.2 | Full I/O test gated on `OLLAMA_ENDPOINT`. |

---

### ollama-adapter.AC3: Tool Use

**Test file:** `src/model/ollama.test.ts`

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| Single `ToolDefinition` translates to `{ type: "function", function: { name, description, parameters: input_schema } }` | AC3.1 | `normalizeToolDefinitions` maps the Constellation tool schema to Ollama's expected format. |
| Multiple tool definitions all translate correctly | AC3.1 | Array-to-array mapping preserves all entries. |
| Empty tools array results in empty output array | AC3.1 | Edge case: no tools means no translation. |
| Response with single tool call produces `ToolUseBlock` with valid UUID `id`, correct `name`, and correct `input` | AC3.2 | `normalizeResponse` maps `tool_calls[0]` to `ToolUseBlock` with `crypto.randomUUID()`-generated `id`. |
| UUID is a valid v4 UUID format | AC3.2 | Regex match on generated `id` field. |
| Response with `tool_calls` present and `done_reason: "stop"` produces `stop_reason: "tool_use"` | AC3.3 | `normalizeStopReason` checks `tool_calls` presence first, overriding Ollama's unreliable `done_reason`. |
| Response with no tool_calls and `done_reason: "stop"` produces `stop_reason: "end_turn"` | AC3.3 | Fallback when no tool calls and normal stop. |
| Response with no tool_calls and `done_reason: "length"` produces `stop_reason: "max_tokens"` | AC3.3 | Length-based stop maps to `max_tokens`. |
| User message with single `ToolResultBlock` (string content) maps to `role: "tool"` with that content | AC3.4 | `normalizeMessages` converts tool result blocks to Ollama's `role: "tool"` messages. |
| User message with `ToolResultBlock` (array content) maps to `role: "tool"` with `JSON.stringify`'d content | AC3.4 | Non-string tool result content is serialized. |
| Multiple `ToolResultBlock`s in one message produce multiple `role: "tool"` messages | AC3.4 | One Constellation user message with N tool results fans out to N Ollama tool messages. |
| Response with 3 tool calls produces 3 `ToolUseBlock` entries, each with unique UUIDs | AC3.5 | `normalizeResponse` maps all tool calls and generates distinct IDs. |

---

### ollama-adapter.AC4: Thinking/Reasoning

**Test file:** `src/model/ollama.test.ts`

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| `buildOllamaRequest` always sets `think: true` | AC4.1 | Request includes the `think` parameter regardless of input. |
| Response with `message.thinking` populated maps to `reasoning_content` on `ModelResponse` | AC4.2 | `normalizeResponse` extracts the `thinking` field from the Ollama response. |
| Response without `message.thinking` produces `reasoning_content: null` | AC4.2 | Absent thinking field maps to `null`, not `undefined`. |
| Thinking chunks emit `content_block_start(thinking)` -> `content_block_delta(thinking_delta)` before text blocks | AC4.3 | `mapChunksToStreamEvents` emits thinking block at index 0, text block at index 1. |
| Thinking block index is 0, text block index is 1 | AC4.3 | Block index increments correctly on thinking-to-content transition. |

---

### ollama-adapter.AC5: Error Handling and Retry

**Test file:** `src/model/ollama.test.ts`

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| `classifyHttpError(429, ...)` produces `ModelError` with `code: "rate_limit"` and `retryable: true` | AC5.1 | Rate limit responses are classified as retryable. |
| `classifyHttpError(500, ...)` produces `ModelError` with `code: "api_error"` and `retryable: true` | AC5.2 | Server errors are retryable. |
| `classifyHttpError(502, ...)` produces `ModelError` with `code: "api_error"` and `retryable: true` | AC5.2 | Bad gateway errors are retryable. |
| `classifyHttpError(400, ...)` produces `ModelError` with `code: "api_error"` and `retryable: false` | AC5.3 | Client errors are not retryable. |
| `classifyHttpError(404, ...)` produces `ModelError` with `code: "api_error"` and `retryable: false` | AC5.3 | Not found errors are not retryable. |
| `isRetryableOllamaError(new Error("fetch failed"))` returns `true` | AC5.4 | Network fetch failures are retryable. |
| `isRetryableOllamaError(new Error("ECONNREFUSED"))` returns `true` | AC5.4 | Connection refused (Ollama not running) is retryable. |
| `isRetryableOllamaError(new ModelError("api_error", false, ...))` returns `false` | AC5.4 | Non-retryable `ModelError` instances are respected. |
| `complete()` wraps its body in `callWithRetry` with `isRetryableOllamaError` predicate | AC5.5 | Verified structurally: `complete()` implementation calls `callWithRetry(fn, isRetryableOllamaError)`. The retry wrapper itself is tested in `src/model/retry.ts`. No mock-`fetch` test needed -- the retry wrapper's correctness is already covered by its own test suite. |

---

### ollama-adapter.AC6: Composition

**Test file:** `src/model/ollama.test.ts`

| Test Case | ACs Covered | What the Test Verifies |
|-----------|-------------|------------------------|
| `createRateLimitedProvider` wraps Ollama adapter and returns `ModelProvider` with `complete`, `stream`, and `getStatus` methods | AC6.1 | Ollama adapter satisfies the `ModelProvider` interface expected by the rate limiter. No HTTP calls -- structural composition only. |
| `createModelProvider({ provider: "ollama", name: "...", base_url: "..." })` returns a valid `ModelProvider` | AC6.2 | Factory routes `"ollama"` provider to the Ollama adapter. Summarization composition path works. |
| Factory creates adapter without `base_url` (runtime default applied) | AC6.2 | Adapter defaults to `http://localhost:11434` when `base_url` is omitted. |
| Factory creates adapter without `api_key` (no auth required for Ollama) | AC6.2 | No authentication is required for local Ollama instances. |

---

### Additional Tests (not mapped to specific ACs)

These tests verify normalization correctness beyond the AC scope but are needed for implementation confidence.

**Test file:** `src/model/ollama.test.ts`

| Test Case | Rationale | Phase |
|-----------|-----------|-------|
| System string from `ModelRequest` becomes leading system message | `buildOllamaRequest` correctly prepends system message | 2 |
| System role messages in array pass through as `role: "system"` | `normalizeMessages` preserves system role | 2 |
| User string content normalizes to `role: "user"` | Basic string message normalization | 2 |
| Assistant string content normalizes to `role: "assistant"` | Basic string message normalization | 2 |
| Assistant with `ToolUseBlock` produces `tool_calls` with `arguments` as object (not JSON string) | Ollama expects parsed objects, not stringified JSON (differs from OpenAI) | 2 |
| `max_tokens` maps to `options.num_predict` | Request option translation | 2 |
| `temperature` maps to `options.temperature` | Request option translation | 2 |
| Omitted `temperature` results in no `temperature` in options | Optional field handling | 2 |
| `stream` parameter is passed through correctly | `buildOllamaRequest` sets `stream` flag based on caller | 2 |
| Empty response content gets fallback `TextBlock` with empty string | `normalizeResponse` maintains `ModelResponse.content` non-empty invariant | 3 |
| Usage maps `prompt_eval_count` to `input_tokens` and `eval_count` to `output_tokens` | Token usage normalization | 3 |
| Missing usage counts default to 0 | Handles Ollama responses that omit eval counts | 3 |

**Test file:** `src/model/factory.test.ts`

| Test Case | Rationale | Phase |
|-----------|-----------|-------|
| Factory routes `"ollama"` provider and returns adapter with `complete` and `stream` properties | Verifies factory wiring for new provider | 1 |
| Error message for unknown provider includes `'ollama'` in valid providers list | Existing test updated to include new provider | 1 |

---

## Human Verification Items

These ACs cannot be fully automated and require manual or design-level verification.

### ollama-adapter.AC2.1: `complete()` returns `ModelResponse` with non-empty `content` array

**Verification method:** Integration test gated on environment variable.

The automated test for AC2.1 is an integration test that requires a running Ollama instance. It is skipped when `OLLAMA_ENDPOINT` is not set. During CI, this test will not run.

**Manual verification approach:**

1. Start Ollama locally or ensure it is running at the configured endpoint
2. Set `OLLAMA_ENDPOINT` (e.g., `OLLAMA_ENDPOINT=http://192.168.1.6:11434`)
3. Run `OLLAMA_ENDPOINT=http://192.168.1.6:11434 bun test src/model/ollama.test.ts`
4. Confirm the integration test passes and the response contains non-empty content

**Justification:** The `complete()` method performs real HTTP I/O against Ollama's `/api/chat` endpoint. Unit testing the response normalization (pure functions) is covered by AC3.2, AC3.3, AC4.2 etc. The only thing AC2.1 adds is confirmation that the full I/O round-trip works, which requires a live Ollama instance.

### ollama-adapter.AC2.2 (integration): Full `stream()` round-trip

**Verification method:** Integration test gated on environment variable.

Same approach as AC2.1 -- the full streaming round-trip requires a live Ollama instance. The pure `mapChunksToStreamEvents` and `parseNDJSON` logic is fully covered by unit tests. The integration test confirms the HTTP streaming plumbing works end-to-end.

**Manual verification approach:**

1. Same setup as AC2.1
2. Run `OLLAMA_ENDPOINT=http://192.168.1.6:11434 bun test src/model/ollama.test.ts`
3. Confirm streaming integration test passes with `message_start` first and `message_stop` last

**Justification:** Streaming requires a live HTTP connection with chunked transfer encoding. Cannot be meaningfully simulated without mocking `fetch` at the transport level, which would test the mock, not the adapter.

### ollama-adapter.AC5.5: Retryable errors are retried via `callWithRetry`

**Verification method:** Structural verification.

The `complete()` method wraps its body in `callWithRetry(fn, isRetryableOllamaError)`. This is a structural property of the implementation, not a behavioural one that requires exercising the retry loop. The retry wrapper (`callWithRetry`) is independently tested in `src/model/retry.ts`. The error classifier (`isRetryableOllamaError`) is unit-tested in AC5.1-AC5.4.

**Manual verification approach:**

1. Inspect `src/model/ollama.ts` -- confirm `complete()` calls `callWithRetry(async () => { ... }, isRetryableOllamaError)`
2. Inspect `stream()` -- confirm the HTTP fetch portion calls `callWithRetry` with the same predicate
3. Run `bun run build` to confirm type-check passes (wrong predicate signature would fail)

**Justification:** Testing retry integration end-to-end would require either mocking `fetch` (testing the mock) or deliberately crashing Ollama mid-request (fragile and slow). The structural guarantee -- correct function composition -- is sufficient when both the retry wrapper and the error classifier are independently tested.

---

## Notes

### Test strategy overview

Tests are organized in three layers:

1. **Pure function unit tests** (`src/model/ollama.test.ts`) -- The bulk of testing. Covers request normalization (`normalizeToolDefinitions`, `normalizeMessages`, `buildOllamaRequest`), response normalization (`normalizeResponse`, `normalizeStopReason`), error classification (`classifyHttpError`, `isRetryableOllamaError`), NDJSON parsing (`parseNDJSON`), and stream event mapping (`mapChunksToStreamEvents`). These are fast, deterministic, and cover AC3, AC4, AC5.1-5.4, AC2.2-2.4.

2. **Config schema unit tests** (`src/config/schema.test.ts`) -- Zod validation of the `"ollama"` provider enum in both `[model]` and `[summarization]` sections. Covers AC1.

3. **Composition unit tests** (`src/model/ollama.test.ts`) -- Structural tests verifying the Ollama adapter composes with the factory, rate limiter, and summarization paths. No I/O. Covers AC6.

4. **Integration tests** (`src/model/ollama.test.ts`, gated on `OLLAMA_ENDPOINT`) -- Optional round-trip tests against a live Ollama instance. Covers AC2.1 and AC2.2 (full path). Skipped in CI.

### No mock-`fetch` tests

The implementation plan deliberately avoids mocking `fetch` for `complete()` and `stream()` tests. The I/O boundary is at the adapter's public methods, and all internal logic (normalization, error classification, NDJSON parsing, stream event mapping) is extracted into pure exported functions that are tested directly. This follows the Functional Core / Imperative Shell pattern: test the core exhaustively, test the shell via integration.

### Testability seam: `mapChunksToStreamEvents`

Phase 4 extracts stream event mapping into a standalone exported async generator that takes `AsyncIterable<OllamaStreamChunk>` as input. This enables unit testing the complete streaming state machine (thinking-to-content transitions, tool call events, block indices) without any HTTP mocking. The `stream()` method becomes a thin I/O shell: fetch + pipe to `mapChunksToStreamEvents`.

### Ollama-specific quirks covered by tests

- **`done_reason` unreliability:** Ollama reports `done_reason: "stop"` even when tool calls are present. AC3.3 tests verify `normalizeStopReason` checks `tool_calls` first.
- **Parsed arguments:** Ollama returns tool call `arguments` as parsed objects, not JSON strings (unlike OpenAI). Additional normalization tests verify this is handled correctly.
- **`think: true` always on:** AC4.1 verifies the request always includes `think: true` -- the adapter unconditionally enables reasoning.
