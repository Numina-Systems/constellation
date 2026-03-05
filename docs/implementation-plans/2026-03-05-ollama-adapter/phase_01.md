# Ollama Model Provider Adapter Implementation Plan

**Goal:** Make Ollama a first-class model provider in Constellation, sitting alongside Anthropic and OpenAI-compat behind the `ModelProvider` port.

**Architecture:** Single-file adapter at `src/model/ollama.ts` using raw `fetch()` against Ollama's native `/api/chat` endpoint. Follows the port/adapter pattern established by `src/model/anthropic.ts` and `src/model/openai-compat.ts`. Functional Core / Imperative Shell with file-level annotations.

**Tech Stack:** Bun (TypeScript, ESM), Zod for config validation, raw `fetch()` for HTTP (no SDK dependency)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ollama-adapter.AC1: Config validation
- **ollama-adapter.AC1.1 Success:** `provider = "ollama"` validates in `[model]` config section
- **ollama-adapter.AC1.2 Success:** `provider = "ollama"` validates in `[summarization]` config section
- **ollama-adapter.AC1.3 Success:** `base_url` defaults to `http://localhost:11434` when omitted
- **ollama-adapter.AC1.4 Success:** Config with `api_key` omitted validates (no auth required)

---

## Phase 1: Config Schema and Factory Wiring

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add "ollama" to config schema provider enums

**Verifies:** ollama-adapter.AC1.1, ollama-adapter.AC1.2, ollama-adapter.AC1.3, ollama-adapter.AC1.4

**Files:**
- Modify: `src/config/schema.ts:14` (ModelConfigSchema provider enum)
- Modify: `src/config/schema.ts:69` (SummarizationConfigSchema provider enum)

**Implementation:**

In `src/config/schema.ts`, update the `provider` enum in `ModelConfigSchema` (line 14) from:
```typescript
provider: z.enum(["anthropic", "openai-compat"]),
```
to:
```typescript
provider: z.enum(["anthropic", "openai-compat", "ollama"]),
```

Apply the same change to `SummarizationConfigSchema` (line 69).

No other schema changes are needed. The `api_key` field is already `z.string().optional()` (line 16), so omitting it for Ollama already validates. The `base_url` field is already `z.string().url().optional()` (line 17) — the adapter will apply a default at runtime when omitted, not at the schema level (consistent with how the existing embedding Ollama adapter handles its endpoint default in `src/embedding/ollama.ts:6`).

**Testing:**

Tests must verify each AC listed above:
- ollama-adapter.AC1.1: Config with `provider = "ollama"` in `[model]` section parses without error
- ollama-adapter.AC1.2: Config with `provider = "ollama"` in `[summarization]` section parses without error
- ollama-adapter.AC1.3: Config with `provider = "ollama"` and no `base_url` parses (base_url is optional at schema level; adapter applies runtime default)
- ollama-adapter.AC1.4: Config with `provider = "ollama"` and no `api_key` parses without error

Add tests in `src/config/schema.test.ts`. Follow the existing test pattern using `AppConfigSchema.parse()` with full config objects (see existing tests at lines 6-420 for the pattern). Test file: `src/config/schema.test.ts` (unit)

**Verification:**
Run: `bun test src/config/schema.test.ts`
Expected: All tests pass, including new Ollama config tests

**Commit:** `feat: add ollama to model and summarization provider config enums`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create stub Ollama adapter and wire factory

**Files:**
- Create: `src/model/ollama.ts`
- Modify: `src/model/factory.ts:5-6` (add import)
- Modify: `src/model/factory.ts:12-13` (add switch case)
- Modify: `src/model/index.ts:25` (add barrel export)
- Modify: `src/model/factory.test.ts:48-50` (update error message pattern)

**Implementation:**

Create `src/model/ollama.ts` as a stub:
```typescript
// pattern: Imperative Shell

import type { ModelConfig } from "../config/schema.js";
import type { ModelProvider } from "./types.js";

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  throw new Error(
    `Ollama adapter not yet implemented (model: ${config.name})`
  );
}
```

In `src/model/factory.ts`, add the import after the existing adapter imports (line 6):
```typescript
import { createOllamaAdapter } from "./ollama.js";
```

Add the new case to the switch statement after the `"openai-compat"` case (after line 13):
```typescript
case "ollama":
  return createOllamaAdapter(config);
```

Update the default error message (line 16) to include `'ollama'`:
```typescript
`Unknown model provider: ${config.provider}. Valid providers are: 'anthropic', 'openai-compat', 'ollama'`
```

Add the barrel export in `src/model/index.ts` after the existing adapter exports (after line 24):
```typescript
export { createOllamaAdapter } from "./ollama.js";
```

Update the existing factory test in `src/model/factory.test.ts`. The test at line 48-50 asserts the error message matches `/Valid providers are: 'anthropic', 'openai-compat'/` — update it to include `'ollama'`:
```typescript
expect(() => createModelProvider(config)).toThrow(
  /Valid providers are: 'anthropic', 'openai-compat', 'ollama'/
);
```

Also add a new test case for Ollama provider routing (after the existing OpenAI-compat test at line 36):
```typescript
it("returns Ollama adapter for 'ollama' provider", () => {
  const config: ModelConfig = {
    provider: "ollama",
    name: "llama3.1:8b",
  };

  const provider = createModelProvider(config);

  expect(provider).toBeDefined();
  expect(provider).toHaveProperty("complete");
  expect(provider).toHaveProperty("stream");
});
```

Note: The stub adapter throws on `complete()`/`stream()` calls, but the factory test only verifies the provider object is returned with the correct interface — it does not call the methods.

**Note on environment variable overrides:** The existing config loader in `src/config/config.ts` only provides env overrides for API keys and secrets (e.g., `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`). No `base_url` overrides exist for any provider. Since Ollama doesn't require authentication, no `OLLAMA_API_KEY` override is needed. Adding an `OLLAMA_BASE_URL` override is intentionally out of scope for this adapter — it would be a new convention not established by any existing provider. Users can configure `base_url` directly in `config.toml`.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

Run: `bun test src/model/factory.test.ts`
Expected: All factory tests pass (including updated error message pattern)

**Commit:** `feat: create stub ollama adapter and wire into model factory`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add Ollama examples to config.toml.example

**Files:**
- Modify: `config.toml.example` (add commented Ollama model example after `[model]` section)
- Modify: `config.toml.example` (add commented Ollama summarization example after existing `[summarization]` block)

**Implementation:**

After the existing `[model]` section (after the rate limit comment lines), add a commented-out Ollama model example:
```toml
# Ollama (local models):
# [model]
# provider = "ollama"
# name = "llama3.1:8b"
# base_url = "http://localhost:11434"
```

In the `[summarization]` section, add a commented-out Ollama summarization example after the existing commented-out OpenAI-compat summarization block (before the `[bluesky]` section):
```toml
# Ollama summarization (local models):
# [summarization]
# provider = "ollama"
# name = "llama3.1:8b"
# base_url = "http://localhost:11434"
# chunk_size = 20
# keep_recent = 5
# max_summary_tokens = 1024
```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors (config.toml.example is not validated at build time, but verify no accidental changes to source)

**Commit:** `docs: add ollama model provider examples to config.toml.example`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
