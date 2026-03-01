# Test Requirements — Web Tools

Generated: 2026-03-01
Design: docs/design-plans/2026-02-28-web-tools.md

## Automated Tests

| AC | Description | Test Type | Test File | Phase |
|----|-------------|-----------|-----------|-------|
| web-tools.AC1.1 | Brave adapter parses API response into SearchResponse with title, url, snippet | unit | src/web/providers/brave.test.ts | 3 |
| web-tools.AC1.2 | Tavily adapter parses API response into SearchResponse with title, url, snippet, and score | unit | src/web/providers/tavily.test.ts | 3 |
| web-tools.AC1.3 | SearXNG adapter parses JSON response into SearchResponse | unit | src/web/providers/searxng.test.ts | 3 |
| web-tools.AC1.4 | DuckDuckGo adapter parses HTML response into SearchResponse | unit | src/web/providers/duckduckgo.test.ts | 3 |
| web-tools.AC1.5 | Provider returns error when API responds with non-2xx status | unit | src/web/providers/brave.test.ts, src/web/providers/tavily.test.ts, src/web/providers/searxng.test.ts, src/web/providers/duckduckgo.test.ts | 3 |
| web-tools.AC1.6 | Provider returns error when response body is unparseable | unit | src/web/providers/brave.test.ts, src/web/providers/tavily.test.ts, src/web/providers/searxng.test.ts, src/web/providers/duckduckgo.test.ts | 3 |
| web-tools.AC1.7 | Provider returns error when request times out | unit | src/web/providers/brave.test.ts, src/web/providers/tavily.test.ts, src/web/providers/searxng.test.ts, src/web/providers/duckduckgo.test.ts | 3 |
| web-tools.AC2.1 | Fetcher retrieves HTML and returns markdown with headings, links, lists, tables preserved | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.2 | Readability extracts article content from noisy pages (strips nav, ads, sidebars) | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.3 | Large content is paginated with offset and has_more; continue_from retrieves next chunk | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.4 | Fetched content is cached; second request within TTL returns cached result without HTTP request | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.5 | Cache entries expire after TTL; request after expiry fetches fresh content | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.6 | When Readability fails to extract, fetcher falls back to raw Turndown conversion | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.7 | Non-HTML content type (PDF, image) returns error with content type indicated | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.8 | Content exceeding max_fetch_size is truncated with truncation noted in result | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC2.9 | Fetch timeout returns error | unit | src/web/fetch.test.ts | 2 |
| web-tools.AC3.1 | Chain calls providers in configured order; first success is returned | unit | src/web/chain.test.ts | 4 |
| web-tools.AC3.2 | Unconfigured providers (missing API key/endpoint) are silently skipped | unit | src/web/chain.test.ts | 4 |
| web-tools.AC3.3 | Response includes provider name indicating which provider answered | unit | src/web/chain.test.ts | 4 |
| web-tools.AC3.4 | When all providers fail, error lists each provider and its failure reason | unit | src/web/chain.test.ts | 4 |
| web-tools.AC4.1 | web_search and web_fetch appear in registry.getDefinitions() when [web] config exists | unit | src/tool/builtin/web.test.ts | 5 |
| web-tools.AC4.2 | web_search and web_fetch are absent from registry when [web] config is omitted | integration | src/web/web.integration.test.ts | 5 |
| web-tools.AC4.3 | registry.generateStubs() produces typed IPC bridge functions for both tools | integration | src/web/web.integration.test.ts | 6 |
| web-tools.AC5.1 | BRAVE_API_KEY and TAVILY_API_KEY environment variables override config.toml values | integration | src/web/web.integration.test.ts | 6 |

## Human Verification

| AC | Description | Justification | Verification Approach |
|----|-------------|---------------|----------------------|
| web-tools.AC4.2 | web_search and web_fetch are absent from registry when [web] config is omitted | While an integration test verifies the conditional registration logic, the composition root (`src/index.ts`) wiring is only exercised at runtime via `main()` -- tests do not call `main()` directly. The unit test in Phase 5 covers the conditional `if (config.web)` guard path, but the actual absence from a fully-composed registry requires running the daemon without `[web]` config. | Start the daemon with a config.toml that has no `[web]` section. Issue `list_tools` or inspect registry output. Confirm neither `web_search` nor `web_fetch` appears. |
| web-tools.AC5.2 | Deno --allow-net and --deny-net behaviour is unchanged by web tool addition | Web tools execute on the Bun host via tool handlers, never inside the Deno sandbox. The Deno sandbox only receives IPC stubs that call back to the host. No `--allow-net` flags are modified. This is structurally guaranteed by the architecture -- there is no code path that changes Deno permission flags based on web tool presence. An automated test could verify the runtime config shape is unchanged, but cannot meaningfully test that Deno network permissions behave identically without a running Deno subprocess and network access. | 1. Run `bun run start` with `[web]` section enabled and `allowed_hosts` configured. 2. Execute sandboxed code that fetches an allowed host -- confirm it works. 3. Execute sandboxed code that fetches a denied host -- confirm it is blocked. 4. Compare behaviour with and without `[web]` section -- confirm identical Deno permissions. |

## Implementation Notes

### Phase 1 (Types, Config, Module Scaffold)
Phase 1 has no acceptance criteria of its own -- it is infrastructure. Correctness is verified operationally: `bun run build` succeeds, existing tests pass, config loads with and without `[web]` section. The config schema and env var override logic are tested transitively through AC4.2, AC5.1, and existing schema tests.

### AC1.5, AC1.6, AC1.7 (Cross-cutting failure modes)
These three ACs apply to all four search providers. Each provider's test file covers all three failure modes independently. The implementation plans specify mocking `globalThis.fetch` to simulate non-2xx responses (AC1.5), unparseable bodies (AC1.6), and `AbortError` timeouts (AC1.7) for each adapter.

### AC1.6 for DuckDuckGo
The DuckDuckGo adapter parses HTML, not JSON. An "unparseable" response is HTML with no `.result` elements. The implementation plan correctly handles this as empty results (not an error), which is the right behaviour -- DDG returning valid HTML with no results is "zero results," not a parse failure. The test verifies empty results are returned gracefully.

### AC2.5 (Cache expiry)
The implementation plan uses `cache_ttl: 1` (1ms) with `Bun.sleep(2)` to test expiry, avoiding any need to manipulate internal timestamps or mock `Date.now()`. This is a reliable approach given the cache uses lazy eviction.

### AC3.2 (Unconfigured providers skipped)
Tested indirectly: `createSearchChain({})` (no API keys) only includes DuckDuckGo in the provider list. The `providers` property on the chain object exposes which providers were instantiated, and the test asserts `providers` equals `["duckduckgo"]`.

### AC4.2 (Tools absent when config omitted)
Listed in both Automated and Human Verification. The automated test covers the tool factory and registration logic. The human verification covers the full composition root path that is only exercised through `main()`.

### AC4.3 (IPC stubs)
Tested in both Phase 5 (unit: tool definitions produce correct parameter schemas for stub generation) and Phase 6 (integration: full registry generates stubs with correct function signatures). The integration test asserts the generated TypeScript contains `async function web_search` and `async function web_fetch` with correct parameter types.

### AC5.1 (Env var overrides)
Tested at the config level in Phase 6 integration tests: write a temporary config.toml with empty `[web]` section, set `process.env["BRAVE_API_KEY"]`, call `loadConfig()`, assert `config.web.brave_api_key` matches the env var. This is the same pattern used for existing env var override tests.

## Coverage Summary

- Total ACs: 23
- Automated: 21
- Human verification: 2
- Dual coverage (automated + human): 1 (AC4.2)
