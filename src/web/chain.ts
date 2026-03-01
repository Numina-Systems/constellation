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
