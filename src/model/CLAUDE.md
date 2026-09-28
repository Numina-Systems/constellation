# Model

Last verified: 2026-09-09

## Purpose

Provides provider-neutral model request/response ports and Anthropic, OpenAI-compatible, OpenRouter, and Ollama adapters with typed cancellation, deadlines, usage, and budget admission.

## Contracts

- **Exposes**: `ModelProvider`, normalized message/content/usage/stream types, provider factories, `ModelError`, request budgeting/exchange shaping, usage normalization, and retry helpers.
- **Guarantees**:
  - Requests may carry caller `signal`, absolute `deadline`, timeout upper bound, and explicit stream-usage capability. Adapters and rate-limit waits honor the composed lifetime and classify deliberate cancellation separately from timeout.
  - Requests are shaped as complete assistant tool-call/result exchanges on the live agent path. Duplicate, orphan, or missing results are rejected as typed agent corruption; trusted recovery repairs crash-orphaned tool results before the next provider call. Irreducible mandatory context returns `context_unfittable` without provider invocation.
  - Budget estimates include serialized system/diary/recall/skills/snapshots/messages/tools, output reserve, and safety margin. Default margin is `max(256, ceil(context_window * 0.02))`; estimates remain heuristic.
  - Explicit `model.context_window` wins. Without it, `agent.max_context_tokens` is an operator-configured fallback with a warning. A separately configured summarizer requires `summarization.context_window`; an identical summarizer may inherit the inference window.
  - Usage is normalized as inclusive input plus separate cache-read/write subsets and reasoning output. OpenAI-family prompt tokens already include cached input; Anthropic cache creation/read are not added twice. Missing stream usage remains missing, not fabricated zero.
  - OpenRouter requests stream usage by default; generic OpenAI-compatible endpoints require explicit opt-in. Empty-choice usage chunks are still consumed.
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
