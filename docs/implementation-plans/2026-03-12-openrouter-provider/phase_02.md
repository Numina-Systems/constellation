# OpenRouter Provider Implementation Plan — Phase 2

**Goal:** Accept `"openrouter"` as a provider with nested OpenRouter-specific configuration and env var override.

**Architecture:** Extend Zod schemas to include `"openrouter"` in provider enums, add optional `openrouter` nested config object to `ModelConfigSchema`, and add `OPENROUTER_API_KEY` env override in `config.ts`.

**Tech Stack:** TypeScript, Zod, Bun

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-provider.AC1: Config schema accepts OpenRouter provider
- **openrouter-provider.AC1.1 Success:** Config with `provider = "openrouter"` and `name = "anthropic/claude-sonnet-4"` parses successfully
- **openrouter-provider.AC1.2 Success:** Nested `[model.openrouter]` with sort/allow_fallbacks/referer/title parses successfully
- **openrouter-provider.AC1.3 Success:** `OPENROUTER_API_KEY` env var overrides config `api_key` when provider is `"openrouter"`
- **openrouter-provider.AC1.4 Failure:** Config with `sort = "invalid"` is rejected by schema validation

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `"openrouter"` to provider enums and OpenRouter options schema

**Verifies:** openrouter-provider.AC1.1, openrouter-provider.AC1.2, openrouter-provider.AC1.4

**Files:**
- Modify: `src/config/schema.ts:15-24` (ModelConfigSchema)
- Modify: `src/config/schema.ts:70-71` (SummarizationConfigSchema provider enum)
- Modify: `src/config/schema.ts:198-211` (type exports)

**Implementation:**

In `src/config/schema.ts`:

1. Add `"openrouter"` to the `ModelConfigSchema` provider enum (line 16):
   ```typescript
   provider: z.enum(["anthropic", "openai-compat", "ollama", "openrouter"]),
   ```

2. Add optional `openrouter` nested object to `ModelConfigSchema` (after line 23, before the closing `})`):
   ```typescript
   openrouter: z.object({
     sort: z.enum(["price", "throughput", "latency"]).optional(),
     allow_fallbacks: z.boolean().optional(),
     referer: z.string().optional(),
     title: z.string().optional(),
   }).optional(),
   ```

3. Add `"openrouter"` to the `SummarizationConfigSchema` provider enum (line 71):
   ```typescript
   provider: z.enum(["anthropic", "openai-compat", "ollama", "openrouter"]),
   ```

4. Add `OpenRouterConfig` type export (after the existing type exports at line 209):
   ```typescript
   export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;
   ```
   Note: Extract the openrouter nested object as a named schema `OpenRouterConfigSchema` before using it in `ModelConfigSchema` so the type can be exported independently.

5. Add `OpenRouterConfigSchema` to the schema exports at line 211.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add openrouter provider to config schema`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `OPENROUTER_API_KEY` env override in `config.ts`

**Verifies:** openrouter-provider.AC1.3

**Files:**
- Modify: `src/config/config.ts:14-24` (model env key selection)
- Modify: `src/config/config.ts:69` (type re-exports)

**Implementation:**

In `src/config/config.ts`:

1. Update the model API key env override logic (lines 16-19) to include the `"openrouter"` case. The current code:
   ```typescript
   const modelEnvKey =
     modelProvider === "openai-compat"
       ? process.env["OPENAI_COMPAT_API_KEY"]
       : process.env["ANTHROPIC_API_KEY"];
   ```
   Should become a lookup that maps provider to its env var:
   ```typescript
   const providerEnvKeys: Record<string, string> = {
     "openai-compat": "OPENAI_COMPAT_API_KEY",
     "openrouter": "OPENROUTER_API_KEY",
     "anthropic": "ANTHROPIC_API_KEY",
   };
   const envKeyName = modelProvider ? providerEnvKeys[modelProvider] : undefined;
   const modelEnvKey = envKeyName ? process.env[envKeyName] : undefined;
   ```

2. Add `OpenRouterConfig` to the type re-export at line 69 (modify the existing single-line re-export to include the new type).

**Note:** Summarization model env key override for `"openrouter"` is intentionally out of scope, consistent with existing behaviour — no summarization-specific env override exists for any provider currently.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add OPENROUTER_API_KEY env override`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Config schema tests

**Verifies:** openrouter-provider.AC1.1, openrouter-provider.AC1.2, openrouter-provider.AC1.3, openrouter-provider.AC1.4

**Files:**
- Create: `src/config/schema.test.ts`

**Implementation:**

Create tests using `bun:test` framework, importing `ModelConfigSchema` from `"./schema.js"`. No existing config tests to follow — use the model adapter test patterns (describe/it blocks, direct schema parsing).

Tests must verify each AC listed above:
- openrouter-provider.AC1.1: Parse `{ provider: "openrouter", name: "anthropic/claude-sonnet-4" }` through `ModelConfigSchema.parse()` and verify it succeeds
- openrouter-provider.AC1.2: Parse config with nested `openrouter: { sort: "price", allow_fallbacks: false, referer: "https://myapp.com", title: "My App" }` and verify all fields are present in the result
- openrouter-provider.AC1.3: This requires testing `loadConfig` with env var set. Since `loadConfig` reads from a file, test by creating a minimal TOML string, writing to a temp file, setting `OPENROUTER_API_KEY` env var, calling `loadConfig`, and asserting the model api_key matches. Alternatively, test the env override logic in isolation by verifying the providerEnvKeys mapping.
- openrouter-provider.AC1.4: Call `ModelConfigSchema.parse({ provider: "openrouter", name: "test", openrouter: { sort: "invalid" } })` and verify it throws a `ZodError`

**Verification:**

Run: `bun test src/config/schema.test.ts`
Expected: All tests pass

**Commit:** `test: add config schema tests for openrouter provider`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
