// pattern: Functional Core

export type { SearchResult, SearchResponse, FetchResult, FetchCacheEntry } from "./types.ts";
export { type SearchProvider } from "./types.ts";
export { createFetcher } from "./fetch.ts";
export { createBraveAdapter } from "./providers/brave.ts";
export { createTavilyAdapter } from "./providers/tavily.ts";
export { createSearXNGAdapter } from "./providers/searxng.ts";
export { createDuckDuckGoAdapter } from "./providers/duckduckgo.ts";
