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
