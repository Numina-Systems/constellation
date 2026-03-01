// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createFetcher } from "./fetch.js";

type MockResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function createMockFetch(
  responses: Map<string, MockResponse>,
  callTracker?: { count: number }
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (
    input: string | URL,
    _init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (callTracker) {
      callTracker.count++;
    }
    const mock = responses.get(url);
    if (!mock) {
      throw new Error(`No mock response for ${url}`);
    }
    return new Response(mock.body, {
      status: mock.status,
      headers: mock.headers,
    });
  };
}

describe("web-tools.AC2: Fetch pipeline", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function setMockFetch(
    fn: (input: string | URL, init?: RequestInit) => Promise<Response>
  ) {
    (globalThis.fetch as typeof fetch) = fn as typeof fetch;
  }

  describe("AC2.1: HTML with structure is converted to markdown", () => {
    it("should preserve headings, links, lists, and tables in markdown", async () => {
      const html = `
        <html>
          <body>
            <h1>Main Title</h1>
            <p>Some intro text.</p>
            <h2>Section</h2>
            <p>Check out <a href="https://example.com">this link</a>.</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
            <table>
              <tr><th>Header 1</th><th>Header 2</th></tr>
              <tr><td>Cell 1</td><td>Cell 2</td></tr>
            </table>
          </body>
        </html>
      `;

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/page",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: html,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const result = await fetcher("https://example.com/page");

      expect(result.content).toContain("#");
      expect(result.content).toContain("[");
      expect(result.content).toContain("]");
      expect(result.content).toContain("-");
      expect(result.content).toContain("|");
    });
  });

  describe("AC2.2: Readability extracts article content from noisy pages", () => {
    it("should strip navigation and sidebars, keep article", async () => {
      const html = `
        <html>
          <body>
            <nav><a href="/">Home</a><a href="/about">About</a></nav>
            <article>
              <h1>Article Title</h1>
              <p>This is the main article content that should be extracted.</p>
            </article>
            <aside><h3>Sidebar</h3><p>Ad stuff</p></aside>
            <footer><p>Footer text</p></footer>
          </body>
        </html>
      `;

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/article",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: html,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const result = await fetcher("https://example.com/article");

      expect(result.content.toLowerCase()).toContain("article");
      expect(result.content.toLowerCase()).toContain("article title");
      expect(result.content.toLowerCase()).not.toContain("footer text");
    });
  });

  describe("AC2.3: Large content is paginated with offset and has_more", () => {
    it("should paginate content by character offset", async () => {
      const largeContent =
        "<h1>Title</h1>" + "<p>" + "x".repeat(100000) + "</p>";

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/large",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: largeContent,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const firstPage = await fetcher("https://example.com/large", 0);

      expect(firstPage.offset).toBe(0);
      if (firstPage.total_length > 8000) {
        expect(firstPage.has_more).toBe(true);
      }
      expect(firstPage.content.length).toBeLessThanOrEqual(8000);

      if (firstPage.has_more) {
        const secondPage = await fetcher(
          "https://example.com/large",
          firstPage.offset + firstPage.content.length
        );

        expect(secondPage.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe("AC2.4: Fetched content is cached", () => {
    it("should return cached result on second call within TTL", async () => {
      const callTracker = { count: 0 };
      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/cacheable",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: "<h1>Cached Page</h1><p>Content</p>",
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses, callTracker));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 10000,
      });

      const result1 = await fetcher("https://example.com/cacheable");
      const result2 = await fetcher("https://example.com/cacheable");

      expect(callTracker.count).toBe(1);
      expect(result1.content).toBe(result2.content);
    });
  });

  describe("AC2.5: Cache entries expire after TTL", () => {
    it("should fetch fresh content after cache expires", async () => {
      const callTracker = { count: 0 };
      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/expiring",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: "<h1>Fresh Content</h1>",
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses, callTracker));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 100,
      });

      await fetcher("https://example.com/expiring");
      await Bun.sleep(150);
      await fetcher("https://example.com/expiring");

      expect(callTracker.count).toBe(2);
    });
  });

  describe("AC2.6: Falls back to Turndown when Readability fails", () => {
    it("should convert HTML to markdown when Readability cannot extract", async () => {
      const html = `
        <html>
          <body>
            <div>Some simple text</div>
            <div>More text</div>
          </body>
        </html>
      `;

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/simple",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: html,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const result = await fetcher("https://example.com/simple");

      expect(result.content).toContain("Some simple text");
      expect(result.content).toContain("More text");
    });
  });

  describe("AC2.7: Non-HTML content type returns error", () => {
    it("should reject PDF with content type error", async () => {
      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/file.pdf",
          {
            status: 200,
            headers: { "content-type": "application/pdf" },
            body: "%PDF-1.4...",
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      let errorThrown = false;
      let errorMessage = "";
      try {
        await fetcher("https://example.com/file.pdf");
      } catch (error) {
        errorThrown = true;
        errorMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain("application/pdf");
    });
  });

  describe("AC2.8: Content exceeding max_fetch_size is truncated", () => {
    it("should note truncation when size limit exceeded", async () => {
      const largeContent =
        "<h1>Title</h1>" + "<p>" + "x".repeat(2000) + "</p>";

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/oversized",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: largeContent,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 500,
        cache_ttl: 300000,
      });

      const result = await fetcher("https://example.com/oversized");

      expect(result.content).toContain("Content truncated");
    });
  });

  describe("AC2.9: Fetch timeout returns error", () => {
    it("should timeout when fetch takes too long", async () => {
      setMockFetch(async (
        _input: string | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const signal = init?.signal;
        if (signal instanceof AbortSignal) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return new Response("", { status: 200 });
      });

      const fetcher = createFetcher({
        fetch_timeout: 10,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      let errorThrown = false;
      let errorMessage = "";
      try {
        await fetcher("https://example.com/slow");
      } catch (error) {
        errorThrown = true;
        errorMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage.toLowerCase()).toContain("timeout");
    });
  });

  describe("pagination with continue_from", () => {
    it("should retrieve next chunk using offset from first call", async () => {
      const largeBody = "x".repeat(50000);

      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/paginated",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: `<h1>Title</h1><p>${largeBody}</p>`,
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const page1 = await fetcher("https://example.com/paginated", 0);

      if (page1.total_length > 8000) {
        expect(page1.has_more).toBe(true);

        const nextOffset = page1.offset + page1.content.length;
        const page2 = await fetcher("https://example.com/paginated", nextOffset);

        expect(page2.offset).toBe(nextOffset);
        expect(page2.content).toHaveLength(
          page1.total_length - page1.content.length
        );
      }
    });
  });

  describe("result structure", () => {
    it("should return all required fields in FetchResult", async () => {
      const responses = new Map<string, MockResponse>([
        [
          "https://example.com/structured",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: "<h1>Test Page</h1><p>Content here</p>",
          },
        ],
      ]);

      setMockFetch(createMockFetch(responses));

      const fetcher = createFetcher({
        fetch_timeout: 5000,
        max_fetch_size: 1000000,
        cache_ttl: 300000,
      });

      const result = await fetcher("https://example.com/structured");

      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("total_length");
      expect(result).toHaveProperty("offset");
      expect(result).toHaveProperty("has_more");

      expect(result.url).toBe("https://example.com/structured");
      expect(typeof result.title).toBe("string");
      expect(typeof result.content).toBe("string");
      expect(typeof result.total_length).toBe("number");
      expect(typeof result.offset).toBe("number");
      expect(typeof result.has_more).toBe("boolean");
    });
  });
});
