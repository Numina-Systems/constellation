// pattern: Imperative Shell

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";
import type { FetchResult, FetchCacheEntry } from "./types.js";

export function createFetcher(config: {
  readonly fetch_timeout: number;
  readonly max_fetch_size: number;
  readonly cache_ttl: number;
}): (url: string, offset?: number) => Promise<FetchResult> {
  const cache = new Map<string, FetchCacheEntry>();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);

  return async (url: string, offset = 0): Promise<FetchResult> => {
    // Step 1: Cache check
    const cached = cache.get(url);
    if (cached) {
      const now = Date.now();
      const age = now - cached.timestamp;
      if (age < config.cache_ttl) {
        // Cache hit, paginate from cached markdown
        return paginateMarkdown(
          cached.url,
          cached.title,
          cached.markdown,
          offset
        );
      }
    }

    // Step 2: HTTP GET with timeout and content-type check
    let title = "";
    let extractedHtml = "";
    let isTruncated = false;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.fetch_timeout),
      });

      // Check content-type
      const contentType = response.headers.get("content-type");
      const ctString = contentType ?? "not specified";
      if (!ctString.includes("text/html")) {
        throw new Error(`Invalid content type: ${ctString}`);
      }

      // Step 3: Read body with truncation check
      let html = await response.text();
      if (html.length > config.max_fetch_size) {
        html = html.slice(0, config.max_fetch_size);
        isTruncated = true;
      }

      // Step 4: Readability extraction
      try {
        const { document } = parseHTML(html);
        const reader = new Readability(document);
        const article = reader.parse();
        if (article) {
          title = article.title ?? "";
          extractedHtml = article.content ?? "";
        } else {
          // Readability couldn't extract — use raw HTML
          extractedHtml = html;
        }
      } catch {
        // linkedom/Readability compatibility issue — fall back to raw HTML
        extractedHtml = html;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("Fetch timeout");
      }
      throw error;
    }

    // Step 5: Turndown conversion
    let markdown = turndown.turndown(extractedHtml);
    if (isTruncated) {
      markdown += "\n\n[Content truncated due to size limit]";
    }

    // Step 6: Cache store
    const entry: FetchCacheEntry = {
      url,
      title,
      markdown,
      timestamp: Date.now(),
    };
    cache.set(url, entry);

    // Step 7: Paginate
    return paginateMarkdown(url, title, markdown, offset);
  };
}

function paginateMarkdown(
  url: string,
  title: string,
  markdown: string,
  offset: number
): FetchResult {
  const pageSize = 8000;
  const totalLength = markdown.length;
  const clampedOffset = Math.max(0, Math.min(offset, totalLength));

  const content = markdown.slice(clampedOffset, clampedOffset + pageSize);
  const hasMore = clampedOffset + pageSize < totalLength;

  return {
    url,
    title,
    content,
    total_length: totalLength,
    offset: clampedOffset,
    has_more: hasMore,
  };
}
