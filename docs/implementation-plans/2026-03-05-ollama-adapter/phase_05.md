# Ollama Model Provider Adapter Implementation Plan

**Goal:** Make Ollama a first-class model provider in Constellation, sitting alongside Anthropic and OpenAI-compat behind the `ModelProvider` port.

**Architecture:** Single-file adapter at `src/model/ollama.ts` using raw `fetch()` against Ollama's native `/api/chat` endpoint. Follows the port/adapter pattern established by `src/model/anthropic.ts` and `src/model/openai-compat.ts`. Functional Core / Imperative Shell with file-level annotations.

**Tech Stack:** Bun (TypeScript, ESM), Zod for config validation, raw `fetch()` for HTTP (no SDK dependency)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ollama-adapter.AC6: Composition
- **ollama-adapter.AC6.1 Success:** `createRateLimitedProvider` wraps Ollama adapter without modification
- **ollama-adapter.AC6.2 Success:** Summarization config with `provider = "ollama"` creates working `ModelProvider` through existing `src/index.ts` composition

---

## Phase 5: End-to-End Verification

<!-- START_TASK_1 -->
### Task 1: Rate limiter composition test

**Verifies:** ollama-adapter.AC6.1

**Files:**
- Modify: `src/model/ollama.test.ts` (add composition test)

**Implementation:**

Test that `createRateLimitedProvider` (from `src/rate-limit/provider.ts`) wraps the Ollama adapter without error. The rate limiter takes any `ModelProvider` and returns a wrapped `ModelProvider & { getStatus() }`. This is a structural test — it verifies composition works, not that the rate limiter's internal logic is correct (that's already tested in `src/rate-limit/`).

```typescript
import { createRateLimitedProvider } from "../rate-limit/provider.js";
import { createOllamaAdapter } from "./ollama.js";

describe("ollama-adapter.AC6: Composition", () => {
  describe("ollama-adapter.AC6.1: Rate limiter wraps Ollama adapter", () => {
    it("should wrap Ollama adapter with rate limiter without error", () => {
      const adapter = createOllamaAdapter({
        provider: "ollama",
        name: "llama3.1:8b",
      });

      const rateLimited = createRateLimitedProvider(adapter, {
        requestsPerMinute: 30,
        inputTokensPerMinute: 20000,
        outputTokensPerMinute: 4000,
      });

      expect(rateLimited.complete).toBeFunction();
      expect(rateLimited.stream).toBeDefined();
      expect(rateLimited.getStatus).toBeFunction();
    });
  });
});
```

This verifies that the Ollama adapter satisfies the `ModelProvider` interface contract expected by `createRateLimitedProvider`. No HTTP calls are made — the test only verifies composition.

**Testing:**

- ollama-adapter.AC6.1: `createRateLimitedProvider` wraps the Ollama adapter and returns a valid `ModelProvider` with `complete`, `stream`, and `getStatus` methods

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

**Commit:** `test: verify rate limiter composition with ollama adapter`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Summarization provider creation test

**Verifies:** ollama-adapter.AC6.2

**Files:**
- Modify: `src/model/ollama.test.ts` (add summarization composition test)

**Implementation:**

Test that the composition path used in `src/index.ts:430-451` works for Ollama. The composition root creates a summarization provider by calling `createModelProvider()` with the summarization config fields mapped to a `ModelConfig` shape:

```typescript
createModelProvider({
  provider: config.summarization.provider,
  name: config.summarization.name,
  api_key: config.summarization.api_key,
  base_url: config.summarization.base_url,
})
```

Test that this path works for `provider: "ollama"`:

```typescript
import { createModelProvider } from "./factory.js";

describe("ollama-adapter.AC6.2: Summarization provider creation", () => {
  it("should create working ModelProvider from summarization config with provider ollama", () => {
    const provider = createModelProvider({
      provider: "ollama",
      name: "llama3.1:8b",
      base_url: "http://localhost:11434",
    });

    expect(provider.complete).toBeFunction();
    expect(provider.stream).toBeDefined();
  });

  it("should create ModelProvider without base_url (uses default)", () => {
    const provider = createModelProvider({
      provider: "ollama",
      name: "llama3.1:8b",
    });

    expect(provider.complete).toBeFunction();
  });

  it("should create ModelProvider without api_key (no auth required)", () => {
    const provider = createModelProvider({
      provider: "ollama",
      name: "llama3.1:8b",
    });

    expect(provider.complete).toBeFunction();
  });
});
```

**Testing:**

- ollama-adapter.AC6.2: `createModelProvider({ provider: "ollama", name: "...", base_url: "..." })` returns a valid `ModelProvider`
- Factory creates adapter without `base_url` (runtime default applied)
- Factory creates adapter without `api_key` (no auth required for Ollama)

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-checks without errors

Run: `bun test`
Expected: All existing tests still pass (no regressions)

**Commit:** `test: verify summarization composition with ollama provider`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update CLAUDE.md documentation

**Files:**
- Modify: `src/model/CLAUDE.md` (add Ollama adapter to documentation)

**Implementation:**

Update the model module's CLAUDE.md to reflect the new Ollama adapter. Add to the relevant sections:

**Contracts section** — add `createOllamaAdapter` to the "Exposes" list.

**Dependencies section** — note that Ollama adapter uses raw `fetch()` (no SDK dependency), same as the embedding adapter.

**Key Files section** — add `ollama.ts` entry:
```
- `ollama.ts` -- Ollama adapter using native `/api/chat` endpoint
```

**Key Decisions section** — add note about native API vs OpenAI-compatible shim:
```
- Ollama native `/api/chat` over `/v1` shim: The OpenAI-compatible `/v1` endpoint silently drops tool calls during streaming. The native endpoint avoids this bug.
```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors (documentation change only)

**Commit:** `docs: add ollama adapter to model module CLAUDE.md`
<!-- END_TASK_3 -->
