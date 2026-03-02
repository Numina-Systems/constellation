# Rate Limiter — Human Test Plan

## Prerequisites

- PostgreSQL with pgvector running (`docker compose up -d`)
- Valid `config.toml` with rate limit fields configured on `[model]` section
- `bun test` passing (78 tests, 0 failures in rate-limit + agent modules)
- `bun run build` passing (type-check clean)

## Phase 1: Composition Root Wiring Verification

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open `src/index.ts`. Read lines 291-305. | `rawModel = createModelProvider(config.model)`. When `hasRateLimitConfig(config.model)` is true, `createRateLimitedProvider(rawModel, buildRateLimiterConfig(config.model))` wraps it. A `createRateLimitContextProvider` is pushed to `contextProviders`. |
| 1.2 | Read lines 312-330. | When `config.summarization` exists and `hasRateLimitConfig(config.summarization)` is true, a separate `createRateLimitedProvider` wraps the summarization model with its own config. Separate `buildRateLimiterConfig` call — independent buckets confirmed. |
| 1.3 | Read lines 445-460. | `createAgent` receives `contextProviders: contextProviders.length > 0 ? contextProviders : undefined`. When no rate limiter is configured, array is empty, so `undefined` is passed (no budget section in prompt). |
| 1.4 | Verify wrapping order: rate limiter wraps the result of `createModelProvider`, which internally contains retry logic. | Rate limiter is above retry. If a 429 sneaks through, the retry adapter handles it before the error reaches the rate limiter. |

## Phase 2: Startup Smoke Test — Rate Limiting Active

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Add rate limit fields to `config.toml` under `[model]`: `requests_per_minute = 50`, `input_tokens_per_minute = 40000`, `output_tokens_per_minute = 8000`, `min_output_reserve = 1024`. | Config file saved without errors. |
| 2.2 | Run `bun run start`. | Console output includes: `rate limiting active for model <model-name> (50 RPM, 40000 ITPM, 8000 OTPM)`. REPL prompt appears normally. |
| 2.3 | Send a message: `Hello, how are you?` | Agent responds normally. No 429 errors. No visible delay. |
| 2.4 | Ask: `What does your system prompt say about resource budgets?` | Agent should reference a "Resource Budget" section showing remaining input/output token capacity. |

## Phase 3: Startup Smoke Test — No Rate Limiting

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Remove all rate limit fields from `config.toml` under `[model]`. | Config file saved. |
| 3.2 | Run `bun run start`. | Console output does NOT include any "rate limiting active" message. REPL prompt appears normally. |
| 3.3 | Ask: `What does your system prompt say about resource budgets?` | Agent should NOT reference any resource budget section. |

## Phase 4: Independent Summarization Rate Limits

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Add rate limit fields to both `[model]` and `[summarization]` with different values (e.g., model: RPM=50, summarization: RPM=30). | Config saved. |
| 4.2 | Run `bun run start`. | Two separate "rate limiting active" lines in console with different values. |

## Phase 5: Rate Limiting Under Load

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Configure low limits: `requests_per_minute = 2`, `input_tokens_per_minute = 500`, `output_tokens_per_minute = 500`, `min_output_reserve = 100`. | Config saved. |
| 5.2 | Run `bun run start`. Send a message. | First message processes normally. |
| 5.3 | Immediately send a second message. | May take noticeably longer (throttling). REPL remains responsive. Completes without 429. |
| 5.4 | Immediately send a third message. | Queues behind second. Eventually completes. No dropped requests. No crash. |

## End-to-End: Full Rate Limiter Lifecycle

1. Configure `config.toml` with `requests_per_minute = 10`, `input_tokens_per_minute = 5000`, `output_tokens_per_minute = 2000`, `min_output_reserve = 512`.
2. Run `bun run start`. Confirm "rate limiting active" message with correct values.
3. Send a short message ("Hi"). Confirm fast response, no throttling.
4. Send a longer message (500-word paragraph, ask to summarize). Confirm response arrives, may take slightly longer.
5. Ask: "How much budget do you have left?" Agent should report reduced remaining capacity.
6. Send 10 rapid messages. All should eventually complete. No 429 errors. REPL stays interactive.
7. Ctrl+C to shut down. Confirm clean shutdown.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 — No delay when budget available | `provider.test.ts` AC1.1 | Phase 2, step 2.3 |
| AC1.2 — Wait on input token exhaustion | `provider.test.ts` AC1.2 | Phase 5, step 5.3 |
| AC1.3 — Wait on RPM exhaustion | `provider.test.ts` AC1.3 | Phase 5, step 5.4 |
| AC1.4 — Wait on OTPM below minOutputReserve | `provider.test.ts` AC1.4 | Phase 5, step 5.2 |
| AC1.5 — Post-response correction | `bucket.test.ts` + `provider.test.ts` AC1.5 | E2E step 5 |
| AC1.6 — Negative bucket on underestimate | `bucket.test.ts` AC1.6 | — (fully automated) |
| AC1.7 — Credit back on overestimate | `bucket.test.ts` AC1.7 | — (fully automated) |
| AC2.1 — Independent per-model buckets | Structural (`bun run build`) | Phase 1 steps 1.1-1.2, Phase 4 |
| AC2.2 — Optional config fields | `schema.test.ts` AC2.2 | Phase 3, step 3.2 |
| AC2.3 — Different model/summarization limits | `schema.test.ts` AC2.3 | Phase 4 |
| AC2.4 — Invalid config rejected | `schema.test.ts` AC2.4 | — (fully automated) |
| AC3.1 — Budget in system prompt | `context.test.ts` AC3.1 | Phase 2, step 2.4 |
| AC3.2 — Budget updates each round | `context.test.ts` AC3.2 | E2E step 5 |
| AC3.3 — No budget when unconfigured | `context.test.ts` AC3.3 | Phase 3, step 3.3 |
| AC4.1 — Requests queued, not dropped | `provider.test.ts` AC4.1 | Phase 5, step 5.4 |
| AC4.2 — Mutex serialisation | `provider.test.ts` AC4.2 | Phase 5 (REPL responsiveness) |
| AC4.3 — No double-spend | `provider.test.ts` AC4.3 | — (fully automated) |
| AC5.1 — Errors propagate / layering | `provider.test.ts` AC5.1 + structural | Phase 1, step 1.4 |
| AC5.2 — No retry interference | `provider.test.ts` AC5.2 | — (fully automated) |
| AC6.1 — Continuous refill | `bucket.test.ts` AC6.1 | — (fully automated) |
| AC6.2 — Capacity cap | `bucket.test.ts` AC6.2 | — (fully automated) |
| AC6.3 — Exact waitMs | `bucket.test.ts` AC6.3 | — (fully automated) |
| AC6.4 — getStatus returns full info | `bucket.test.ts` AC6.4 | — (fully automated) |
