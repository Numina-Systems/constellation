# Web Tools Implementation Plan — Phase 4: Fallback Chain

**Goal:** Sequential provider fallback with configuration-driven ordering and automatic skipping of unconfigured providers.

**Architecture:** `createSearchChain(config)` factory creates provider adapters based on which API keys/endpoints are configured, orders them in the chain, and returns a `SearchProvider`-compatible object. On search, iterates providers in order — first success wins, unconfigured are skipped, all-fail returns aggregated error.

**Tech Stack:** TypeScript, Bun

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### web-tools.AC3: Fallback chain tries providers sequentially
- **web-tools.AC3.1 Success:** Chain calls providers in configured order; first success is returned
- **web-tools.AC3.2 Success:** Unconfigured providers (missing API key/endpoint) are silently skipped
- **web-tools.AC3.3 Success:** Response includes provider name indicating which provider answered
- **web-tools.AC3.4 Failure:** When all providers fail, error lists each provider and its failure reason

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/web/chain.ts` — search chain implementation

**Verifies:** web-tools.AC3.1, web-tools.AC3.2, web-tools.AC3.3, web-tools.AC3.4

**Files:**
- Create: `src/web/chain.ts`

**Implementation:**

Factory function `createSearchChain(config)` that:

1. Builds an ordered array of `SearchProvider` instances based on which credentials are configured:
   - If `config.brave_api_key` is set → create `BraveAdapter`
   - If `config.tavily_api_key` is set → create `TavilyAdapter`
   - If `config.searxng_endpoint` is set → create `SearXNGAdapter`
   - Always include `DuckDuckGoAdapter` as last fallback (requires no credentials)

2. Returns an object with a `search(query, limit)` method that:
   - Iterates providers in order
   - Calls `provider.search(query, limit)`
   - On success, returns the `SearchResponse` (which includes `provider` name — satisfying AC3.3)
   - On failure, records `{ provider: name, error: message }` and continues to next
   - If all fail, throws an error listing each provider and its failure reason

The config parameter shape matches `WebConfig` from the schema (Phase 1).

```typescript
// pattern: Imperative Shell

import type { SearchProvider, SearchResponse } from "./types.ts";
import { createBraveAdapter } from "./providers/brave.ts";
import { createTavilyAdapter } from "./providers/tavily.ts";
import { createSearXNGAdapter } from "./providers/searxng.ts";
import { createDuckDuckGoAdapter } from "./providers/duckduckgo.ts";

type SearchChainConfig = {
  readonly brave_api_key?: string;
  readonly tavily_api_key?: string;
  readonly searxng_endpoint?: string;
};

type SearchChain = {
  search(query: string, limit: number): Promise<SearchResponse>;
  readonly providers: ReadonlyArray<string>;
};

export function createSearchChain(config: SearchChainConfig): SearchChain {
  const providers: Array<SearchProvider> = [];

  if (config.brave_api_key) {
    providers.push(createBraveAdapter(config.brave_api_key));
  }
  if (config.tavily_api_key) {
    providers.push(createTavilyAdapter(config.tavily_api_key));
  }
  if (config.searxng_endpoint) {
    providers.push(createSearXNGAdapter(config.searxng_endpoint));
  }
  providers.push(createDuckDuckGoAdapter());

  return {
    providers: providers.map((p) => p.name),

    async search(query: string, limit: number): Promise<SearchResponse> {
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of providers) {
        try {
          return await provider.search(query, limit);
        } catch (err) {
          errors.push({
            provider: provider.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const summary = errors
        .map((e) => `${e.provider}: ${e.error}`)
        .join("; ");
      throw new Error(`all search providers failed: ${summary}`);
    },
  };
}
```

Note: This is `Imperative Shell` because the `search` method calls adapters that perform I/O. It orchestrates I/O operations (sequential fallback across providers), which is Imperative Shell by FCIS convention.

**Step 1: Create the file**

**Step 2: Verify build**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/chain.ts
git commit -m "feat(web): add search chain with sequential fallback"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel exports

**Files:**
- Modify: `src/web/index.ts` (add chain export)

**Step 1: Add export**

```typescript
export { createSearchChain } from "./chain.ts";
```

**Step 2: Verify build**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/index.ts
git commit -m "feat(web): export createSearchChain from barrel"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Write search chain tests

**Verifies:** web-tools.AC3.1, web-tools.AC3.2, web-tools.AC3.3, web-tools.AC3.4

**Files:**
- Create: `src/web/chain.test.ts`

**Testing:**

For chain tests, don't use real adapters — create mock `SearchProvider` objects directly. This tests chain logic in isolation without HTTP concerns (those are covered by provider tests in Phase 3).

Create helper mock providers:

```typescript
function createMockProvider(
  name: string,
  behavior: "success" | "error",
  results?: Array<{ title: string; url: string; snippet: string }>,
): SearchProvider {
  return {
    name,
    search: async (_query: string, _limit: number) => {
      if (behavior === "error") {
        throw new Error(`${name} failed`);
      }
      return { results: results ?? [], provider: name };
    },
  };
}
```

However, `createSearchChain` constructs its own providers from config. To test chain logic with mock providers, either:
- (a) Refactor to accept pre-built providers (adds a second overload or parameter)
- (b) Override `globalThis.fetch` so the real adapters get controlled responses

Option (b) is better — it keeps the public API clean and tests closer to real usage.

But actually, the chain's interesting logic is: ordering, skipping unconfigured, aggregating errors. We can test this by providing config with no API keys (only DDG gets created) and mocking fetch at that level.

A more practical approach: test via `createSearchChain` with various configs and mock `globalThis.fetch`:

- **web-tools.AC3.1:** Config with `brave_api_key` set. Mock fetch to return Brave-format success. Assert result has `provider: "brave"` (first in chain).
- **web-tools.AC3.1 (fallback):** Config with `brave_api_key` set. Mock fetch to fail for Brave URL, succeed for DDG URL. Assert result has `provider: "duckduckgo"` (fell through).
- **web-tools.AC3.2:** Config with no API keys at all. Assert chain only has `["duckduckgo"]` in `providers` list. Mock fetch to succeed for DDG. Assert success.
- **web-tools.AC3.3:** Any successful search — assert `provider` field in response matches the adapter that answered.
- **web-tools.AC3.4:** Config with `brave_api_key`. Mock all fetches to fail. Assert thrown error message contains both "brave" and "duckduckgo" with their failure reasons.

**Verification:**
Run: `bun test src/web/chain.test.ts`
Expected: All tests pass

**Commit:** `test(web): add search chain tests covering AC3.1-AC3.4`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
