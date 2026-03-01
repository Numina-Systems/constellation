# Web Tools Implementation Plan — Phase 3: Search Providers

**Goal:** Implement four search provider adapters behind the `SearchProvider` port interface.

**Architecture:** Each adapter is a factory function returning a `SearchProvider` object. Adapters normalise provider-specific response formats into the shared `SearchResponse` type. All use raw `fetch()` for HTTP — no SDK dependencies.

**Tech Stack:** TypeScript, Bun, raw `fetch()`

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-03-01

**External dependency research:** 2026-03-01
- **Brave Search API:** `GET https://api.search.brave.com/res/v1/web/search?q=...&count=N`, auth via `X-Subscription-Token` header, results in `response.web.results[]` with `title`, `url`, `description` fields
- **Tavily API:** `POST https://api.tavily.com/search` with JSON body, auth via `Authorization: Bearer tvly-...` header, results in `response.results[]` with `title`, `url`, `content`, `score` fields
- **SearXNG:** `GET <endpoint>/search?q=...&format=json`, no auth (self-hosted), results in `response.results[]` with `title`, `url`, `snippet` fields
- **DuckDuckGo:** `POST https://html.duckduckgo.com/html/` with form-encoded body, no auth but requires realistic User-Agent, parse HTML with `.result__a` (title/url), `.result__snippet` (snippet) CSS selectors

**Note on timeouts:** All search adapters use a hardcoded 30-second timeout (`AbortSignal.timeout(30000)`). This is an intentional default — 30 seconds is generous for search API calls. Unlike `fetch_timeout` (configurable for the fetch pipeline where page sizes vary), search API latency is predictable. A `search_timeout` config field can be added later if needed.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### web-tools.AC1: Search providers return structured results
- **web-tools.AC1.1 Success:** Brave adapter parses API response into SearchResponse with title, url, snippet for each result
- **web-tools.AC1.2 Success:** Tavily adapter parses API response into SearchResponse with title, url, snippet, and score
- **web-tools.AC1.3 Success:** SearXNG adapter parses JSON response into SearchResponse
- **web-tools.AC1.4 Success:** DuckDuckGo adapter parses HTML response into SearchResponse
- **web-tools.AC1.5 Failure:** Provider returns error when API responds with non-2xx status
- **web-tools.AC1.6 Failure:** Provider returns error when response body is unparseable
- **web-tools.AC1.7 Failure:** Provider returns error when request times out

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create Brave Search adapter

**Verifies:** web-tools.AC1.1, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/brave.ts`

**Implementation:**

First, create the providers directory: `mkdir -p src/web/providers`

Factory function `createBraveAdapter(apiKey: string)` returns a `SearchProvider`.

The Brave Search API:
- Endpoint: `GET https://api.search.brave.com/res/v1/web/search`
- Auth: `X-Subscription-Token: <apiKey>` header
- Query params: `q` (query), `count` (limit, max 20)
- Response shape: `{ web: { results: Array<{ title, url, description }> } }`

The adapter should:
1. Build URL with query params `q` and `count`
2. Send GET request with `X-Subscription-Token` header and `AbortSignal.timeout(30000)`
3. Check `response.ok` — if not, throw with status code and status text
4. Parse JSON response
5. Map `response.web.results` to `SearchResult` objects: `title` → `title`, `url` → `url`, `description` → `snippet`
6. Return `{ results, provider: "brave" }`

Handle edge cases:
- `response.web` or `response.web.results` may be absent (no results found) — return empty array
- JSON parse failure — throw with descriptive message
- Timeout via `AbortSignal.timeout` — the AbortError propagates naturally

```typescript
// pattern: Imperative Shell

import type { SearchProvider, SearchResponse } from "../types.ts";

type BraveWebResult = {
  readonly title: string;
  readonly url: string;
  readonly description: string;
};

type BraveApiResponse = {
  readonly web?: {
    readonly results?: ReadonlyArray<BraveWebResult>;
  };
};

export function createBraveAdapter(apiKey: string): SearchProvider {
  return {
    name: "brave",
    async search(query: string, limit: number): Promise<SearchResponse> {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(Math.min(limit, 20)));

      const response = await fetch(url, {
        headers: { "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`brave search failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as BraveApiResponse;
      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));

      return { results, provider: "brave" };
    },
  };
}
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat(web): add Brave Search adapter`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Write Brave adapter tests

**Verifies:** web-tools.AC1.1, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/brave.test.ts`

**Testing:**

Override `globalThis.fetch` to return controlled responses. Save and restore in `beforeEach`/`afterEach`.

