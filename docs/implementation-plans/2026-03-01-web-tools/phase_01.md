# Web Tools Implementation Plan — Phase 1: Types, Config, and Module Scaffold

**Goal:** Establish the `src/web/` module with port interfaces, domain types, Zod config schema, and environment variable overrides.

**Architecture:** New `src/web/` module following hexagonal port/adapter pattern. Types in `types.ts`, barrel in `index.ts`. Config extended with optional `[web]` section using Zod validation and env var overrides.

**Tech Stack:** TypeScript, Zod, Bun

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase is infrastructure (types, config, scaffold). No functional behaviour to test.

**Verifies:** None — verified operationally (`bun run build` succeeds, config loads with and without `[web]` section).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/web/types.ts` — domain types and port interface

**Files:**
- Create: `src/web/types.ts`

**Step 1: Create the types file**

This file defines the `SearchProvider` port interface and all domain types for the web module. It follows the same pattern as `src/model/types.ts` (lines 118–121) and `src/embedding/types.ts` (lines 8–12).

The design specifies these types:
- `SearchResult` — individual search result with title, url, snippet, optional score
- `SearchResponse` — array of results plus provider name
- `SearchProvider` — port interface with `name` property and `search(query, limit)` method
- `FetchResult` — fetched page content with pagination support
- `FetchCache` — internal cache type for the fetch pipeline

```typescript
// pattern: Functional Core

/**
 * Shared types for web tools (search and fetch).
 * These types define the port interfaces that all search provider adapters normalise to
 * and the fetch pipeline result shape.
 */

export type SearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
};

export type SearchResponse = {
  readonly results: ReadonlyArray<SearchResult>;
  readonly provider: string;
};

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResponse>;
}

export type FetchResult = {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly total_length: number;
  readonly offset: number;
  readonly has_more: boolean;
};

export type FetchCacheEntry = {
  readonly url: string;
  readonly title: string;
  readonly markdown: string;
  readonly timestamp: number;
};
```

Note: `SearchProvider` uses `interface` (not `type`) for consistency with existing port interfaces in this codebase — `ModelProvider` and `EmbeddingProvider` both use `interface`. While the TypeScript house style generally prefers `type` for object shapes, matching the established codebase pattern for port interfaces takes precedence.

**Step 2: Verify the file compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/types.ts
git commit -m "feat(web): add domain types and SearchProvider port interface"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create `src/web/index.ts` — barrel exports

**Files:**
- Create: `src/web/index.ts`

**Step 1: Create the barrel file**

Follow the pattern from `src/embedding/index.ts` (lines 1–6) and `src/model/index.ts` (lines 1–25). Export types first, then implementations (none yet — those come in later phases).

```typescript
// pattern: Functional Core

export type { SearchResult, SearchResponse, FetchResult, FetchCacheEntry } from "./types.ts";
export { type SearchProvider } from "./types.ts";
```

Note the `.ts` extension in imports — this matches the barrel pattern used in newer modules (`src/tool/index.ts`). Bun resolves `.ts` imports directly.

**Step 2: Verify the file compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/index.ts
git commit -m "feat(web): add barrel exports for web module"
```
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Add `WebConfigSchema` to `src/config/schema.ts`

**Files:**
- Modify: `src/config/schema.ts` — add schema before `AppConfigSchema` (line 62 as of 2026-03-01), add to `AppConfigSchema` object, add to exports (lines 71–79 as of 2026-03-01)

**Step 1: Add the WebConfigSchema**

Insert a new `WebConfigSchema` definition before the `AppConfigSchema` definition. The web config section is entirely optional — if omitted, web tools are not registered. Follow the pattern of `BlueskyConfigSchema` for an optional section with conditional requirements.

The schema should define:
- `brave_api_key` — optional string, needed for Brave Search
- `tavily_api_key` — optional string, needed for Tavily Search
- `searxng_endpoint` — optional URL string, needed for SearXNG
- `max_results` — optional positive integer, default 10
- `fetch_timeout` — optional positive integer (ms), default 30000
- `max_fetch_size` — optional positive integer (bytes), default 1048576 (1MB)
- `cache_ttl` — optional positive integer (ms), default 300000 (5 minutes)

```typescript
const WebConfigSchema = z.object({
  brave_api_key: z.string().optional(),
  tavily_api_key: z.string().optional(),
  searxng_endpoint: z.string().url().optional(),
  max_results: z.number().int().positive().default(10),
  fetch_timeout: z.number().int().positive().default(30000),
  max_fetch_size: z.number().int().positive().default(1048576),
  cache_ttl: z.number().int().positive().default(300000),
});
```

