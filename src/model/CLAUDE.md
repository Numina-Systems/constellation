# Model

Last verified: 2026-03-01

## Purpose
Abstracts LLM providers behind a unified `ModelProvider` port so the agent loop is provider-agnostic. Normalizes Anthropic and OpenAI-compatible APIs into a shared message/content-block format.

## Contracts
- **Exposes**: `ModelProvider` interface (`complete`, `stream`), `createModelProvider(config)`, `createAnthropicAdapter`, `createOpenAICompatAdapter`, all message/content-block types, `ModelError`, `buildAnthropicSystemParam`
- **Guarantees**: Both adapters normalize responses to the same `ModelResponse` format with `ContentBlock` discriminated union. `Message.role` supports `"user" | "assistant" | "system"`. Anthropic adapter extracts system-role messages from the messages array into the Anthropic `system` API parameter. OpenAI-compat adapter passes system-role messages through as native OpenAI system messages. `ModelError` carries `retryable` flag. Retry wrapper provides exponential backoff for retryable errors.
- **Expects**: Valid API key for chosen provider. Model name must be valid for the provider.

## Dependencies
- **Uses**: `@anthropic-ai/sdk`, `openai`, `src/config/`
- **Used by**: `src/agent/`, `src/compaction/` (via `ModelProvider` for summarization)
- **Boundary**: Only `src/agent/` and `src/compaction/` should call model providers. Other modules use memory or tools.

## Key Decisions
- Anthropic message format as canonical: `ContentBlock` union (TextBlock, ToolUseBlock, ToolResultBlock) matches Anthropic's native format; OpenAI adapter translates
- System-role messages in `messages` array: Callers can place system-role messages inline; adapters handle provider-specific extraction (Anthropic concatenates into `system` param, OpenAI passes through natively)
- Streaming via `AsyncIterable<StreamEvent>`: Composable, backpressure-friendly

## Invariants
- `ModelResponse.content` is always a non-empty array
- `stop_reason` is always one of: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`
- `ModelError.code` classifies all provider errors into four categories
- Anthropic `normalizeMessage()` throws if passed a system-role message (must be extracted first via `buildAnthropicSystemParam`)

## Key Files
- `types.ts` -- All shared types, `ModelProvider` port, `ModelError`
- `anthropic.ts` -- Anthropic adapter with streaming
- `openai-compat.ts` -- OpenAI-compatible adapter with configurable baseURL
- `factory.ts` -- Config-driven provider creation
- `retry.ts` -- Retry wrapper with exponential backoff