Tests for each AC:
- **web-tools.AC1.1:** Mock successful Brave response with 3 results. Assert returned `SearchResponse` has `provider: "brave"`, results array of length 3, each with `title`, `url`, `snippet` mapped from `description`.
- **web-tools.AC1.5:** Mock response with `status: 403`, `ok: false`. Assert adapter throws error containing "403".
- **web-tools.AC1.6:** Mock response with `ok: true` but body that is not valid JSON (e.g., `"not json"`). Assert adapter throws.
- **web-tools.AC1.7:** Mock fetch that throws an `AbortError` (simulating timeout). Assert the error propagates.
- **Empty results:** Mock response with `web: { results: [] }`. Assert empty results array returned.
- **Missing web field:** Mock response with `{}` (no `web` key). Assert empty results array returned.

Follow project pattern: `// pattern: Imperative Shell`, `describe/it/expect` from `bun:test`, AC identifiers in test names.

**Verification:**
Run: `bun test src/web/providers/brave.test.ts`
Expected: All tests pass

**Commit:** `test(web): add Brave adapter tests covering AC1.1, AC1.5-AC1.7`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Create Tavily Search adapter

**Verifies:** web-tools.AC1.2, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/tavily.ts`

**Implementation:**

Factory function `createTavilyAdapter(apiKey: string)` returns a `SearchProvider`.

The Tavily API:
- Endpoint: `POST https://api.tavily.com/search`
- Auth: `Authorization: Bearer <apiKey>` header
- Body (JSON): `{ query, max_results, search_depth: "basic" }`
- Response shape: `{ results: Array<{ title, url, content, score }> }`

The adapter should:
1. Send POST request with JSON body and Bearer auth header
2. Check `response.ok` — throw with status if not
3. Parse JSON response
4. Map `response.results` to `SearchResult`: `title` → `title`, `url` → `url`, `content` → `snippet`, `score` → `score`
5. Return `{ results, provider: "tavily" }`

```typescript
// pattern: Imperative Shell

import type { SearchProvider, SearchResponse } from "../types.ts";

type TavilyResult = {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score: number;
};

type TavilyApiResponse = {
  readonly results: ReadonlyArray<TavilyResult>;
};

export function createTavilyAdapter(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(query: string, limit: number): Promise<SearchResponse> {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: limit,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`tavily search failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as TavilyApiResponse;
      const results = (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        score: r.score,
      }));

      return { results, provider: "tavily" };
    },
  };
}
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat(web): add Tavily Search adapter`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Write Tavily adapter tests

**Verifies:** web-tools.AC1.2, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/tavily.test.ts`

**Testing:**

Same mock fetch pattern as Brave tests.

Tests for each AC:
- **web-tools.AC1.2:** Mock successful Tavily response with results including `score` field. Assert returned `SearchResponse` has `provider: "tavily"`, results with `snippet` mapped from `content`, `score` preserved.
- **web-tools.AC1.5:** Mock non-2xx response (401 Unauthorized). Assert adapter throws error containing "401".
- **web-tools.AC1.6:** Mock unparseable response body. Assert adapter throws.
- **web-tools.AC1.7:** Mock fetch that throws `AbortError`. Assert error propagates.

**Verification:**
Run: `bun test src/web/providers/tavily.test.ts`
Expected: All tests pass

**Commit:** `test(web): add Tavily adapter tests covering AC1.2, AC1.5-AC1.7`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Create SearXNG adapter

**Verifies:** web-tools.AC1.3, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/searxng.ts`

**Implementation:**

Factory function `createSearXNGAdapter(endpoint: string)` returns a `SearchProvider`.

The SearXNG API:
- Endpoint: `GET <endpoint>/search?q=...&format=json`
- Auth: none (self-hosted instance)
- Response shape: `{ results: Array<{ title, url, snippet }> }`

```typescript
// pattern: Imperative Shell

import type { SearchProvider, SearchResponse } from "../types.ts";

type SearXNGResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
};

type SearXNGApiResponse = {
  readonly results: ReadonlyArray<SearXNGResult>;
};

