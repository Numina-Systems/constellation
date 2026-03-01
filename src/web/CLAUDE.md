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
