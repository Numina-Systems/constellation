// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSearchChain } from "./chain.ts";

describe("createSearchChain", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // AC3.1: Chain calls providers in configured order; first success is returned
  it("should return first provider success when configured", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      if (urlStr.includes("api.search.brave.com")) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Test Result",
                  url: "https://example.com",
                  description: "Test snippet",
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({ brave_api_key: "test-key" });
    const result = await chain.search("test", 5);

    expect(result.provider).toBe("brave");
    expect(result.results.length).toBeGreaterThan(0);
  });

  // AC3.1 (fallback): Chain falls through to next provider on failure
  it("should fall through to next provider when first fails", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("api.search.brave.com")) {
        throw new Error("Brave API error");
      }
      if (urlStr.includes("html.duckduckgo.com")) {
        // Return minimal DDG HTML
        return new Response(
          `<html><body>
            <div class="result">
              <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
              <div class="result__snippet">Example snippet</div>
            </div>
          </body></html>`,
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({ brave_api_key: "test-key" });
    const result = await chain.search("test", 5);

    expect(result.provider).toBe("duckduckgo");
    expect(result.results.length).toBeGreaterThan(0);
  });

  // AC3.2: Unconfigured providers are silently skipped
  it("should skip unconfigured providers", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("api.search.brave.com")) {
        throw new Error("should not reach brave without api key");
      }
      if (urlStr.includes("html.duckduckgo.com")) {
        return new Response(
          `<html><body>
            <div class="result">
              <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
              <div class="result__snippet">Example snippet</div>
            </div>
          </body></html>`,
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({});
    expect(chain.providers).toEqual(["duckduckgo"]);

    const result = await chain.search("test", 5);
    expect(result.provider).toBe("duckduckgo");
  });

  // AC3.2: Multiple unconfigured providers are skipped
  it("should build chain with only configured providers", async () => {
    const chain = createSearchChain({
      brave_api_key: "brave-key",
      tavily_api_key: "tavily-key",
    });

    expect(chain.providers).toContain("brave");
    expect(chain.providers).toContain("tavily");
    expect(chain.providers).toContain("duckduckgo");
    expect(chain.providers).not.toContain("searxng");
  });

  // AC3.3: Response includes provider name indicating which provider answered
  it("should include provider name in response", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("api.tavily.com")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Test Result",
                url: "https://example.com",
                content: "Test snippet",
                score: 0.95,
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({ tavily_api_key: "test-key" });
    const result = await chain.search("test", 5);

    expect(result.provider).toBeDefined();
    expect(result.provider).toBe("tavily");
  });

  // AC3.4: When all providers fail, error lists each provider and its failure reason
  it("should aggregate errors when all providers fail", async () => {
    const mockFetch = async () => {
      throw new Error("All fetches fail");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({ brave_api_key: "test-key" });

    await expect(chain.search("test", 5)).rejects.toThrow(
      /all search providers failed/
    );
  });

  // AC3.4: Error message includes provider names
  it("should include all provider names in error message", async () => {
    const mockFetch = async () => {
      throw new Error("Simulated network error");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({
      brave_api_key: "test-key",
      tavily_api_key: "test-key",
    });

    let errorMessage = "";
    try {
      await chain.search("test", 5);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(errorMessage).toContain("brave");
    expect(errorMessage).toContain("tavily");
    expect(errorMessage).toContain("duckduckgo");
  });

  // AC3.4: Error message includes individual failure reasons
  it("should include individual failure reasons in error message", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("api.search.brave.com")) {
        throw new Error("Brave: Invalid API key");
      }
      if (urlStr.includes("api.tavily.com")) {
        throw new Error("Tavily: Rate limit exceeded");
      }
      if (urlStr.includes("html.duckduckgo.com")) {
        throw new Error("DuckDuckGo: Connection timeout");
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chain = createSearchChain({
      brave_api_key: "test-key",
      tavily_api_key: "test-key",
    });

    let errorMessage = "";
    try {
      await chain.search("test", 5);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(errorMessage).toContain("Invalid API key");
    expect(errorMessage).toContain("Rate limit exceeded");
    expect(errorMessage).toContain("Connection timeout");
  });

  // Integration test: Successful search with SearXNG
  it("should support searxng_endpoint config", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("searxng.example.com")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "SearXNG Result",
                url: "https://example.com",
                snippet: "SearXNG snippet",
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as typeof fetch;

    const chain = createSearchChain({ searxng_endpoint: "https://searxng.example.com" });

    expect(chain.providers).toContain("searxng");
    const result = await chain.search("test", 5);
    expect(result.provider).toBe("searxng");
  });

  // Test: Empty config uses only DuckDuckGo
  it("should use only duckduckgo when no APIs are configured", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();

      if (urlStr.includes("html.duckduckgo.com")) {
        return new Response(
          `<html><body>
            <div class="result">
              <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
              <div class="result__snippet">Example snippet</div>
            </div>
          </body></html>`,
          { status: 200 }
        );
      }
      throw new Error("unexpected fetch");
    };

    globalThis.fetch = mockFetch as typeof fetch;

    const chain = createSearchChain({});

    expect(chain.providers).toEqual(["duckduckgo"]);
    const result = await chain.search("test", 5);
    expect(result.provider).toBe("duckduckgo");
  });

  // Test: Correct ordering of providers based on config
  it("should order providers based on config order", async () => {
    const chain = createSearchChain({
      brave_api_key: "brave-key",
      tavily_api_key: "tavily-key",
      searxng_endpoint: "https://searxng.example.com",
    });

    expect(chain.providers).toEqual(["brave", "tavily", "searxng", "duckduckgo"]);
  });
});
