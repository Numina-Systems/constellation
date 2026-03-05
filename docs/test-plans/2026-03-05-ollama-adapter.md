# Ollama Adapter Human Test Plan

## Prerequisites
- Ollama running and accessible (e.g., `http://192.168.1.6:11434`)
- A small model pulled: `ollama pull llama3.2:1b`
- Project dependencies installed: `bun install`
- Type check passes: `bun run build`
- All automated tests pass: `bun test src/model/ollama.test.ts src/config/schema.test.ts src/model/factory.test.ts`

## Phase 1: Integration Round-Trip (AC2.1, AC2.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `OLLAMA_ENDPOINT=http://192.168.1.6:11434 bun test src/model/ollama.test.ts` | The two integration tests (previously skipped) now run and pass. Output shows "complete method > should return ModelResponse with non-empty content" and "stream method > should yield correct StreamEvent sequence" both passing. |
| 2 | Verify `complete()` integration output: check that test passes with `content.length > 0` and `stop_reason` is one of `["end_turn", "tool_use", "max_tokens", "stop_sequence"]` | Response contains at least one content block. The model produces a meaningful reply to "Say hello". |
| 3 | Verify `stream()` integration output: confirm events array starts with `message_start` and ends with `message_stop` | Stream event sequence is well-formed. No events appear before `message_start`. No events appear after `message_stop`. |

## Phase 2: Config Integration (AC1.1-AC1.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml` to set `[model]` section: `provider = "ollama"`, `name = "llama3.2:1b"`, `base_url = "http://192.168.1.6:11434"`. Remove `api_key`. | File saves without issue. |
| 2 | Run `bun run build` | Type check passes. No errors about missing `api_key` or invalid provider. |
| 3 | Edit `config.toml` to remove `base_url` from `[model]`. | File saves. |
| 4 | Run `bun run build` | Still passes. Schema allows omitted `base_url`. |
| 5 | Edit `config.toml` to add `[summarization]` section with `provider = "ollama"`, `name = "llama3.2:1b"`, `base_url = "http://192.168.1.6:11434"`. | File saves. |
| 6 | Run `bun run build` | Passes. Both model and summarization sections accept `"ollama"`. |

## Phase 3: Structural Verification (AC5.5)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/model/ollama.ts`, locate the `complete()` method. | Body is wrapped in `callWithRetry(async () => { ... }, isRetryableOllamaError)`. |
| 2 | Locate the `stream()` method. | The `fetch` call is wrapped in `callWithRetry(async () => { ... }, isRetryableOllamaError)`. The `mapChunksToStreamEvents(parseNDJSON(response.body))` pipe is outside the retry (correctly -- only the initial HTTP connection is retried, not mid-stream). |
| 3 | Run `bun run build` to confirm type correctness of the retry predicate. | Passes. If `isRetryableOllamaError` had a wrong signature, TypeScript would reject it. |

## End-to-End: Full Agent Conversation with Ollama Backend

**Purpose:** Validates that the Ollama adapter integrates correctly with the agent loop, including tool use and streaming, beyond what unit tests cover.

1. Configure `config.toml` with `[model] provider = "ollama"`, `name = "llama3.2:1b"`, `base_url = "http://192.168.1.6:11434"`.
2. Run `bun run start`.
3. In the REPL, send a simple message: "What is 2 + 2?"
4. Confirm the agent responds with text content (non-empty response, displayed in REPL).
5. Send a message that triggers a tool: "Search your memory for recent conversations."
6. Observe the agent loop: it should issue a tool call, receive the tool result, and produce a follow-up response.
7. Verify the REPL does not crash, and the conversation continues normally after tool use.

## End-to-End: Ollama Connection Failure and Recovery

**Purpose:** Validates that the retry logic and error classification work in practice when Ollama is unreachable.

1. Stop Ollama: `ollama stop` or kill the process.
2. With `config.toml` pointing at the now-dead Ollama endpoint, run `bun run start`.
3. Send a message.
4. Observe: the adapter should retry (ECONNREFUSED is retryable) and eventually fail with a descriptive error after retries are exhausted. The REPL should not crash.
5. Restart Ollama.
6. Send another message. The next request should succeed.

## End-to-End: Streaming with Thinking (AC4.1-AC4.3)

**Purpose:** Validates that models supporting extended thinking produce visible thinking output in the streaming path.

1. Configure `config.toml` with a thinking-capable model (e.g., `qwq:latest` or `deepseek-r1:8b`) and Ollama as provider.
2. Run `bun run start`.
3. Send a reasoning-heavy prompt: "Explain step by step why the sky is blue."
4. If the model supports thinking, observe that thinking content appears before the final answer in the stream output. The `think: true` parameter is always sent (AC4.1), so models that support it will produce `thinking` content.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `schema.test.ts` -- "AC1.1: Config with provider='ollama' in [model]" | Config Integration Step 1-2 |
| AC1.2 | `schema.test.ts` -- "AC1.2: Config with provider='ollama' in [summarization]" | Config Integration Step 5-6 |
| AC1.3 | `schema.test.ts` -- "AC1.3" + `ollama.test.ts` -- "create ModelProvider without base_url" | Config Integration Step 3-4 |
| AC1.4 | `schema.test.ts` -- "AC1.4" + `ollama.test.ts` -- "create ModelProvider without api_key" | Config Integration Step 1-2 |
| AC2.1 | `ollama.test.ts` -- "normalizeResponse - content invariant" + integration (gated) | Integration Round-Trip Step 1-2 |
| AC2.2 | `ollama.test.ts` -- "mapChunksToStreamEvents" + integration (gated) | Integration Round-Trip Step 1, 3 |
| AC2.3 | `ollama.test.ts` -- "parseNDJSON" (5 tests) | -- |
| AC2.4 | `ollama.test.ts` -- "parseNDJSON" (malformed + error object) | -- |
| AC3.1 | `ollama.test.ts` -- "normalizeToolDefinitions" (3 tests) | -- |
| AC3.2 | `ollama.test.ts` -- "normalizeResponse - tool calls" (2 tests) | -- |
| AC3.3 | `ollama.test.ts` -- "normalizeStopReason" (3 tests) | -- |
| AC3.4 | `ollama.test.ts` -- "normalizeMessages with ToolResultBlock" (3 tests) | -- |
| AC3.5 | `ollama.test.ts` -- "normalizeResponse - multiple tool calls" | -- |
| AC4.1 | `ollama.test.ts` -- "buildOllamaRequest with think parameter" | Streaming with Thinking |
| AC4.2 | `ollama.test.ts` -- "normalizeResponse - thinking" (2 tests) | -- |
| AC4.3 | `ollama.test.ts` -- "mapChunksToStreamEvents > AC4.3" | Streaming with Thinking |
| AC5.1 | `ollama.test.ts` -- "classifyHttpError - rate limiting" | -- |
| AC5.2 | `ollama.test.ts` -- "classifyHttpError - server errors" (2 tests) | -- |
| AC5.3 | `ollama.test.ts` -- "classifyHttpError - client errors" (2 tests) | -- |
| AC5.4 | `ollama.test.ts` -- "isRetryableOllamaError" (7 tests) | -- |
| AC5.5 | Structural (code inspection) | Structural Verification steps 1-3 |
| AC6.1 | `ollama.test.ts` -- "AC6.1: Rate limiter wraps Ollama adapter" | -- |
| AC6.2 | `ollama.test.ts` -- "AC6.2: Summarization provider creation" (3 tests) | -- |
