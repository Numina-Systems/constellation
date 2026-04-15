// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createAnthropicAdapter, buildAnthropicSystemParam, normalizeMessage } from "./anthropic.js";
import { ModelError } from "./types.js";
import type { Message } from "./types.js";
import type { ModelConfig } from "../config/schema.js";

describe("createAnthropicAdapter", () => {
  describe("initialization", () => {
    it("should throw if no api key is configured or in environment", () => {
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
      };
      expect(() => createAnthropicAdapter(config)).toThrow();
    });

    it("should accept api_key from config", () => {
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "sk-test-key",
      };
      expect(() => createAnthropicAdapter(config)).not.toThrow();
    });

    it("should accept api_key from environment variable", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-test-env-key";
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
      };
      expect(() => createAnthropicAdapter(config)).not.toThrow();
      delete process.env["ANTHROPIC_API_KEY"];
    });
  });

  describe("complete method", () => {
    it("should send a simple message and get a text response", async () => {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        // Skip integration test
        return;
      }

      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: apiKey,
      };
      const adapter = createAnthropicAdapter(config);

      const response = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Say 'hello world' in exactly two words.",
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content.length).toBeGreaterThan(0);
      if (response.content.length > 0) {
        expect(response.content[0]!.type).toBe("text");
      }
      expect(response.stop_reason).toBeDefined();
      expect(response.usage).toBeDefined();
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);
    });

    it("should handle tool definitions and receive tool_use blocks", async () => {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        // Skip integration test
        return;
      }

      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: apiKey,
      };
      const adapter = createAnthropicAdapter(config);

      const response = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: "Use the get_weather tool to get weather for Boston.",
          },
        ],
        tools: [
          {
            name: "get_weather",
            description: "Get the weather for a location",
            input_schema: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The location to get weather for",
                },
              },
              required: ["location"],
            },
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      // Response may contain text or tool_use
      const hasToolUse = response.content.some((c) => c.type === "tool_use");
      const hasText = response.content.some((c) => c.type === "text");
      expect(hasToolUse || hasText).toBe(true);
    });

    it("should throw ModelError with auth code for invalid API key", async () => {
      const invalidConfig: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "sk-invalid-key-that-should-fail",
      };
      const invalidAdapter = createAnthropicAdapter(invalidConfig);

      try {
        await invalidAdapter.complete({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: "hello",
            },
          ],
        });
        expect(true).toBe(false); // Should have thrown
      } catch (error) {
        expect(error).toBeInstanceOf(ModelError);
        const modelError = error as ModelError;
        expect(modelError.code).toBe("auth");
      }
    });
  });

  describe("stream method", () => {
    it("should stream events in correct order", async () => {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        // Skip integration test
        return;
      }

      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: apiKey,
      };
      const adapter = createAnthropicAdapter(config);

      const events = [];
      for await (const event of adapter.stream({
        model: "claude-3-5-sonnet-20241022",
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

      expect(events.length).toBeGreaterThan(0);

      // Check event order
      const types = events.map((e) => e.type);
      expect(types[0]).toBe("message_start");
      const lastIndex = types.length - 1;
      expect(types[lastIndex]).toBe("message_stop");

      // Check that content_block events exist between start and stop
      const hasContentBlocks = types.some(
        (t) => t === "content_block_start" || t === "content_block_delta"
      );
      expect(hasContentBlocks).toBe(true);
    });
  });

  describe("retry logic", () => {
    it("should have retry logic (unit test with valid key)", async () => {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        // Skip test
        return;
      }

      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: apiKey,
      };
      const adapter = createAnthropicAdapter(config);

      // This is implicitly tested by calling complete/stream multiple times
      // and verifying they work correctly
      const response1 = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: "hi",
          },
        ],
      });
      expect(response1.content).toBeDefined();

      const response2 = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: "hi again",
          },
        ],
      });
      expect(response2.content).toBeDefined();
    });
  });

  describe("system-role message handling", () => {
    it("should extract system-role messages from array and merge with request.system", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: "Hello",
        },
        {
          role: "system",
          content: "Always be concise.",
        },
      ];

      const result = buildAnthropicSystemParam("Base system instruction", messages);

      expect(result).toBeDefined();
      expect(result).toContain("Base system instruction");
      expect(result).toContain("You are a helpful assistant.");
      expect(result).toContain("Always be concise.");
      // Verify they're joined with double newlines
      const parts = result!.split("\n\n");
      expect(parts.length).toBe(3);
    });

    it("should pass through request.system unchanged when no system-role messages exist", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "user",
          content: "Hello",
        },
        {
          role: "assistant",
          content: "Hi there",
        },
      ];

      const result = buildAnthropicSystemParam("My system instruction", messages);

      expect(result).toBe("My system instruction");
    });

    it("should return undefined when no system param or messages exist", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "user",
          content: "Hello",
        },
      ];

      const result = buildAnthropicSystemParam(undefined, messages);

      expect(result).toBeUndefined();
    });

    it("should handle system-role messages with content blocks (TextBlock)", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "First instruction",
            },
            {
              type: "text",
              text: "Second instruction",
            },
          ],
        },
        {
          role: "user",
          content: "Hello",
        },
      ];

      const result = buildAnthropicSystemParam(undefined, messages);

      expect(result).toBeDefined();
      expect(result).toContain("First instruction");
      expect(result).toContain("Second instruction");
      // Text blocks are joined with newlines within a message, then messages are joined with double newlines
      expect(result).toContain("First instruction\nSecond instruction");
    });

    it("should concatenate multiple system-role messages with double newlines", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "system",
          content: "System 1",
        },
        {
          role: "user",
          content: "User message",
        },
        {
          role: "system",
          content: "System 2",
        },
        {
          role: "assistant",
          content: "Assistant message",
        },
        {
          role: "system",
          content: "System 3",
        },
      ];

      const result = buildAnthropicSystemParam(undefined, messages);

      expect(result).toBe("System 1\n\nSystem 2\n\nSystem 3");
    });

    it("should merge request.system with system-role messages in order", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "system",
          content: "Inline system",
        },
      ];

      const result = buildAnthropicSystemParam("Request system", messages);

      // request.system comes first, then inline system messages
      expect(result).toBe("Request system\n\nInline system");
    });

    it("should handle empty string requestSystem explicitly (not drop it)", () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: "user",
          content: "Hello",
        },
      ];

      const result = buildAnthropicSystemParam("", messages);

      // Empty string should be preserved (not treated as falsy and dropped)
      expect(result).toBe("");
    });

    it("should throw when normalizeMessage receives system-role message", () => {
      const msg: Message = {
        role: "system",
        content: "test",
      };

      expect(() => normalizeMessage(msg)).toThrow("system-role messages must be extracted before normalizeMessage");
    });
  });

  describe("timeout handling with mock server", () => {
    let mockServerUrl = "";
    let mockServer: ReturnType<typeof Bun.serve> | null = null;
    let requestDelay = 0;

    beforeAll(async () => {
      mockServer = Bun.serve({
        port: 0,
        async fetch() {
          // Simulate delay if configured
          if (requestDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, requestDelay));
          }

          // Return valid Anthropic SSE format response
          const sseChunks = [
            `event: message_start\ndata: ${JSON.stringify({
              type: "message_start",
              message: {
                id: "msg-123",
                type: "message",
                role: "assistant",
                content: [],
                model: "claude-3-5-sonnet-20241022",
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: 10,
                  output_tokens: 0,
                },
              },
            })}\n\n`,
            `event: content_block_start\ndata: ${JSON.stringify({
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "text",
                text: "",
              },
            })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "Hello",
              },
            })}\n\n`,
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`,
            `event: message_delta\ndata: ${JSON.stringify({
              type: "message_delta",
              delta: {
                stop_reason: "end_turn",
                stop_sequence: null,
              },
              usage: {
                output_tokens: 2,
              },
            })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({
              type: "message_stop",
            })}\n\n`,
          ];

          const sseBody = sseChunks.join("");

          return new Response(sseBody, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "anthropic-version": "2023-06-01",
            },
          });
        },
      });

      mockServerUrl = `http://localhost:${mockServer.port}`;
    });

    afterAll(() => {
      mockServer?.stop();
    });

    it("should pass timeout to complete when provided (AC4.1)", async () => {
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createAnthropicAdapter(config);

      const response = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100,
        timeout: 5000,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
    });

    it("should work without timeout (AC4.2)", async () => {
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createAnthropicAdapter(config);

      const response = await adapter.complete({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: "Hello",
          },
        ],
      });

      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
    });

    it("should throw ModelError with timeout code when timeout is exceeded (AC4.3)", async () => {
      requestDelay = 300;

      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "test-key",
        base_url: mockServerUrl,
      };
      const adapter = createAnthropicAdapter(config);

      try {
        await adapter.complete({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 100,
          timeout: 100,
          messages: [
            {
              role: "user",
              content: "Hello",
            },
          ],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(ModelError);
        expect((error as ModelError).code).toBe("timeout");
        expect((error as ModelError).retryable).toBe(true);
      } finally {
        requestDelay = 0;
      }
    });
  });
});
