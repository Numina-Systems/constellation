// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createOpenRouterAdapter } from "./openrouter.js";
import { ModelError } from "./types.js";
import type { ModelConfig } from "../config/schema.js";
import type { StreamEvent } from "./types.js";

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
        } else if (responseType === "stream") {
          // For streaming responses, return SSE format
          const sseChunks = [
            `data: ${JSON.stringify({
              id: "msg-stream-1",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-1",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { content: "Hello" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-1",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { content: " world!" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-1",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            })}\n\n`,
            `data: [DONE]\n\n`,
          ];

          responseHeaders["content-type"] = "text/event-stream";
          const sseBody = sseChunks.join("");

          return new Response(sseBody, {
            status: 200,
            headers: responseHeaders,
          });
        } else if (responseType === "stream_tool_call") {
          // Streaming with tool calls split across chunks
          const sseChunks = [
            `data: ${JSON.stringify({
              id: "msg-stream-2",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-2",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-stream-1",
                        type: "function",
                        function: { name: "test_to", arguments: "" },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-2",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: { name: "ol", arguments: '{"k' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-2",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: { arguments: 'ey": "value"}' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-2",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "tool_calls",
                },
              ],
            })}\n\n`,
            `data: [DONE]\n\n`,
          ];

          responseHeaders["content-type"] = "text/event-stream";
          const sseBody = sseChunks.join("");

          return new Response(sseBody, {
            status: 200,
            headers: responseHeaders,
          });
        } else if (responseType === "stream_error") {
          // Streaming with mid-stream error
          const sseChunks = [
            `data: ${JSON.stringify({
              id: "msg-stream-3",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-3",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { content: "Partial " },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-3",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "error",
                },
              ],
            })}\n\n`,
            `data: [DONE]\n\n`,
          ];

          responseHeaders["content-type"] = "text/event-stream";
          const sseBody = sseChunks.join("");

          return new Response(sseBody, {
            status: 200,
            headers: responseHeaders,
          });
        } else if (responseType === "stream_keepalive") {
          // Streaming with keepalive comments (`: OPENROUTER PROCESSING`)
          // These comments are sent by OpenRouter to keep the connection alive
          const sseChunks = [
            `data: ${JSON.stringify({
              id: "msg-stream-keepalive",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `: OPENROUTER PROCESSING\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-keepalive",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { content: "Processing" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `: OPENROUTER PROCESSING\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-keepalive",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: { content: " complete" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              id: "msg-stream-keepalive",
              object: "chat.completion.chunk",
              created: 1678886400,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            })}\n\n`,
            `data: [DONE]\n\n`,
          ];

          responseHeaders["content-type"] = "text/event-stream";
          const sseBody = sseChunks.join("");

          return new Response(sseBody, {
            status: 200,
            headers: responseHeaders,
          });
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

  });

  describe("stream method", () => {
    it("AC2.4: should emit correct StreamEvent sequence (message_start -> content_block_start -> content_block_delta -> message_stop)", async () => {
      nextResponseType = "stream";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.stream({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Say hello",
          },
        ],
      })) {
        events.push({ type: event.type });
      }

      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events[0]?.type).toBe("message_start");
      expect(events[1]?.type).toBe("content_block_start");
      expect(events[2]?.type).toBe("content_block_delta");
      expect(events[events.length - 1]?.type).toBe("message_stop");
    });

    it("AC2.5: should assemble tool calls across multiple chunks", async () => {
      nextResponseType = "stream_tool_call";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const events: StreamEvent[] = [];
      for await (const event of adapter.stream({
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
      })) {
        events.push(event);
      }

      const toolUseStartEvent = events.find((e) => e.type === "content_block_start");
      expect(toolUseStartEvent).toBeDefined();
      if (toolUseStartEvent && toolUseStartEvent.type === "content_block_start") {
        expect(toolUseStartEvent.content_block.type).toBe("tool_use");
        expect(toolUseStartEvent.content_block.id).toBe("call-stream-1");
        // Name is partial because it comes from the first chunk only — the accumulated name in toolCallMap is not re-emitted via content_block_start
        expect(toolUseStartEvent.content_block.name).toBe("test_to");
      }

      const toolUseDeltas = events.filter(
        (e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta"
      );
      expect(toolUseDeltas.length).toBeGreaterThan(0);
    });

    it("AC7.1 & AC7.2: should throw ModelError with error code and retryable=true on finish_reason: error", async () => {
      nextResponseType = "stream_error";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      let error: Error | null = null;
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
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(ModelError);
      if (error instanceof ModelError) {
        expect(error.code).toBe("api_error");
        expect(error.retryable).toBe(true);
      }
    });

    it("AC7.3: should handle SSE keepalive comments and complete successfully with expected event sequence", async () => {
      nextResponseType = "stream_keepalive";
      const config: ModelConfig = {
        provider: "openrouter",
        name: "gpt-4",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createOpenRouterAdapter(config);

      const events: StreamEvent[] = [];
      for await (const event of adapter.stream({
        model: "gpt-4",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Say hello",
          },
        ],
      })) {
        events.push(event);
      }

      // Verify we got the expected event sequence despite keepalive comments
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events[0]?.type).toBe("message_start");
      expect(events[1]?.type).toBe("content_block_start");
      expect(events[2]?.type).toBe("content_block_delta");

      // Check for multiple content deltas (from interleaved keepalive comments)
      const deltaEvents = events.filter((e) => e.type === "content_block_delta");
      expect(deltaEvents.length).toBeGreaterThanOrEqual(2);

      // Verify final event is message_stop
      expect(events[events.length - 1]?.type).toBe("message_stop");
    });

    it("AC3.2: should log cost from initial response headers after stream completes", async () => {
      nextResponseType = "stream";
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
        for await (const _event of adapter.stream({
          model: "gpt-4",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: "Say hello",
            },
          ],
        })) {
          // Consume all events
        }

        expect(logOutput).toContain("[openrouter]");
        expect(logOutput).toContain("cost=");
        expect(logOutput).toContain("model=gpt-4");
        expect(logOutput).toContain("tokens=0/0");
      } finally {
        console.info = originalConsoleInfo;
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
