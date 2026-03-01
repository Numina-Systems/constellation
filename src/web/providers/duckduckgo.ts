// pattern: Imperative Shell

import { parseHTML } from "linkedom";
import type { SearchProvider, SearchResponse } from "../types.ts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractUrl(href: string): string {
  if (href.includes("uddg=")) {
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      // fall through to raw href
    }
  }
  return href;
}

export function createDuckDuckGoAdapter(): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string, limit: number): Promise<SearchResponse> {
      const response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `q=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`duckduckgo search failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const { document } = parseHTML(html);

      const resultElements = document.querySelectorAll(".result");
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      const resultArray = Array.from(resultElements as unknown as ArrayLike<any>);
      for (const el of resultArray.slice(0, limit)) {
        const anchor = el.querySelector(".result__a");
        const snippetEl = el.querySelector(".result__snippet");

        if (!anchor) continue;

        const title = anchor.textContent?.trim() ?? "";
        const rawHref = anchor.getAttribute("href") ?? "";
        const url = extractUrl(rawHref);
        const snippet = snippetEl?.textContent?.trim() ?? "";

        if (title && url) {
          results.push({ title, url, snippet });
        }
      }

      return { results, provider: "duckduckgo" };
    },
  };
}
