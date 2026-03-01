// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createDuckDuckGoAdapter } from "./duckduckgo.ts";

const MOCK_DDG_HTML = `
<html><body>
<div id="links">
  <div class="result">
    <a class="result__a" href="https://example.com/page1">Example Page 1</a>
    <a class="result__snippet">This is the first result snippet.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2">Example Page 2</a>
    <a class="result__snippet">This is the second result snippet.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/page3">Example Page 3</a>
    <a class="result__snippet">This is the third result snippet.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/page4">Example Page 4</a>
    <a class="result__snippet">This is the fourth result snippet.</a>
  </div>
</div>
</body></html>`;

describe("DuckDuckGo adapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AC1.4: parses DuckDuckGo HTML response with title, url, snippet", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => MOCK_DDG_HTML,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test query", 10);

    expect(response.provider).toBe("duckduckgo");
    expect(response.results).toHaveLength(4);
    expect(response.results[0]).toEqual({
      title: "Example Page 1",
      url: "https://example.com/page1",
      snippet: "This is the first result snippet.",
    });
    expect(response.results[1]).toEqual({
      title: "Example Page 2",
      url: "https://example.com/page2",
      snippet: "This is the second result snippet.",
    });
    expect(response.results[2]).toEqual({
      title: "Example Page 3",
      url: "https://example.com/page3",
      snippet: "This is the third result snippet.",
    });
    expect(response.results[3]).toEqual({
      title: "Example Page 4",
      url: "https://example.com/page4",
      snippet: "This is the fourth result snippet.",
    });
  });

  it("AC1.4: extracts and decodes URL from DDG redirect format (uddg parameter)", async () => {
    const htmlWithRedirect = `
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fencoded-example.com%2Fpath">Encoded Link</a>
  <a class="result__snippet">Snippet with encoded URL</a>
</div>
</body></html>`;

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => htmlWithRedirect,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test", 10);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.url).toBe("https://encoded-example.com/path");
  });

  it("AC1.5: throws error on non-2xx response status", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow("403");
  });

  it("AC1.6: handles HTML response with no result elements (returns empty array)", async () => {
    const emptyHtml = `<html><body><div id="links"></div></body></html>`;

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => emptyHtml,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });

  it("AC1.7: error propagates on timeout (AbortError)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow();
  });

  it("enforces limit parameter by slicing results", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => MOCK_DDG_HTML,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test query", 2);

    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.title).toBe("Example Page 1");
    expect(response.results[1]?.title).toBe("Example Page 2");
  });

  it("skips result elements missing required anchor element", async () => {
    const htmlWithMissingAnchor = `
<html><body>
<div class="result">
  <a class="result__a" href="https://example.com/1">Valid Result</a>
  <a class="result__snippet">Valid snippet</a>
</div>
<div class="result">
  <a class="result__snippet">Missing anchor</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.com/2">Another Valid</a>
  <a class="result__snippet">Another snippet</a>
</div>
</body></html>`;

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => htmlWithMissingAnchor,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test", 10);

    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.title).toBe("Valid Result");
    expect(response.results[1]?.title).toBe("Another Valid");
  });

  it("handles missing snippet elements gracefully", async () => {
    const htmlMissingSnippet = `
<html><body>
<div class="result">
  <a class="result__a" href="https://example.com/1">Title Only</a>
</div>
</body></html>`;

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => htmlMissingSnippet,
    })) as unknown as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    const response = await adapter.search("test", 10);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toEqual({
      title: "Title Only",
      url: "https://example.com/1",
      snippet: "",
    });
  });

  it("sends POST request with User-Agent and form-encoded body", async () => {
    let capturedRequest: any = null;

    globalThis.fetch = (async (url: string, options: any) => {
      capturedRequest = { url, ...options };
      return {
        ok: true,
        text: async () => "<html><body></body></html>",
      };
    }) as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    await adapter.search("test query", 10);

    expect(capturedRequest.method).toBe("POST");
    expect(capturedRequest.url).toBe("https://html.duckduckgo.com/html/");
    expect(capturedRequest.headers["User-Agent"]).toBeDefined();
    expect(capturedRequest.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(capturedRequest.body).toContain("q=");
  });

  it("URL encodes query parameter properly", async () => {
    let capturedRequest: any = null;

    globalThis.fetch = (async (url: string, options: any) => {
      capturedRequest = { url, ...options };
      return {
        ok: true,
        text: async () => "<html><body></body></html>",
      };
    }) as typeof fetch;

    const adapter = createDuckDuckGoAdapter();
    await adapter.search("test & special chars", 10);

    expect(capturedRequest.body).toBe(`q=${encodeURIComponent("test & special chars")}`);
  });
});
