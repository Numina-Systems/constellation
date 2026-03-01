// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTavilyAdapter } from "./tavily.ts";

describe("Tavily Search adapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AC1.2: parses successful Tavily response with score field into SearchResponse", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Result 1",
            url: "https://example.com/1",
            content: "First result content",
            score: 0.95,
          },
          {
            title: "Result 2",
            url: "https://example.com/2",
            content: "Second result content",
            score: 0.87,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    const response = await adapter.search("test query", 10);

    expect(response.provider).toBe("tavily");
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result content",
      score: 0.95,
    });
    expect(response.results[1]).toEqual({
      title: "Result 2",
      url: "https://example.com/2",
      snippet: "Second result content",
      score: 0.87,
    });
  });

  it("AC1.5: throws error on non-2xx response status (401 Unauthorized)", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })) as unknown as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow("401");
  });

  it("AC1.6: throws error on unparseable JSON response", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow();
  });

  it("AC1.7: error propagates on timeout (AbortError)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    const promise = adapter.search("test query", 10);

    await expect(promise).rejects.toThrow();
  });

  it("handles empty results array gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        results: [],
      }),
    })) as unknown as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });

  it("respects limit parameter in request body", async () => {
    let capturedBody: any;

    globalThis.fetch = (async (_url: any, options: any) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          results: [],
        }),
      };
    }) as typeof fetch;

    const adapter = createTavilyAdapter("test-key");
    await adapter.search("test query", 5);

    expect(capturedBody.max_results).toBe(5);
  });
});
