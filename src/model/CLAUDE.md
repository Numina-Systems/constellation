# Model

Last verified: 2026-09-28

## Purpose

Provides provider-neutral model request/response ports and Anthropic, OpenAI-compatible, OpenRouter, and Ollama adapters with typed cancellation, deadlines, usage, and budget admission.

## Contracts

- **Exposes**: `ModelProvider`, normalized message/content/usage/stream types, provider factories, `ModelError`, request budgeting/exchange shaping, usage normalization, and retry helpers.
- **Guarantees**:
  - Requests may carry caller `signal`, absolute `deadline`, timeout upper bound, and explicit stream-usage capability. Adapters and rate-limit waits honor the composed lifetime and classify deliberate cancellation separately from timeout.
  - Requests are shaped as complete assistant tool-call/result exchanges on the live agent path. Duplicate, orphan, or missing results are rejected as typed agent corruption; trusted recovery repairs crash-orphaned tool results before the next provider call. Irreducible mandatory context returns `context_unfittable` without provider invocation.
  - Anthropic requests carry two ephemeral `cache_control` breakpoints: one on the system param's final block (caching tools + system together) and one on the last message's final content block (incremental conversation caching). Both are applied centrally by the shared `buildRequestParams` used by `complete()` and `stream()`; `buildAnthropicSystemParam`, `applyCacheControlToLastBlock`, and `buildRequestParams` are exported as test seams.
  - Budget estimates include serialized system/diary/recall/skills/snapshots/messages/tools, output reserve, and safety margin. Default margin is `max(256, ceil(context_window * 0.02))`; estimates remain heuristic.
  - Explicit `model.context_window` wins. Without it, `agent.max_context_tokens` is an operator-configured fallback with a warning. A separately configured summarizer requires `summarization.context_window`; an identical summarizer may inherit the inference window.
  - Usage is normalized as inclusive input plus separate cache-read/write subsets and reasoning output. OpenAI-family prompt tokens already include cached input; Anthropic cache creation/read are not added twice. Missing stream usage remains missing, not fabricated zero.
  - Terminal responses normalize into the `StopReason` union (`end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `incomplete`). Anthropic requests missing a stop reason and OpenAI-family null/unrecognized finish reasons (including `content_filter`) map to `incomplete` rather than a clean stop; Ollama classifies `done_reason === "length"` as `max_tokens` before tool-call detection.
  - Transient failures retry through `callWithRetry` using one shared `isRetryableModelError` classifier across all four adapters. Backoff scales the exponential delay by an injected random source (`options.random`, default `Math.random`), and a `Retry-After` header (seconds or HTTP-date) takes precedence, capped at 60 seconds and the remaining deadline. Empty-choices responses raise a retryable `INVALID_RESPONSE` inside the retried operation on the OpenAI-compatible and OpenRouter adapters, so they participate in retry.
  - OpenRouter requests stream usage by default; generic OpenAI-compatible endpoints require explicit opt-in. Empty-choice usage chunks are still consumed. Each OpenRouter call builds its own SDK client and captures response headers against a per-call id, so headers, cost, and rate-limit data attribute to the correct request under concurrency.
  - Ollama uses native `/api/chat` and preserves terminal usage/tool behavior.
- **Expects**: provider-valid model names and API keys where required. Deterministic loopback tests use fake keys/transports; live APIs are opt-in.

## Dependencies

- **Uses**: provider SDKs/raw fetch, config, and error contracts.
- **Used by**: agent and compaction only for model calls.
- **Boundary**: no other domain calls provider adapters directly.

## Key files

- `types.ts` -- shared request, response, usage, and stream types.
- `budget.ts`, `exchange.ts`, `usage.ts`, `cancellation.ts` -- pure protocol/lifetime policy.
- `anthropic.ts`, `openai-compat.ts`, `openrouter.ts`, `ollama.ts` -- adapters.
- `retry.ts`, `factory.ts`, `index.ts` -- retry, construction, and exports.
