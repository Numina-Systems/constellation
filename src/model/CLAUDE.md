# Model

Last verified: 2026-07-03

## Purpose
Abstracts LLM providers behind a unified `ModelProvider` port so the agent loop is provider-agnostic. Normalizes Anthropic and OpenAI-compatible APIs into a shared message/content-block format. Anthropic requests include ephemeral cache_control breakpoints on the system param and last message for incremental cache reuse.

## Contracts
- **Exposes**: `ModelProvider` interface (`complete`, `stream`), `createModelProvider(config)`, `createAnthropicAdapter`, `createOpenAICompatAdapter`, `createOllamaAdapter`, all message/content-block types, `ModelError`, `buildAnthropicSystemParam`, `applyCacheControlToLastBlock`
- **Guarantees**: All adapters normalize responses to the same `ModelResponse` format with `ContentBlock` discriminated union. `Message.role` supports `"user" | "assistant" | "system"`. Anthropic adapter extracts system-role messages from the messages array into the Anthropic `system` API parameter, which is returned by `buildAnthropicSystemParam` as a block array with `cache_control: {type: "ephemeral"}` on the final block (or `undefined` if no system content). The adapter also applies `applyCacheControlToLastBlock` to message params after normalization, marking the final content block of the last message with `cache_control: {type: "ephemeral"}`. Two breakpoints total (within Anthropic's limit of 4). `ModelResponse` includes `cache_creation_input_tokens` and `cache_read_input_tokens` from Anthropic's usage field when present. OpenAI-compat and Ollama adapters are untouched; they cache implicitly via their own mechanisms. `ModelError` carries `retryable` flag. Retry wrapper provides exponential backoff for retryable errors. Optional `timeout` on `ModelRequest` applies an `AbortSignal` to the HTTP request; timeout errors produce `ModelError` with `code: 'timeout'` and `retryable: true`.
- **Expects**: Valid API key for Anthropic/OpenAI providers. Model name must be valid for the provider. Ollama does not require API key authentication. Anthropic cache is opt-in per request; prefixes below the model-dependent minimum (e.g. 4096 tokens on Opus tier) silently don't cache, which is expected and harmless.

## Dependencies
- **Uses**: `@anthropic-ai/sdk`, `openai`, raw `fetch()` for Ollama, `src/config/`
- **Used by**: `src/agent/`, `src/compaction/` (via `ModelProvider` for summarization)
- **Boundary**: Only `src/agent/` and `src/compaction/` should call model providers. Other modules use memory or tools.

## Key Decisions
- Anthropic message format as canonical: `ContentBlock` union (TextBlock, ToolUseBlock, ToolResultBlock) matches Anthropic's native format; OpenAI and Ollama adapters translate
- System-role messages in `messages` array: Callers can place system-role messages inline; adapters handle provider-specific extraction (Anthropic concatenates into `system` param, OpenAI and Ollama pass through natively)
- Anthropic prompt caching via cache_control breakpoints: Two ephemeral breakpoints (5-min TTL) placed at the system param's final block and the last message's final content block. Prefixes below the model's minimum cacheable length (e.g. 4096 tokens for Opus) silently don't cache. The cache lookup window is 20 content blocks; a single turn generating >20 blocks may miss the previous cache entry, triggering a recalculation. This is expected and harmless.
- Streaming via `AsyncIterable<StreamEvent>`: Composable, backpressure-friendly
- Ollama native `/api/chat` over `/v1` shim: The OpenAI-compatible `/v1` endpoint silently drops tool calls during streaming. The native endpoint avoids this bug.

## Invariants
- `ModelResponse.content` is always a non-empty array
- `stop_reason` is always one of: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`
- `ModelError.code` classifies all provider errors into four categories
- Anthropic adapter places exactly 2 ephemeral cache_control breakpoints per request (on system param's final block and last message's final content block), or 1 breakpoint if no system param
- Anthropic `normalizeMessage()` throws if passed a system-role message (must be extracted first via `buildAnthropicSystemParam`)
- `buildAnthropicSystemParam` returns a block array with cache_control or `undefined` (never empty array or string)

## Key Files
- `types.ts` -- All shared types, `ModelProvider` port, `ModelError`
- `anthropic.ts` -- Anthropic adapter with streaming
- `openai-compat.ts` -- OpenAI-compatible adapter with configurable baseURL
- `ollama.ts` -- Ollama adapter using native `/api/chat` endpoint
- `factory.ts` -- Config-driven provider creation
- `retry.ts` -- Retry wrapper with exponential backoff
