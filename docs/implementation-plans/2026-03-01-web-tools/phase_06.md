# Web Tools Implementation Plan — Phase 6: Integration Testing and Documentation

**Goal:** End-to-end validation of web tools through the registry and module documentation.

**Architecture:** Integration tests dispatch `web_search` and `web_fetch` through the `ToolRegistry` with mocked HTTP, verifying the full pipeline: registry dispatch → tool handler → chain/fetcher → mock HTTP → response. Module CLAUDE.md documents contracts and boundaries.

**Tech Stack:** TypeScript, Bun

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### web-tools.AC4: Tools registered and available via IPC bridge
- **web-tools.AC4.3 Success:** registry.generateStubs() produces typed IPC bridge functions for both tools

### web-tools.AC5: Configuration and environment overrides
- **web-tools.AC5.1 Success:** BRAVE_API_KEY and TAVILY_API_KEY environment variables override config.toml values
- **web-tools.AC5.2 Success:** Deno --allow-net and --deny-net behaviour is unchanged by web tool addition

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Write integration tests for web tools through registry

**Verifies:** web-tools.AC4.3, web-tools.AC5.1, web-tools.AC5.2

**Files:**
- Create: `src/web/web.integration.test.ts`

**Testing:**

Integration tests verify the full tool dispatch path through the registry. Unlike unit tests that mock dependencies directly, these tests:
1. Create a real `ToolRegistry`
2. Create real web tools with `createWebTools()` backed by a `createSearchChain()` and `createFetcher()`
3. Mock `globalThis.fetch` to intercept HTTP calls
4. Dispatch tools via `registry.dispatch("web_search", {...})` and `registry.dispatch("web_fetch", {...})`
5. Verify the full pipeline produces correct `ToolResult` output

Tests:

- **web-tools.AC4.3 (IPC stubs):** Register web tools. Call `registry.generateStubs()`. Assert the generated TypeScript contains:
  - `async function web_search(params: { query: string, limit?: number })`
  - `async function web_fetch(params: { url: string, continue_from?: number })`
  - Both call `__callTool__` with correct tool name

- **web-tools.AC5.1 (env overrides):** Test that config loading with `BRAVE_API_KEY` env var works. This is a config-level test:
  - Write a temporary config.toml with empty `[web]` section
  - Set `process.env["BRAVE_API_KEY"] = "test-key"`
  - Call `loadConfig(tempPath)`
  - Assert `config.web.brave_api_key === "test-key"`
  - Clean up env var and temp file

- **web-tools.AC5.2 (Deno net unchanged):** Verify the existing runtime executor config is not affected by web tool registration. This is verified by:
  - Creating a registry with web tools registered
  - Creating a `DenoExecutor` with the registry (which generates stubs)
  - Verifying the executor's `--allow-net` / `--deny-net` flags are derived from `config.runtime.allowed_hosts` (not from web tool presence)
  - This can be checked by examining the executor's generated command or by running a simple Deno script and verifying network permissions are unchanged

  In practice, AC5.2 is structurally guaranteed: web tools execute on the Bun host via the tool handler path, not in the Deno sandbox. The sandbox only gets IPC stubs that call back to the host. No `--allow-net` changes needed. A test verifying that the runtime config shape hasn't changed suffices.

- **Full dispatch (search):** Mock fetch to return Brave-format JSON. Create chain with `brave_api_key: "test"`. Register tools. Call `registry.dispatch("web_search", { query: "test" })`. Assert `result.success === true` and output JSON contains search results.

- **Full dispatch (fetch):** Mock fetch to return HTML. Create fetcher. Register tools. Call `registry.dispatch("web_fetch", { url: "https://example.com" })`. Assert `result.success === true` and output JSON contains markdown content.

- **Dispatch error handling:** Mock fetch to throw. Dispatch `web_search`. Assert `result.success === false` and error field contains failure message (tool handler wraps errors, never throws).

**Verification:**
Run: `bun test src/web/web.integration.test.ts`
Expected: All tests pass

