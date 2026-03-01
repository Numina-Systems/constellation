# Web Tools Implementation Plan — Phase 2: Fetch Pipeline

**Goal:** URL fetching with Readability content extraction, Turndown markdown conversion, character-offset pagination, and TTL-based in-memory caching.

**Architecture:** `createFetcher(config)` factory returns a function closing over an internal cache. Three-stage pipeline: HTTP GET → Readability extraction (with linkedom DOM) → Turndown markdown conversion. Falls back to raw Turndown when Readability cannot extract. Results paginated by character offset.

**Tech Stack:** TypeScript, Bun, `@mozilla/readability`, `linkedom`, `turndown`, `@truto/turndown-plugin-gfm`, `@types/turndown`

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-03-01

**External dependency research:** 2026-03-01
- `@mozilla/readability` v0.6.0 — `new Readability(document).parse()` returns `{ title, content (HTML), textContent, ... } | null`
- `linkedom` v0.18.12 — `parseHTML(html)` returns `{ document, window }`. Known compatibility concerns with Readability (not officially tested), but widely used in practice. Design fallback handles failure.
- `turndown` v7.2.2 — `new TurndownService(options).turndown(html)` converts HTML string or DOM node to markdown. Default export. Needs `@types/turndown` for TS.
- `@truto/turndown-plugin-gfm` — ESM fork of turndown-plugin-gfm. `turndownService.use(gfm)` adds tables, strikethrough, task lists.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### web-tools.AC2: Fetch pipeline converts URLs to paginated markdown
- **web-tools.AC2.1 Success:** Fetcher retrieves HTML page and returns markdown with headings, links, lists, and tables preserved
- **web-tools.AC2.2 Success:** Readability extracts article content from noisy pages (strips nav, ads, sidebars)
- **web-tools.AC2.3 Success:** Large content is paginated with offset and has_more fields; continue_from retrieves next chunk
- **web-tools.AC2.4 Success:** Fetched content is cached; second request within 5 minutes returns cached result without HTTP request
- **web-tools.AC2.5 Success:** Cache entries expire after TTL; request after expiry fetches fresh content
- **web-tools.AC2.6 Failure:** When Readability fails to extract, fetcher falls back to raw Turndown conversion
- **web-tools.AC2.7 Failure:** Non-HTML content type (PDF, image) returns error with content type indicated
- **web-tools.AC2.8 Failure:** Content exceeding max_fetch_size is truncated with truncation noted in result
- **web-tools.AC2.9 Failure:** Fetch timeout returns error

---

<!-- START_TASK_1 -->
### Task 1: Install fetch pipeline dependencies

**Files:**
- Modify: `package.json` (dependencies added by bun)

**Step 1: Install the dependencies**

Run:
```bash
bun add @mozilla/readability linkedom turndown @truto/turndown-plugin-gfm
bun add -d @types/turndown
```

**Step 2: Verify install succeeds**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add readability, linkedom, turndown dependencies"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->
<!-- START_TASK_2 -->
### Task 2: Create `src/web/fetch.ts` — fetch pipeline implementation

**Verifies:** web-tools.AC2.1, web-tools.AC2.2, web-tools.AC2.3, web-tools.AC2.4, web-tools.AC2.5, web-tools.AC2.6, web-tools.AC2.7, web-tools.AC2.8, web-tools.AC2.9

**Files:**
- Create: `src/web/fetch.ts`

**Implementation:**

