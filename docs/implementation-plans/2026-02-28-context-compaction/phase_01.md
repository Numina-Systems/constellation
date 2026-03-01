# Context Compaction Implementation Plan — Phase 1

**Goal:** Add `[summarization]` config block with Zod schema and wire up a second `ModelProvider` instance for summarization.

**Architecture:** Extend the existing config schema with an optional `SummarizationConfigSchema` that inherits model provider fields and adds compaction-specific tuning parameters. The composition root creates a second `ModelProvider` from this config, falling back to the main model provider when `[summarization]` is omitted.

**Tech Stack:** Zod, TOML, TypeScript

**Scope:** 7 phases from original design (phase 1 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase is infrastructure — verified operationally (`bun run build` passes, config parses with and without `[summarization]`).

### context-compaction.AC6: Summarization uses dedicated model config
- **context-compaction.AC6.1 Success:** `[summarization]` config block accepts provider, name, base_url, api_key
- **context-compaction.AC6.2 Success:** Compaction-specific fields (chunk_size, keep_recent, etc.) have sensible defaults
- **context-compaction.AC6.3 Success:** Custom `prompt` field overrides the default summarization prompt
- **context-compaction.AC6.4 Success:** `{persona}`, `{existing_summary}`, `{messages}` placeholders are interpolated in the prompt
- **context-compaction.AC6.5 Failure:** Omitting `[summarization]` entirely falls back to main model provider with default compaction params

**Note:** AC6.3 and AC6.4 (prompt interpolation) are structurally supported here (the `prompt` field exists in config with a default), but the actual interpolation logic is implemented in Phase 2. This phase verifies the config schema accepts and defaults the field.

**Verifies:** context-compaction.AC6.1, context-compaction.AC6.2, context-compaction.AC6.5 (config-level only; AC6.3/AC6.4 prompt interpolation tested in Phase 2)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add SummarizationConfigSchema to schema.ts

**Files:**
- Modify: `src/config/schema.ts:13-54`

**Implementation:**

Add `SummarizationConfigSchema` after `RuntimeConfigSchema` (around line 37) and before `AppConfigSchema` (around line 39). It reuses the model config fields and adds compaction-specific fields with defaults. Then add it as an optional field on `AppConfigSchema`.

The schema should contain:
- `provider`: same enum as `ModelConfigSchema` — `z.enum(["anthropic", "openai-compat"])`
- `name`: `z.string()`
- `api_key`: `z.string().optional()`
- `base_url`: `z.string().url().optional()`
- `chunk_size`: `z.number().int().positive().default(20)`
- `keep_recent`: `z.number().int().nonnegative().default(5)`
- `max_summary_tokens`: `z.number().int().positive().default(1024)`
- `clip_first`: `z.number().int().nonnegative().default(2)`
- `clip_last`: `z.number().int().nonnegative().default(2)`
- `prompt`: `z.string().optional()` — when provided, overrides the default summarization prompt

Make the entire `summarization` field optional on `AppConfigSchema` — when absent from TOML, it should be `undefined` (not defaulted to `{}`), because the fallback logic in the composition root needs to distinguish "no summarization config" from "summarization config with defaults". When `summarization` is absent, the main model provider is reused.

Add `SummarizationConfig` type export and add `SummarizationConfigSchema` to the named exports.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass with no errors.

**Commit:** `feat(config): add SummarizationConfigSchema for compaction model config`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add SummarizationConfig type re-export to config.ts

**Files:**
- Modify: `src/config/config.ts:37`

**Implementation:**

Add `SummarizationConfig` to the type re-export on line 37 so it's available to consumers via `@/config/config`.

The existing line is:
```typescript
export type { AppConfig, AgentConfig, ModelConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig } from "./schema.ts";
```

Add `SummarizationConfig` to this list.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(config): re-export SummarizationConfig type`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add commented [summarization] section to config.toml.example

**Files:**
- Modify: `config.toml.example` (append after `[runtime]` block, line 27)

**Implementation:**

Add a commented-out `[summarization]` section with example values showing all available fields. Use the ollama endpoint from the design plan as the example provider.

```toml
# [summarization]
# provider = "openai-compat"
# name = "olmo-3:7b-think"
# base_url = "http://192.168.1.6:11434/v1"
# chunk_size = 20
# keep_recent = 5
# max_summary_tokens = 1024
# clip_first = 2
# clip_last = 2
# prompt = "Custom summarization prompt with {persona}, {existing_summary}, {messages} placeholders"
```

**Verification:**

Visually confirm the file looks correct. No build step needed for TOML example.

**Commit:** `docs: add [summarization] example to config.toml.example`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Create second ModelProvider for summarization in composition root

**Files:**
- Modify: `src/index.ts:13-15,238-278`

**Implementation:**

In `src/index.ts`, after loading config (line 238) and creating the main model provider (line 242), create a second `ModelProvider` for summarization.

The logic:
1. If `config.summarization` exists, create a `ModelProvider` from its model fields (provider, name, api_key, base_url)
2. If `config.summarization` is `undefined`, reuse the main `model` provider

To create the summarization provider, extract just the model fields from `SummarizationConfig` into a `ModelConfig`-compatible object and pass to `createModelProvider()`.

Store the result as `const summarizationModel: ModelProvider`. For now this variable won't be consumed until Phase 5/6 when the compactor is wired in — that's fine, the TypeScript compiler won't error on unused locals in this position since it's in the `main()` function body.

Also import `SummarizationConfig` type if needed for clarity, though type inference from `config.summarization` should suffice.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass. The summarization model provider is created but not yet consumed.

```bash
bun test
```

Expected: All tests that were passing before still pass (116 pass, 3 DB-dependent fail).

**Commit:** `feat: wire summarization ModelProvider in composition root`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Verify config parses with and without [summarization]

**Files:**
- No new files — operational verification only

**Implementation:**

Run the type checker to confirm the schema changes don't break anything:

```bash
bun run build
```

Then run the full test suite to confirm no regressions:

```bash
bun test
```

Expected:
- `bun run build` passes with no errors
- `bun test` shows same pass/fail counts as baseline (116 pass, 3 DB-dependent fail)

This validates:
- Config parses correctly without `[summarization]` (the default case — existing config.toml has no summarization section)
- `AppConfigSchema` correctly treats `summarization` as optional
- No type errors introduced in composition root

**Commit:** No commit — verification only.

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
