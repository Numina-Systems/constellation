// pattern: Imperative Shell

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";
import type { FetchResult, FetchCacheEntry } from "./types.ts";

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}

type ResolvedAddress = Readonly<{ address: string; family: number }>;
type FetcherConfig = Readonly<{
  fetch_timeout: number;
  max_fetch_size: number;
  cache_ttl: number;
  fetchFn?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;
}>;

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split(".").map(Number);
    const first = octets[0] ?? 0;
    const second = octets[1] ?? 0;
    return first === 0 || first === 10 || first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) || first >= 224;
  }
  if (family !== 6) return true;
  return normalized === "::1" || normalized === "::" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized);
}

async function resolvePublicHost(hostname: string): Promise<ReadonlyArray<ResolvedAddress>> {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({address, family}) => ({address, family}));
}

async function validateUrl(url: string, resolveHost: (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebFetchError("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebFetchError("Only http and https URLs are allowed");
  }
  const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  const addresses = isIP(hostname)
    ? [{address: hostname, family: isIP(hostname)}]
    : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(({address}) => isBlockedAddress(address))) {
    throw new WebFetchError("Requests to private or reserved addresses are not allowed");
  }
  return parsed;
}

export function createFetcher(config: FetcherConfig): (url: string, offset?: number) => Promise<FetchResult> {
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

    try {
      const parsedUrl = await validateUrl(url, config.resolveHost ?? resolvePublicHost);
      const response = await (config.fetchFn ?? fetch)(parsedUrl, {
        signal: AbortSignal.timeout(config.fetch_timeout),
      });

      // Check content-type
      const contentType = response.headers.get("content-type");
      const ctString = contentType ?? "not specified";
      if (!ctString.includes("text/html")) {
        throw new Error(`Invalid content type: ${ctString}`);
      }

      // Step 3: Read only up to the configured body limit.
      const html = await readBodyWithinLimit(response, config.max_fetch_size);

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
    const markdown = turndown.turndown(extractedHtml);

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

async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let totalBytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new WebFetchError("Response body exceeds the configured size limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Stream may already be closed. */ }
    throw error;
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
