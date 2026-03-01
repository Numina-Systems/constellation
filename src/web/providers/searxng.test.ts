// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSearXNGAdapter } from "./searxng.ts";

describe("SearXNG adapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AC1.3: parses successful SearXNG response into SearchResponse", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        results: [
          { title: "Result 1", url: "https://example.com/1", snippet: "First result snippet" },
          { title: "Result 2", url: "https://example.com/2", snippet: "Second result snippet" },
          { title: "Result 3", url: "https://example.com/3", snippet: "Third result snippet" },
        ],
      }),
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const response = await adapter.search("test query", 10);

    expect(response.provider).toBe("searxng");
    expect(response.results).toHaveLength(3);
    expect(response.results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result snippet",
    });
    expect(response.results[1]).toEqual({
      title: "Result 2",
      url: "https://example.com/2",
      snippet: "Second result snippet",
    });
    expect(response.results[2]).toEqual({
      title: "Result 3",
      url: "https://example.com/3",
      snippet: "Third result snippet",
    });
  });

  it("AC1.5: throws error on non-2xx response status", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow("403");
  });

  it("AC1.6: handles unparseable response body gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow();
  });

  it("AC1.7: error propagates on timeout (AbortError)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow();
  });

  it("limit enforcement: slices results to requested limit", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 20 }, (_, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          snippet: `Snippet ${i}`,
        })),
      }),
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const response = await adapter.search("test query", 5);

    expect(response.results).toHaveLength(5);
    expect(response.results[0]?.title).toBe("Result 0");
    expect(response.results[4]?.title).toBe("Result 4");
  });

  it("handles missing results field gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });

  it("handles empty results array gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        results: [],
      }),
    })) as unknown as typeof fetch;

    const adapter = createSearXNGAdapter("http://searxng.example.com");
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });
});