**Commit:** `test(web): add integration tests for web tool dispatch and config`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/web/CLAUDE.md` — module documentation

**Files:**
- Create: `src/web/CLAUDE.md`

**Implementation:**

Follow the documentation pattern from `src/model/CLAUDE.md` and `src/config/CLAUDE.md`. Document:

```markdown
# Web

Last verified: 2026-03-01

## Purpose
Provides web search and URL fetching capabilities via a port/adapter architecture. Search providers (Brave, Tavily, SearXNG, DuckDuckGo) are composed into a sequential fallback chain. Fetched pages are converted to markdown through a Readability + Turndown pipeline with pagination and caching.

## Contracts
- **Exposes**: `SearchProvider` port interface, `createSearchChain(config)`, `createFetcher(config)`, `createBraveAdapter`, `createTavilyAdapter`, `createSearXNGAdapter`, `createDuckDuckGoAdapter`, all domain types (`SearchResult`, `SearchResponse`, `FetchResult`, `FetchCacheEntry`)
- **Guarantees**: Search chain tries providers in configured order, returns first success, aggregates errors on all-fail. Fetcher converts HTML to markdown preserving headings, links, lists, tables. Content cached for configurable TTL. Large content paginated by character offset. Non-HTML content types rejected with error.
- **Expects**: At least one search provider configured (API key or endpoint). DuckDuckGo always available as no-credential fallback.

## Dependencies
- **Uses**: `@mozilla/readability`, `linkedom`, `turndown`, `@truto/turndown-plugin-gfm`, `src/config/`
- **Used by**: `src/tool/builtin/web.ts` (tool definitions), `src/index.ts` (composition root)
- **Boundary**: Web module is consumed only through tool definitions. Agent interacts via `web_search` and `web_fetch` tool calls, never imports web module directly.

## Key Decisions
- Fallback chain over single provider: Resilience — if one API is down or unconfigured, others take over
- linkedom over jsdom: Much lighter DOM implementation. Readability compatibility not perfect but fallback to raw Turndown handles edge cases
- In-memory cache with lazy eviction: Simple, no external dependency. Acceptable for daemon process lifecycle
- Character-offset pagination: Predictable chunking without semantic analysis. 8000 chars (~2000 tokens) per page

## Invariants
- `SearchResponse.provider` always identifies which adapter answered
- `FetchResult.total_length` is stable across paginated requests for the same cached content
- Cache entries never served past TTL
- Tool handlers never throw — errors always captured in `ToolResult.error`

## Key Files
- `types.ts` — Domain types and `SearchProvider` port interface
- `fetch.ts` — Fetch pipeline: HTTP → Readability → Turndown → cache → paginate
- `chain.ts` — `SearchChain` with sequential fallback
- `providers/brave.ts` — Brave Search API adapter
- `providers/tavily.ts` — Tavily API adapter
- `providers/searxng.ts` — SearXNG adapter (self-hosted)
- `providers/duckduckgo.ts` — DuckDuckGo HTML scraping adapter (no credentials required)
```

**Step 1: Create the file with the content above**

**Step 2: Commit**

```bash
git add src/web/CLAUDE.md
git commit -m "docs(web): add module CLAUDE.md documenting contracts and boundaries"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Final verification — full build and test suite

**Files:** None (verification only)

**Step 1: Type-check**

Run: `bun run build`
Expected: `tsc --noEmit` succeeds

**Step 2: Run all tests**

Run: `bun test`
Expected: All web tool tests pass. All pre-existing tests unchanged (167 pass, 3 fail from pre-existing PostgreSQL issue).

**Step 3: Verify file structure**

Run: `ls -R src/web/`
Expected:
```
src/web/
  CLAUDE.md
  chain.ts
  chain.test.ts
  fetch.ts
  fetch.test.ts
  index.ts
  types.ts
  web.integration.test.ts
  providers/
    brave.ts
    brave.test.ts
    duckduckgo.ts
    duckduckgo.test.ts
    searxng.ts
    searxng.test.ts
    tavily.ts
    tavily.test.ts
```

**Step 4: Commit (if any adjustments needed)**

Only commit if final adjustments were required. Otherwise, this is a verification-only task.
<!-- END_TASK_3 -->
