# Compaction V2 — Human Test Plan

Generated from: docs/implementation-plans/2026-02-28-compaction-v2/

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Ollama accessible at `192.168.1.6:11434` (or configured endpoint)
- Dependencies installed (`bun install`)
- All automated tests passing: `bun test` (281 tests, 0 failures excluding DB-dependent)
- Type-check passing: `bun run build`

## Phase 1: Config Round-Trip Verification

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open `config.toml.example` | File contains a commented-out `[summarization]` section with all scoring fields (`role_weight_system`, `role_weight_user`, `role_weight_assistant`, `recency_decay`, `question_bonus`, `tool_call_bonus`, `keyword_bonus`, `important_keywords`, `content_length_weight`) |
| 1.2 | Verify default values in config.toml.example match `DEFAULT_SCORING_CONFIG` in `src/compaction/types.ts`: `role_weight_system=10.0`, `role_weight_user=5.0`, `role_weight_assistant=3.0`, `recency_decay=0.95`, `question_bonus=2.0`, `tool_call_bonus=4.0`, `keyword_bonus=1.5`, `important_keywords=["error","fail","bug","fix","decision","agreed","constraint","requirement"]`, `content_length_weight=1.0` | All values match exactly |
| 1.3 | Uncomment the `[summarization]` section in a local `config.toml`, set `provider="openai-compat"`, `name="qwen3:1.7b"`, `base_url="http://192.168.1.6:11434/v1"`, `api_key="ollama"`, set `role_weight_system=15.0` and `recency_decay=0.8` | File saves without issue |
| 1.4 | Run `bun run start` | Daemon starts without config parsing errors. No Zod validation failures in console output |
| 1.5 | Restore original config.toml (re-comment the section) | -- |

## Phase 2: Live Summarization Quality (Dogfooding)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Start the daemon with Ollama-backed summarization (`[summarization]` section enabled) | Daemon starts, compaction module logs initialization |
| 2.2 | Have a multi-turn conversation (15+ exchanges) covering distinct topics: database schema, error handling, a decision point, a tool invocation | Messages accumulate in working context |
| 2.3 | Trigger compaction (either by exceeding context budget or via the `compact` tool) | Console output shows compaction ran. Log should reference batches created and messages compressed |
| 2.4 | Inspect the clip-archive system message injected into context | Starts with `[Context Summary`, contains `## Earliest context` and `## Recent context` sections. Batch headers show `[Batch N -- depth 0, ISO to ISO]` format. Summary text is coherent and mentions key topics from the conversation |
| 2.5 | Continue the conversation referencing earlier topics mentioned only in the summary | Agent should be able to reference summarized context correctly |

## Phase 3: Structured Prompt Verification (Manual Inspection)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Add temporary logging in `src/compaction/compactor.ts` before the `model.complete()` call inside `summarizeChunk` to `console.log(JSON.stringify(request, null, 2))` | -- |
| 3.2 | Trigger compaction with a conversation that has a prior `[Context Summary]` message | Logged request shows: (a) `system` field is the configured prompt or default; (b) first message in `messages` array has `role:"system"` with `"Previous summary of conversation:..."` content; (c) middle messages have original `user`/`assistant` roles; (d) last message has `role:"user"` with directive text starting with "Summarize" |
| 3.3 | Trigger compaction without a prior summary (fresh conversation) | Logged request shows: (a) `system` field set; (b) no `role:"system"` message in the array; (c) first message is `role:"user"` or `role:"assistant"` from conversation |
| 3.4 | Verify no `"persona"` string appears anywhere in the logged request JSON | No match found |
| 3.5 | Remove the temporary logging | -- |

## End-to-End: Multi-Cycle Compaction

| Step | Action | Expected |
|------|--------|----------|
| E2E.1 | Start daemon with small `chunk_size=5`, `keep_recent=3`, `clip_first=1`, `clip_last=1` | Daemon starts with tight compaction settings |
| E2E.2 | Generate 30+ messages across 3-4 conversation topics | Messages fill context |
| E2E.3 | Trigger first compaction | Creates depth-0 batches. Clip-archive appears as system message |
| E2E.4 | Generate 20+ more messages | Context fills again |
| E2E.5 | Trigger second compaction | Creates more depth-0 batches. If batch count exceeds `clip_first + clip_last + 2`, re-summarization triggers and produces depth-1 batch. Older depth-0 batches are deleted from memory |
| E2E.6 | Inspect clip-archive content | Shows batch with `depth 1` in earliest section, `depth 0` batches in recent section. Omission indicator shows `N earlier summaries omitted -- use memory_read to retrieve` |
| E2E.7 | Use `memory_read` tool to search for omitted summaries | Returns archived batch content from archival tier |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| compaction-v2.AC3.5 | TOML round-trip with real config file requires manual smoke test since there are no config-loading integration tests that parse TOML with scoring fields | Phase 1, steps 1.1-1.4 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| compaction-v2.AC1.1 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | Phase 3, step 3.2 |
| compaction-v2.AC1.2 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | Phase 3, step 3.2 |
| compaction-v2.AC1.3 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | Phase 3, step 3.2 |
| compaction-v2.AC1.4 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | Phase 3, step 3.2 |
| compaction-v2.AC1.5 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | Phase 3, step 3.3 |
| compaction-v2.AC1.6 | `prompt.test.ts` (unit), `compactor.test.ts` (integration) | -- |
| compaction-v2.AC2.1 | `types.ts` (compile), `compactor.test.ts` (integration) | -- |
| compaction-v2.AC2.2 | `anthropic.test.ts` | -- |
| compaction-v2.AC2.3 | `openai-compat.test.ts` | -- |
| compaction-v2.AC2.4 | `anthropic.test.ts`, `openai-compat.test.ts`, full suite | -- |
| compaction-v2.AC2.5 | `anthropic.test.ts`, `openai-compat.test.ts` | -- |
| compaction-v2.AC3.1 | `scoring.test.ts`, `compactor.test.ts` (integration) | -- |
| compaction-v2.AC3.2 | `scoring.test.ts` | -- |
| compaction-v2.AC3.3 | `scoring.test.ts` | -- |
| compaction-v2.AC3.4 | `compactor.test.ts` (unit + integration) | -- |
| compaction-v2.AC3.5 | `scoring.test.ts`, `schema.test.ts` | Phase 1, steps 1.1-1.4 |
| compaction-v2.AC3.6 | `compactor.test.ts` | -- |
| compaction-v2.AC4.1 | `compactor.test.ts`, static grep | Phase 3, step 3.4 |
| compaction-v2.AC4.2 | `compactor.test.ts` (`@ts-expect-error`), static grep | -- |
| compaction-v2.AC4.3 | `prompt.test.ts` | -- |
| compaction-v2.AC4.4 | `prompt.test.ts`, `compactor.test.ts` (integration) | -- |
