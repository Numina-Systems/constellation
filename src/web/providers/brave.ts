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
