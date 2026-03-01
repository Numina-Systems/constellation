# Compaction V2 — Test Requirements

Generated from design: docs/design-plans/2026-02-28-compaction-v2.md

## Automated Test Coverage

| AC ID | Criterion | Test Type | Test File | Phase |
|-------|-----------|-----------|-----------|-------|
| compaction-v2.AC1.1 | Summarization LLM call uses `system` field for config prompt (or default) and passes messages as structured conversation | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.1 | Summarization LLM call uses `system` field (e2e verification via captured ModelRequest) | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC1.2 | Previous compaction summary is passed as a system-role message in the messages array | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.2 | Previous summary appears as system-role message in full pipeline | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC1.3 | Actual conversation messages preserve their original roles (user/assistant) in the summarization request | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.3 | Roles preserved in captured ModelRequest during compress() | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC1.4 | Baked-in directive appears as final user message with preserve/condense/prioritize/remove instructions | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.4 | Final user message is directive in captured ModelRequest | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC1.5 | No previous summary results in no system-role context message (not an empty one) | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.5 | No system-role message when no prior summary in full pipeline | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC1.6 | Re-summarization (`resummarizeBatches`) uses the same structured message approach | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC1.6 | Re-summarization captured request uses structured messages | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC2.1 | `Message` type accepts `role: 'system'` alongside 'user' and 'assistant' | unit (compile-time) | src/model/anthropic.test.ts, src/model/openai-compat.test.ts | 1 |
| compaction-v2.AC2.1 | System-role messages appear in messages array in full pipeline | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC2.2 | Anthropic adapter extracts system-role messages from array and merges with `request.system` field | unit | src/model/anthropic.test.ts | 1 |
| compaction-v2.AC2.3 | OpenAI-compat adapter passes system-role messages through as `{ role: 'system' }` in OpenAI format | unit | src/model/openai-compat.test.ts | 1 |
| compaction-v2.AC2.4 | Existing `request.system` field continues to work for backward compatibility | unit | src/model/anthropic.test.ts | 1 |
| compaction-v2.AC2.4 | Existing `request.system` field backward compat (OpenAI) | unit | src/model/openai-compat.test.ts | 1 |
| compaction-v2.AC2.4 | Full test suite passes (no regressions from type widening) | regression | all test files (`bun test`) | 1, 2, 6 |
| compaction-v2.AC2.5 | Multiple system-role messages in array are handled correctly (concatenated for Anthropic) | unit | src/model/anthropic.test.ts | 1 |
| compaction-v2.AC2.5 | Multiple system-role messages in array are handled correctly (sequential for OpenAI) | unit | src/model/openai-compat.test.ts | 1 |
| compaction-v2.AC3.1 | Messages scored by role weight (system > user > assistant by default) | unit | src/compaction/scoring.test.ts | 4 |
| compaction-v2.AC3.1 | Role-based importance ordering observed in full pipeline | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC3.2 | Newer messages score higher than older messages via recency decay | unit | src/compaction/scoring.test.ts | 4 |
| compaction-v2.AC3.3 | Content signals (questions, tool calls, keywords) increase score | unit | src/compaction/scoring.test.ts | 4 |
| compaction-v2.AC3.4 | `splitHistory()` returns `toCompress` sorted by importance ascending (lowest-scored first) | unit | src/compaction/compactor.test.ts | 4 |
| compaction-v2.AC3.4 | Importance ordering in compressed messages during full pipeline | integration | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC3.5 | Scoring config is customizable via `[summarization]` TOML section | unit | src/compaction/scoring.test.ts (custom config override test) | 4 |
| compaction-v2.AC3.5 | Zod schema accepts scoring fields with correct defaults | unit/schema | src/config/schema.ts (validated at build via `bun run build`) | 5 |
| compaction-v2.AC3.6 | Messages with identical scores maintain their original chronological order (stable sort) | unit | src/compaction/compactor.test.ts | 4 |
| compaction-v2.AC4.1 | No code path in compaction module injects persona content | unit (negative assertion) | src/compaction/compactor.test.ts | 6 |
| compaction-v2.AC4.1 | No `persona` references remain in compaction module | static analysis | `grep -rw "persona" src/compaction/` (Phase 3 verification step) | 3 |
| compaction-v2.AC4.2 | `getPersona` callback is fully removed from `CreateCompactorOptions` | unit (compile-time) | src/compaction/compactor.test.ts (compiles without `getPersona`) | 3 |
| compaction-v2.AC4.2 | No `getPersona` references remain anywhere | static analysis | `grep -rw "getPersona" src/` (Phase 3 verification step) | 3 |
| compaction-v2.AC4.3 | Custom `prompt` in config is used as-is for the system prompt (no transformation) | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC4.4 | Absent custom prompt falls back to default generic system prompt | unit | src/compaction/prompt.test.ts | 2 |
| compaction-v2.AC4.4 | Default prompt used when no custom prompt in full pipeline | integration | src/compaction/compactor.test.ts | 6 |

## Human Verification

| AC ID | Criterion | Verification Approach | Justification |
|-------|-----------|----------------------|---------------|
| compaction-v2.AC3.5 | Scoring config is customizable via `[summarization]` TOML section | Manually verify `config.toml.example` contains correctly commented scoring fields that match `DEFAULT_SCORING_CONFIG` values and that a real `config.toml` with custom scoring values parses without error at startup (`bun run start`) | The example file is documentation, not executable code. Zod defaults are covered by the schema type-check, but confirming the TOML round-trip with a real config file requires a manual smoke test since there are no config-loading integration tests that parse TOML with scoring fields. |

## Notes

### Test strategy overview

Tests are organized in three layers:

1. **Pure function unit tests** — `scoring.test.ts` and `prompt.test.ts` test the Functional Core directly: scoring arithmetic, message builder output shapes, default/custom config handling. These are fast, deterministic, and cover the bulk of the ACs.

2. **Compactor unit tests** — `compactor.test.ts` tests `splitHistory()` with importance ordering and the `compress()`/`resummarizeBatches()` pipeline using mocked `ModelProvider`, `MemoryManager`, and `PersistenceProvider`. These verify wiring between the functional core and the imperative shell.

3. **Adapter unit tests** — `anthropic.test.ts` and `openai-compat.test.ts` test system-role message handling via exported pure helper functions (`buildAnthropicSystemParam`, `normalizeMessage`), avoiding the need for API keys.

4. **Phase 6 integration tests** — Full `createCompactor() → compress()` pipeline with mocked deps, capturing the `ModelRequest` to verify the structured call shape end-to-end. This is the glue test that confirms all phases compose correctly.

### Static analysis as test

Two AC4 criteria (AC4.1, AC4.2) include `grep`-based static analysis as part of Phase 3's verification. These are not `bun test` assertions but are repeatable commands documented in the implementation plan. They could be formalized as a CI lint step if desired.

### AC coverage is intentionally redundant

Most ACs appear in both unit tests (testing the specific function) and the Phase 6 integration test (testing the composed pipeline). This is deliberate — unit tests catch regressions quickly, integration tests catch wiring bugs.

### No real LLM calls

All automated tests use mocked model providers. The quality of summarization output from real models with structured prompts vs the old interpolation approach is not testable via automation — that's an implicit human evaluation during dogfooding.