export function createSearXNGAdapter(endpoint: string): SearchProvider {
  return {
    name: "searxng",
    async search(query: string, limit: number): Promise<SearchResponse> {
      const url = new URL("/search", endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");

      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`searxng search failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as SearXNGApiResponse;
      const results = (data.results ?? []).slice(0, limit).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));

      return { results, provider: "searxng" };
    },
  };
}
```

Note: SearXNG doesn't support a `count`/`limit` parameter in the API, so we slice results client-side.

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat(web): add SearXNG adapter`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Write SearXNG adapter tests

**Verifies:** web-tools.AC1.3, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/searxng.test.ts`

**Testing:**

Tests for each AC:
- **web-tools.AC1.3:** Mock successful SearXNG response. Assert `provider: "searxng"`, results mapped correctly.
- **web-tools.AC1.5:** Mock non-2xx (403 Forbidden — JSON format disabled). Assert error.
- **web-tools.AC1.6:** Mock unparseable body. Assert error.
- **web-tools.AC1.7:** Mock timeout. Assert error propagates.
- **Limit enforcement:** Mock response with 20 results, request with limit 5. Assert only 5 results returned.

**Verification:**
Run: `bun test src/web/providers/searxng.test.ts`
Expected: All tests pass

**Commit:** `test(web): add SearXNG adapter tests covering AC1.3, AC1.5-AC1.7`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Create DuckDuckGo HTML adapter

**Verifies:** web-tools.AC1.4, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/duckduckgo.ts`

**Implementation:**

Factory function `createDuckDuckGoAdapter()` returns a `SearchProvider`. No API key required.

The DuckDuckGo HTML endpoint:
- Endpoint: `POST https://html.duckduckgo.com/html/`
- Body: URL-encoded form data with `q` field
- Auth: none, but requires realistic `User-Agent` header
- Response: HTML page, parse results with linkedom

The adapter:
1. POST form-encoded body `q=<query>` with browser-like `User-Agent`
2. Check `response.ok`
3. Read HTML body as text
4. Parse with `parseHTML()` from linkedom (already installed in Phase 2)
5. Select all `.result` elements
6. For each, extract title from `.result__a` text, URL from `.result__a` href, snippet from `.result__snippet` text
7. Slice to `limit` results
8. Return `{ results, provider: "duckduckgo" }`

Handle DDG-specific URL encoding: DDG often wraps URLs in a redirect (`//duckduckgo.com/l/?uddg=<encoded_url>`). Extract the actual URL from the `uddg` query parameter when present.

```typescript
// pattern: Imperative Shell

import { parseHTML } from "linkedom";
import type { SearchProvider, SearchResponse } from "../types.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractUrl(href: string): string {
  if (href.includes("uddg=")) {
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      // fall through to raw href
    }
  }
  return href;
}

export function createDuckDuckGoAdapter(): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string, limit: number): Promise<SearchResponse> {
      const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `q=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`duckduckgo search failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const { document } = parseHTML(html);

      const resultElements = document.querySelectorAll(".result");
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      for (const el of Array.from(resultElements).slice(0, limit)) {
        const anchor = el.querySelector(".result__a");
        const snippetEl = el.querySelector(".result__snippet");

        if (!anchor) continue;

        const title = anchor.textContent?.trim() ?? "";
        const rawHref = anchor.getAttribute("href") ?? "";
        const url = extractUrl(rawHref);
        const snippet = snippetEl?.textContent?.trim() ?? "";

        if (title && url) {
          results.push({ title, url, snippet });
        }
      }

      return { results, provider: "duckduckgo" };
    },
  };
}
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat(web): add DuckDuckGo HTML scraping adapter`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Write DuckDuckGo adapter tests

**Verifies:** web-tools.AC1.4, web-tools.AC1.5, web-tools.AC1.6, web-tools.AC1.7

**Files:**
- Create: `src/web/providers/duckduckgo.test.ts`

**Testing:**

Tests for each AC:
- **web-tools.AC1.4:** Mock fetch returning realistic DDG HTML with `.result` divs containing `.result__a` and `.result__snippet`. Assert results parsed correctly with title, url, snippet.
- **web-tools.AC1.4 (URL extraction):** Mock HTML where `.result__a` href uses DDG redirect format (`//duckduckgo.com/l/?uddg=<encoded>`). Assert URL is correctly extracted and decoded.
- **web-tools.AC1.5:** Mock non-2xx response. Assert error.
- **web-tools.AC1.6:** Mock response with HTML that has no `.result` elements. Assert empty results (not an error — just no results).
- **web-tools.AC1.7:** Mock timeout. Assert error propagates.
- **Limit enforcement:** Mock HTML with many results, request limit 3. Assert only 3 returned.

Provide realistic HTML test fixtures inline in the test file. Example fixture:

```typescript
const MOCK_DDG_HTML = `
<html><body>
<div id="links">
  <div class="result">
    <a class="result__a" href="https://example.com/page1">Example Page 1</a>
    <a class="result__snippet">This is the first result snippet.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2">Example Page 2</a>
    <a class="result__snippet">This is the second result.</a>
  </div>
</div>
</body></html>`;
```

**Verification:**
Run: `bun test src/web/providers/duckduckgo.test.ts`
Expected: All tests pass

**Commit:** `test(web): add DuckDuckGo adapter tests covering AC1.4-AC1.7`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_TASK_9 -->
### Task 9: Update barrel exports for providers

**Files:**
- Modify: `src/web/index.ts` (add provider exports)

**Step 1: Add exports**

```typescript
export { createBraveAdapter } from "./providers/brave.ts";
export { createTavilyAdapter } from "./providers/tavily.ts";
export { createSearXNGAdapter } from "./providers/searxng.ts";
export { createDuckDuckGoAdapter } from "./providers/duckduckgo.ts";
```

**Step 2: Verify build**

Run: `bun run build`
Expected: No errors

**Step 3: Verify all provider tests pass**

Run: `bun test src/web/`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/web/index.ts
git commit -m "feat(web): export all search provider adapters from barrel"
```
<!-- END_TASK_9 -->