Then add `web: WebConfigSchema.optional(),` to the `AppConfigSchema` object. Using `.optional()` means:
- If `[web]` section is present in TOML, Zod receives `{}` (or a partial object) and fills nested `.default()` values
- If `[web]` section is absent, `config.web` is `undefined` (tools not registered)

Note: Do NOT use `.default({}).optional()` here — that would make `config.web` always truthy (defaulting to `{}` even when absent), causing web tools to register unconditionally. `.optional()` alone ensures `config.web` is `undefined` when the `[web]` section is omitted.

Update the `AppConfigSchema` to include the web field:

```typescript
const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
  bluesky: BlueskyConfigSchema.default({}),
  web: WebConfigSchema.optional(),
});
```

Add to exports (after the other type exports, near the `AppConfig` type export):
- Add `export type WebConfig = z.infer<typeof WebConfigSchema>;` after the other type exports
- Add `WebConfigSchema` to the named export of schemas

**Step 2: Verify the schema compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Verify existing tests still pass**

Run: `bun test src/config/schema.test.ts`
Expected: All existing tests pass (they don't provide a `web` section, so the optional field defaults to `undefined`)

**Step 4: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(web): add WebConfigSchema to AppConfigSchema"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add environment variable overrides to `src/config/config.ts`

**Files:**
- Modify: `src/config/config.ts:38-44` (add env override block before the merge, add to type re-exports)

**Step 1: Add env var override block**

Insert a new block after the bluesky overrides (after line 38) and before the merge (line 40). Follow the exact pattern used for other overrides (lines 14–37):

```typescript
if (parsed["web"] && (process.env["BRAVE_API_KEY"] || process.env["TAVILY_API_KEY"])) {
  const webObj = parsed["web"] as Record<string, unknown>;
  if (process.env["BRAVE_API_KEY"]) {
    webObj["brave_api_key"] = process.env["BRAVE_API_KEY"];
  }
  if (process.env["TAVILY_API_KEY"]) {
    webObj["tavily_api_key"] = process.env["TAVILY_API_KEY"];
  }
  envOverrides["web"] = webObj;
}
```

Note: The guard `parsed["web"]` ensures env vars only override values when `[web]` exists in config.toml. This prevents env vars from implicitly creating the web section (which would bypass AC4.2 — tools must be absent when `[web]` is omitted). Users must explicitly add `[web]` to their config to enable web tools; env vars then override specific API keys within that section.

Also add `WebConfig` to the type re-export at line 44:

```typescript
export type { AppConfig, AgentConfig, ModelConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, BlueskyConfig, WebConfig } from "./schema.ts";
```

**Step 2: Verify the file compiles**

Run: `bun run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/config.ts
git commit -m "feat(web): add BRAVE_API_KEY and TAVILY_API_KEY env var overrides"
```
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update `config.toml.example` with `[web]` section

**Files:**
- Modify: `config.toml.example:37` (append web section at end of file)

**Step 1: Append the web config section**

Add the following after line 37 (the last line of the bluesky section):

```toml

# Web search and fetch tools. Requires at least one search provider API key.
# For production, use environment variables: BRAVE_API_KEY, TAVILY_API_KEY
[web]
# brave_api_key = "BSA..."
# tavily_api_key = "tvly-..."
# searxng_endpoint = "http://localhost:8080"
# max_results = 10
# fetch_timeout = 30000
# max_fetch_size = 1048576
# cache_ttl = 300000
```

All fields are commented out to match the convention that `config.toml.example` shows available options without enabling them.

**Step 2: Commit**

```bash
git add config.toml.example
git commit -m "docs: add [web] section to config.toml.example"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Verify full build and existing test suite

**Files:** None (verification only)

**Step 1: Verify type-check passes**

Run: `bun run build`
Expected: `tsc --noEmit` succeeds with no errors

**Step 2: Verify all existing tests pass**

Run: `bun test`
Expected: All previously-passing tests still pass (167 pass, 3 fail from pre-existing PostgreSQL connection issue)

**Step 3: Verify config parses without [web] section**

This is already covered by the existing schema tests — they don't include a `[web]` section, and since it's `.optional()`, they should pass unchanged. If any test broke, investigate.

**Step 4: Commit (if any files needed adjustment)**

Only commit if adjustments were required. Otherwise, this task produces no commit — it's a verification checkpoint.
<!-- END_TASK_6 -->