The fetcher is a factory function `createFetcher(config)` that returns an async function. It closes over an internal `Map<string, FetchCacheEntry>` for caching. The config parameter uses fields from `WebConfig` (defined in Phase 1's schema): `fetch_timeout`, `max_fetch_size`, `cache_ttl`.

The pipeline:

1. **Cache check** — If URL is in cache and entry is within TTL, paginate from cached markdown. Skip HTTP entirely.
2. **HTTP GET** — `fetch(url)` with `AbortSignal.timeout(config.fetch_timeout)`. Check `content-type` header; reject non-HTML with error indicating content type. Check `content-length` if present; if exceeds `max_fetch_size`, proceed but truncate after reading that many bytes.
3. **Read body** — Read response as text. If text length exceeds `max_fetch_size`, truncate and note truncation.
4. **Readability extraction** — Parse HTML with `parseHTML(html)` from linkedom. Pass `document` to `new Readability(document).parse()`. If `parse()` returns `null`, fall back to step 5 with the raw HTML.
5. **Turndown conversion** — Create `TurndownService` with ATX headings, fenced code blocks. Register GFM plugin. Convert the extracted HTML (from Readability's `article.content`) or the raw `document.body.innerHTML` (fallback) to markdown.
6. **Cache store** — Store `{ url, title, markdown, timestamp: Date.now() }` in cache map.
7. **Paginate** — Slice markdown from `offset` by page size (default 8000 chars). Return `FetchResult` with `has_more` and `total_length`.

Key design decisions:
- Page size of 8000 characters (~2000 tokens) keeps individual responses manageable for the agent
- Cache uses lazy eviction (check TTL on access, no sweep)
- `AbortSignal.timeout()` handles fetch timeout (web-tools.AC2.9)
- Content-type check happens before reading body (web-tools.AC2.7)

The file should be annotated `// pattern: Imperative Shell` because it performs HTTP I/O.

The Turndown service should be created once inside the factory (not per-request) since it's stateless after configuration:

```typescript
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.use(gfm);
```

For the Readability + linkedom integration, wrap in try/catch to handle any DOM compatibility issues gracefully:

```typescript
try {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();
  if (article) {
    title = article.title;
    extractedHtml = article.content;
  } else {
    // Readability couldn't extract — use raw body
    extractedHtml = document.body?.innerHTML ?? html;
  }
} catch {
  // linkedom/Readability compatibility issue — fall back to raw HTML
  extractedHtml = html;
}
```

The function signature:

```typescript
export function createFetcher(config: {
  readonly fetch_timeout: number;
  readonly max_fetch_size: number;
  readonly cache_ttl: number;
}): (url: string, offset?: number) => Promise<FetchResult>
```

**Step 1: Create the file with the full implementation**

**Step 2: Verify it compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/fetch.ts
git commit -m "feat(web): add fetch pipeline with readability, turndown, cache, pagination"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `src/web/index.ts` — export createFetcher

**Files:**
- Modify: `src/web/index.ts` (add export for createFetcher)

**Step 1: Add the export**

Add after the existing type exports:

```typescript
export { createFetcher } from "./fetch.ts";
```

**Step 2: Verify it compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/index.ts
git commit -m "feat(web): export createFetcher from barrel"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Write tests for fetch pipeline

**Verifies:** web-tools.AC2.1, web-tools.AC2.2, web-tools.AC2.3, web-tools.AC2.4, web-tools.AC2.5, web-tools.AC2.6, web-tools.AC2.7, web-tools.AC2.8, web-tools.AC2.9

**Files:**
- Create: `src/web/fetch.test.ts`

**Testing:**

Tests must verify each AC listed above. The fetch pipeline makes real HTTP calls, so tests need either a local HTTP server or mocked `fetch`. Follow the project pattern (hand-crafted mocks, no external mock libraries).

Use Bun's ability to mock globals — override `globalThis.fetch` in tests to return controlled responses. This avoids needing a live HTTP server for unit tests.

Create a helper that returns a mock fetch function:

```typescript
function createMockFetch(responses: Map<string, { status: number; headers: Record<string, string>; body: string }>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const mock = responses.get(url);
    if (!mock) {
      throw new Error(`No mock response for ${url}`);
    }
    return new Response(mock.body, {
      status: mock.status,
      headers: mock.headers,
    });
  };
}
```

Save and restore `globalThis.fetch` in `beforeEach`/`afterEach`.

Tests for each AC:

- **web-tools.AC2.1:** Provide HTML with headings, links, lists, tables. Assert returned markdown preserves these elements (check for `#`, `[text](url)`, `-`, `|`).
- **web-tools.AC2.2:** Provide noisy HTML with `<nav>`, `<aside>`, `<footer>`, `<article>` content. Assert markdown contains article content but not navigation text.
- **web-tools.AC2.3:** Provide HTML that produces markdown longer than page size (8000+ chars). Assert first call returns `has_more: true` with `offset: 0`. Call again with `offset` set to `total_length - remaining`; assert second call returns the rest.
- **web-tools.AC2.4:** Call fetcher twice with same URL within TTL. Assert mock fetch was called only once (track call count in mock).
- **web-tools.AC2.5:** Create fetcher with `cache_ttl: 1` (1 millisecond). Call fetcher once, then `await Bun.sleep(2)` to let the entry expire, then call again. Assert mock fetch was called twice (cache expired, fresh fetch occurred).
- **web-tools.AC2.6:** Provide HTML that Readability cannot extract (e.g., a page with only `<div>some text</div>`, no article structure). Assert markdown still contains the text (Turndown fallback).
- **web-tools.AC2.7:** Mock response with `content-type: application/pdf`. Assert result indicates error with content type.
- **web-tools.AC2.8:** Provide HTML body exceeding `max_fetch_size`. Assert result notes truncation.
- **web-tools.AC2.9:** Mock fetch that never resolves (or use `AbortSignal.timeout` with very short timeout). Assert error about timeout.

Follow project convention: annotate file `// pattern: Imperative Shell`, use `describe/it/expect` from `bun:test`, name tests with AC identifiers.

**Verification:**
Run: `bun test src/web/fetch.test.ts`
Expected: All tests pass

**Commit:** `test(web): add fetch pipeline tests covering AC2.1-AC2.9`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
