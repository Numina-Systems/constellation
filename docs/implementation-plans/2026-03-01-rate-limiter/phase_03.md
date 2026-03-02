# Rate Limiter Implementation Plan — Phase 3: Configuration

**Goal:** Rate limit configuration integrated into existing config system.

**Architecture:** Optional rate limit fields added directly to `ModelConfigSchema` and `SummarizationConfigSchema` as flat fields. When present, the composition root wraps the provider (Phase 5). When absent, no wrapping — zero overhead. Follows existing Zod validation patterns with `.optional()` and `.positive()`.

**Tech Stack:** Bun, TypeScript (strict mode), Zod, bun:test

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### rate-limiter.AC2: Per-model configurable budgets
- **rate-limiter.AC2.2 Success:** Rate limit config fields on `ModelConfigSchema` are optional; when absent, provider is not wrapped
- **rate-limiter.AC2.3 Success:** Summarization model can have different rate limits than the main model
- **rate-limiter.AC2.4 Failure:** Invalid rate limit config values (zero, negative) are rejected by Zod validation

---

<!-- START_TASK_1 -->
### Task 1: Add rate limit fields to ModelConfigSchema and SummarizationConfigSchema

**Verifies:** rate-limiter.AC2.2, rate-limiter.AC2.3, rate-limiter.AC2.4

**Files:**
- Modify: `src/config/schema.ts:13-18` (ModelConfigSchema)
- Modify: `src/config/schema.ts:62-93` (SummarizationConfigSchema)

**Implementation:**

Add four optional rate limit fields to `ModelConfigSchema` at `src/config/schema.ts:13-18`. The fields are:

- `requests_per_minute`: Optional positive integer
- `input_tokens_per_minute`: Optional positive integer
- `output_tokens_per_minute`: Optional positive integer
- `min_output_reserve`: Optional positive integer (default not set at schema level — default applied at runtime in Phase 5)

```typescript
const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  requests_per_minute: z.number().int().positive().optional(),
  input_tokens_per_minute: z.number().int().positive().optional(),
  output_tokens_per_minute: z.number().int().positive().optional(),
  min_output_reserve: z.number().int().positive().optional(),
});
```

Add the same four fields to `SummarizationConfigSchema` at `src/config/schema.ts:62-93`, after the existing fields (before the importance scoring weights section):

```typescript
const SummarizationConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  requests_per_minute: z.number().int().positive().optional(),
  input_tokens_per_minute: z.number().int().positive().optional(),
  output_tokens_per_minute: z.number().int().positive().optional(),
  min_output_reserve: z.number().int().positive().optional(),
  chunk_size: z.number().int().positive().default(20),
  // ... rest of existing fields unchanged
});
```

No changes needed to `AppConfigSchema` composition — `ModelConfigSchema` and `SummarizationConfigSchema` are already wired in. The inferred types will automatically include the new optional fields.

No changes needed to `src/config/config.ts` — the type re-exports at line 58 use the schema types directly, so they pick up the new fields automatically.

**Testing:**

Tests to write in `src/config/schema.test.ts` (add a new `describe` block):

- **rate-limiter.AC2.2:** Parse full `AppConfigSchema` config with no rate limit fields on `[model]`. Verify parse succeeds and rate limit fields are `undefined`.
- **rate-limiter.AC2.2:** Parse config with all four rate limit fields on `[model]`. Verify values are preserved.
- **rate-limiter.AC2.3:** Parse config with rate limit fields on `[model]` and different rate limit fields on `[summarization]`. Verify both parse independently with their own values.
- **rate-limiter.AC2.4:** Parse config with `requests_per_minute: 0` on `[model]`. Verify Zod throws (`.positive()` rejects zero).
- **rate-limiter.AC2.4:** Parse config with `input_tokens_per_minute: -100` on `[model]`. Verify Zod throws (`.positive()` rejects negative).
- **rate-limiter.AC2.4:** Parse config with `output_tokens_per_minute: 1.5` on `[model]`. Verify Zod throws (`.int()` rejects non-integer).

Follow existing test patterns: test at `AppConfigSchema.parse()` level with full valid base config for required fields (`model`, `embedding`, `database`).

**Verification:**

Run: `bun test src/config/schema.test.ts`
Expected: All tests pass (new + existing)

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(config): add optional rate limit fields to model and summarization schemas`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update config.toml.example

**Verifies:** None (infrastructure/documentation)

**Files:**
- Modify: `config.toml.example:9-11` (model section)
- Modify: `config.toml.example:28-48` (summarization section)

**Implementation:**

Add commented rate limit fields to the `[model]` section in `config.toml.example` after the existing fields (after line 11):

```toml
[model]
provider = "anthropic"
name = "claude-sonnet-4-5-20250514"
# requests_per_minute = 50
# input_tokens_per_minute = 40000
# output_tokens_per_minute = 8000
# min_output_reserve = 1024
```

Add commented rate limit fields to the `[summarization]` section. Place them after the `base_url` field and before `chunk_size`, keeping rate limit fields grouped together:

```toml
# [summarization]
# provider = "openai-compat"
# name = "olmo-3:7b-think"
# base_url = "http://192.168.1.6:11434/v1"
# requests_per_minute = 30
# input_tokens_per_minute = 20000
# output_tokens_per_minute = 4000
# min_output_reserve = 512
# chunk_size = 20
```

**Verification:**

Visual inspection: the example file is valid TOML when uncommented.

**Commit:** `docs: add rate limit fields to config.toml.example`

<!-- END_TASK_2 -->
