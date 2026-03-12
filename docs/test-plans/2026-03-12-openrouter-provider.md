# OpenRouter Provider — Human Test Plan

## Prerequisites
- PostgreSQL running (`docker compose up -d`)
- `config.toml` configured with `provider = "openrouter"` in `[model]` section
- `OPENROUTER_API_KEY` set in environment (or `.env`)
- `bun test src/model/openrouter.test.ts src/config/schema.test.ts src/config/env-override.test.ts src/rate-limit/provider.test.ts src/model/factory.test.ts` — all 95 tests passing
- `bun run build` — type-check passes with no errors

## Phase 1: Shared Helpers Extraction (No ACs — Regression)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun run build` from project root | Type-check succeeds with exit code 0, no errors |
| 2 | Run `bun test src/model/` | All existing model tests pass (Anthropic, OpenAI-compat, Ollama, OpenRouter adapters) |
| 3 | Open `src/model/openai-compat.ts` and check imports | File imports normalization helpers from `openai-shared.ts`. No duplicated normalization logic between `openai-compat.ts` and `openrouter.ts` |

## Phase 2: Live Daemon — Complete Call

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set `config.toml` `[model]` section to `provider = "openrouter"`, `name = "anthropic/claude-sonnet-4"` | Config loads without error |
| 2 | Optionally add `[model.openrouter]` with `sort = "price"` and `title = "Constellation"` | Config loads without error |
| 3 | If rate limiting desired, add `requests_per_minute = 50` to `[model]` | Config loads without error |
| 4 | Run `bun run start` | Daemon starts, REPL prompt appears, no errors in output |
| 5 | Type a simple message: "What is 2 + 2?" | Model responds with a valid answer |
| 6 | Check stdout for cost log line | Line matching `[openrouter] cost=$X model=anthropic/claude-sonnet-4 tokens=I/O` appears at info level |
| 7 | If rate limiting is configured, check stdout for any rate limit sync errors | No errors related to `syncFromServer` or rate limit bucket corruption appear |

## Phase 3: Live Daemon — Streaming Call

| Step | Action | Expected |
|------|--------|----------|
| 1 | With daemon running, send a message that produces a longer response: "Write a haiku about the ocean" | Response streams in progressively (characters appear incrementally, not all at once) |
| 2 | Check stdout after stream completes | Cost log line appears: `[openrouter] cost=$X model=Y tokens=0/0` (or with actual token counts if OpenRouter provides usage in stream) |

## Phase 4: Keepalive Under Real Conditions

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure a slower model via OpenRouter (e.g., a reasoning model or one with known latency) | Config loads without error |
| 2 | Send a message that requires extended processing: "Explain the proof of the four-colour theorem in detail" | Stream completes without error. If OpenRouter injects `: OPENROUTER PROCESSING` keepalive comments during the wait, they are silently ignored — no parsing errors, no dropped content |
| 3 | Verify the response content is coherent and complete | Response text is sensible and not truncated at a keepalive boundary |

## End-to-End: Tool Use via OpenRouter

| Step | Action | Expected |
|------|--------|----------|
| 1 | With OpenRouter configured, send a message that triggers a built-in tool (e.g., "Search your memory for X") | Agent calls the tool, receives the result, and produces a coherent response incorporating the tool output |
| 2 | Check stdout for cost log | Cost log appears for each model call in the tool-use loop |
| 3 | If rate limiting is active, verify no 429 errors from OpenRouter during the multi-turn loop | All calls succeed; rate limiter throttles proactively if needed |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `src/config/schema.test.ts` | — |
| AC1.2 | `src/config/schema.test.ts` | — |
| AC1.3 | `src/config/env-override.test.ts` | — |
| AC1.4 | `src/config/schema.test.ts` | — |
| AC2.1 | `src/model/openrouter.test.ts` | — |
| AC2.2 | `src/model/openrouter.test.ts` | — |
| AC2.3 | `src/model/openrouter.test.ts` | — |
| AC2.4 | `src/model/openrouter.test.ts` | — |
| AC2.5 | `src/model/openrouter.test.ts` | — |
| AC3.1 | `src/model/openrouter.test.ts` | Phase 2, Step 6 |
| AC3.2 | `src/model/openrouter.test.ts` | Phase 3, Step 2 |
| AC4.1 | `src/model/openrouter.test.ts` | — |
| AC4.2 | `src/rate-limit/provider.test.ts` | — |
| AC4.3 | `src/rate-limit/provider.test.ts` | — |
| AC4.4 | `src/rate-limit/provider.test.ts` | — |
| AC5.1 | `src/model/openrouter.test.ts` | — |
| AC5.2 | `src/model/openrouter.test.ts` | — |
| AC6.1 | `src/model/openrouter.test.ts` | — |
| AC6.2 | `src/model/openrouter.test.ts` | — |
| AC7.1/AC7.2 | `src/model/openrouter.test.ts` | — |
| AC7.3 | `src/model/openrouter.test.ts` | Phase 4, Steps 1-3 |
| AC8.1 | `src/model/factory.test.ts` | — |
| AC8.2 | `src/model/factory.test.ts` | Phase 2, Steps 4-7 |
| AC8.3 | `src/model/factory.test.ts` | — |
