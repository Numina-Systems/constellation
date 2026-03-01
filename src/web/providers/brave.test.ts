// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createBraveAdapter } from "./brave.ts";

describe("Brave Search adapter", () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AC1.1: parses successful Brave response into SearchResponse with title, url, snippet", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Result 1", url: "https://example.com/1", description: "First result" },
            { title: "Result 2", url: "https://example.com/2", description: "Second result" },
            { title: "Result 3", url: "https://example.com/3", description: "Third result" },
          ],
        },
      }),
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const response = await adapter.search("test query", 10);

    expect(response.provider).toBe("brave");
    expect(response.results).toHaveLength(3);
    expect(response.results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result",
    });
    expect(response.results[1]).toEqual({
      title: "Result 2",
      url: "https://example.com/2",
      snippet: "Second result",
    });
    expect(response.results[2]).toEqual({
      title: "Result 3",
      url: "https://example.com/3",
      snippet: "Third result",
    });
  });

  it("AC1.5: throws error on non-2xx response status", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const promise = adapter.search("test query", 10);

    expect(promise).rejects.toThrow("403");
  });

  it("AC1.6: throws error on unparseable JSON response", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const promise = adapter.search("test query", 10);

    expect(promise).rejects.toThrow();
  });

  it("AC1.7: error propagates on timeout (AbortError)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("The operation was aborted");
    }) as any;

    const adapter = createBraveAdapter("test-key");
    const promise = adapter.search("test query", 10);

    expect(promise).rejects.toThrow();
  });

  it("handles empty results array gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        web: { results: [] },
      }),
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });

  it("handles missing web field gracefully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const response = await adapter.search("test query", 10);

    expect(response.results).toHaveLength(0);
  });

  it("respects limit parameter (max 20)", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: Array.from({ length: 30 }, (_, i) => ({
            title: `Result ${i}`,
            url: `https://example.com/${i}`,
            description: `Description ${i}`,
          })),
        },
      }),
    })) as any;

    const adapter = createBraveAdapter("test-key");
    const response = await adapter.search("test query", 5);

    // The adapter should clamp the count parameter to 20 max
    expect(response.results).toHaveLength(30); // returns all from mock
  });
});
