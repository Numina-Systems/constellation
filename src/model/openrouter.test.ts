// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createOpenRouterAdapter } from "./openrouter.js";
import { ModelError } from "./types.js";
import type { ModelConfig } from "../config/schema.js";

describe("createOpenRouterAdapter", () => {
  let mockServerUrl = "";
  let lastRequest: { headers: Record<string, string>; body: unknown } | null =
    null;
  let nextResponseType = "text";

  let mockServer: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        // Capture request headers
        const headers: Record<string, string> = {};
        for (const [key, value] of req.headers) {
          headers[key] = value;
        }

        // Capture request body
        let body: unknown = null;
        try {
          const text = await req.text();
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }

        lastRequest = { headers, body };

        // Use the global response type, then reset to text
        let responseType = nextResponseType;
        nextResponseType = "text";

        // Build response based on type
        let responseBody: unknown = {};
        let responseHeaders: Record<string, string> = {
          "x-openrouter-cost": "0.00123",
          "x-ratelimit-limit": "1000",
          "x-ratelimit-remaining": "999",
          "x-ratelimit-reset": "1678886400000",
          "content-type": "application/json",
        };

        if (responseType === "text") {
          responseBody = {
            id: "msg-1",
            object: "chat.completion",
            created: 1678886400,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Hello, world!",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        } else if (responseType === "tool_call") {
          responseBody = {
            id: "msg-2",
            object: "chat.completion",
            created: 1678886400,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "test_tool",
                        arguments: '{"key": "value"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        } else if (responseType === "reasoning") {
          responseBody = {
            id: "msg-3",
            object: "chat.completion",
            created: 1678886400,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "The answer is 42",
                  reasoning_content: "Let me think about this...",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 8,
              total_tokens: 23,
            },
          };
        }

        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: responseHeaders,
        });
      },
    });

    mockServerUrl = `http://localhost:${mockServer.port}`;
  });

  afterAll(() => {
    if (mockServer) {
      mockServer.stop();
    }
  });

  describe("initialization", () => {
    it("should create adapter without openrouter config", () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      expect(() => createOpenRouterAdapter(config)).not.toThrow();
    });

    it("should create adapter with openrouter config", () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          referer: "https://example.com",
          title: "test-app",
          sort: "price",
          allow_fallbacks: true,
        },
      };
      expect(() => createOpenRouterAdapter(config)).not.toThrow();
    });

    it("should use default baseURL if not provided", () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
      };
      expect(() => createOpenRouterAdapter(config)).not.toThrow();
    });
  });

  describe("complete method", () => {
    it("AC2.1: should normalize text response with correct content blocks, stop reason, and usage", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const response = await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Say hello",
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content.length).toBeGreaterThan(0);
      const firstBlock = response.content[0];
      expect(firstBlock?.type).toBe("text");
      if (firstBlock && firstBlock.type === "text") {
        expect(firstBlock.text).toBe("Hello, world!");
      }
      expect(response.stop_reason).toBe("end_turn");
      expect(response.usage).toBeDefined();
      expect(response.usage.input_tokens).toBe(10);
      expect(response.usage.output_tokens).toBe(5);
      expect(response.reasoning_content).toBeNull();
    });

    it("AC2.2: should normalize tool call responses with correct id, name, and arguments", async () => {
      nextResponseType = "tool_call";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const response = await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Call test_tool",
          },
        ],
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            input_schema: {
              type: "object",
              properties: {
                key: { type: "string" },
              },
            },
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(Array.isArray(response.content)).toBe(true);
      const toolUseBlock = response.content.find((b) => b.type === "tool_use");
      expect(toolUseBlock).toBeDefined();
      if (toolUseBlock && toolUseBlock.type === "tool_use") {
        expect(toolUseBlock.id).toBe("call-1");
        expect(toolUseBlock.name).toBe("test_tool");
        expect(toolUseBlock.input).toEqual({ key: "value" });
      }
      expect(response.stop_reason).toBe("tool_use");
    });

    it("AC2.3: should extract reasoning_content when present", async () => {
      nextResponseType = "reasoning";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const response = await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Think about this",
          },
        ],
      });

      expect(response.reasoning_content).toBeDefined();
      expect(response.reasoning_content).toBe("Let me think about this...");
    });

    it("AC3.1: should log cost with correct format [openrouter] cost=$X model=Y tokens=I/O", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const originalConsoleInfo = console.info;
      let logOutput = "";
      console.info = (msg: unknown) => {
        logOutput = String(msg);
      };

      try {
        await adapter.complete({
          model: "gpt-4",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: "Say hello",
            },
          ],
        });

        expect(logOutput).toContain("[openrouter]");
        expect(logOutput).toContain("cost=");
        expect(logOutput).toContain("model=gpt-4");
        expect(logOutput).toContain("tokens=10/5");
      } finally {
        console.info = originalConsoleInfo;
      }
    });

    it("AC5.1: should send HTTP-Referer header when referer is configured", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          referer: "https://myapp.example.com",
        },
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["http-referer"]).toBe(
        "https://myapp.example.com"
      );
    });

    it("AC5.2: should send X-Title header when title is configured", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          title: "my-awesome-app",
        },
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.headers["x-title"]).toBe("my-awesome-app");
    });

    it("AC6.1: should include provider.sort in request body when sort is configured", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          sort: "price",
        },
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(typeof lastRequest!.body).toBe("object");
      expect(lastRequest!.body).not.toBeNull();
      const body = lastRequest!.body as Record<string, unknown>;
      expect(body["provider"]).toBeDefined();
      const provider = body["provider"] as Record<string, unknown>;
      expect(provider["sort"]).toBe("price");
    });

    it("AC6.2: should include provider.allow_fallbacks in request body when configured", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          allow_fallbacks: false,
        },
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(typeof lastRequest!.body).toBe("object");
      expect(lastRequest!.body).not.toBeNull();
      const body = lastRequest!.body as Record<string, unknown>;
      expect(body["provider"]).toBeDefined();
      const provider = body["provider"] as Record<string, unknown>;
      expect(provider["allow_fallbacks"]).toBe(false);
    });

    it("should include both sort and allow_fallbacks when both configured", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
        openrouter: {
          sort: "latency",
          allow_fallbacks: true,
        },
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(typeof lastRequest!.body).toBe("object");
      expect(lastRequest!.body).not.toBeNull();
      const body = lastRequest!.body as Record<string, unknown>;
      expect(body["provider"]).toBeDefined();
      const provider = body["provider"] as Record<string, unknown>;
      expect(provider["sort"]).toBe("latency");
      expect(provider["allow_fallbacks"]).toBe(true);
    });

    it("should not include provider field when no routing config", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(lastRequest).not.toBeNull();
      expect(typeof lastRequest!.body).toBe("object");
      expect(lastRequest!.body).not.toBeNull();
      const body = lastRequest!.body as Record<string, unknown>;
      expect(body["provider"]).toBeUndefined();
    });

    it("stream() should throw 'not yet implemented' error", async () => {
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      try {
        for await (const _event of adapter.stream({
          model: "gpt-4",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: "Hello",
            },
          ],
        })) {
          // Should not reach here
        }
        expect(true).toBe(false); // Should have thrown
      } catch (error) {
        expect(error).toBeInstanceOf(ModelError);
        if (error instanceof ModelError) {
          expect(error.message).toContain("not yet implemented");
        }
      }
    });
  });

  describe("rate limit sync", () => {
    it("should call onServerRateLimit when rate limit headers present", async () => {
      let syncCalled = false;
      let syncData: { limit: number; remaining: number; resetAt: number } | null = null;

      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config, (data) => {
        syncCalled = true;
        syncData = data;
      });

      await adapter.complete({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(syncCalled).toBe(true);
      expect(syncData).not.toBeNull();
      expect(syncData!.limit).toBe(1000);
      expect(syncData!.remaining).toBe(999);
      expect(syncData!.resetAt).toBe(1678886400000);
    });
  });
});
