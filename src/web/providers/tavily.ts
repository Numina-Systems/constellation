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
