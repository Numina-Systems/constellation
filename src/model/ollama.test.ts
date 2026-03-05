// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import {
  normalizeToolDefinitions,
  normalizeMessages,
  buildOllamaRequest,
  normalizeResponse,
  normalizeStopReason,
  classifyHttpError,
  isRetryableOllamaError,
} from "./ollama.js";
import type { Message, ToolDefinition, ModelRequest } from "./types.js";
import { ModelError } from "./types.js";

// ollama-adapter.AC3.1: Tool definition translation
describe("normalizeToolDefinitions", () => {
  it("should translate a single ToolDefinition to Ollama format", () => {
    const tools: ReadonlyArray<ToolDefinition> = [
      {
        name: "get_weather",
        description: "Get the weather for a location",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
        },
      },
    ];

    const result = normalizeToolDefinitions(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
        },
      },
    });
  });

  it("should translate multiple ToolDefinitions correctly", () => {
    const tools: ReadonlyArray<ToolDefinition> = [
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object" },
      },
      {
        name: "search",
        description: "Search the web",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    ];

    const result = normalizeToolDefinitions(tools);

    expect(result).toHaveLength(2);
    expect(result[0]!.function.name).toBe("get_weather");
    expect(result[1]!.function.name).toBe("search");
  });

  it("should return empty array for empty input", () => {
    const tools: ReadonlyArray<ToolDefinition> = [];
    const result = normalizeToolDefinitions(tools);
    expect(result).toHaveLength(0);
  });
});

// ollama-adapter.AC3.4: ToolResultBlock to tool role message
describe("normalizeMessages with ToolResultBlock", () => {
  it("should map user message with ToolResultBlock (string content) to role:tool", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_123",
            content: "Weather is sunny",
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "tool",
      content: "Weather is sunny",
    });
  });

  it("should map user message with ToolResultBlock (array content) to JSON string", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_456",
            content: [{ type: "text", text: "result" }],
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("tool");
    expect(result[0]!.content).toBe(JSON.stringify([{ type: "text", text: "result" }]));
  });

  it("should create multiple tool role messages for multiple ToolResultBlocks", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "Result 1",
          },
          {
            type: "tool_result",
            tool_use_id: "tool_2",
            content: "Result 2",
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      role: "tool",
      content: "Result 1",
    });
    expect(result[1]).toEqual({
      role: "tool",
      content: "Result 2",
    });
  });
});

// ollama-adapter.AC4.1: Think parameter in request
describe("buildOllamaRequest with think parameter", () => {
  it("should always include think:true in the request", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.think).toBe(true);
  });
});

// Additional normalization tests
describe("normalizeMessages with various content types", () => {
  it("should handle system role messages with string content", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    });
  });

  it("should handle user string content", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: "Hello world",
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: "Hello world",
    });
  });

  it("should handle assistant string content", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "assistant",
        content: "Hi there!",
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: "Hi there!",
    });
  });

  it("should handle assistant with ToolUseBlock with object arguments", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_123",
            name: "get_weather",
            input: { location: "Boston", unit: "fahrenheit" },
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("assistant");
    expect(result[0]!.tool_calls).toBeDefined();
    expect(result[0]!.tool_calls![0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        arguments: { location: "Boston", unit: "fahrenheit" },
      },
    });
  });

  it("should verify tool_calls arguments are objects, not JSON strings", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_456",
            name: "search",
            input: { query: "AI", limit: 10 },
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    const toolCall = result[0]!.tool_calls![0];
    expect(typeof toolCall!.function.arguments).toBe("object");
    expect(toolCall!.function.arguments).not.toBe(
      JSON.stringify({ query: "AI", limit: 10 })
    );
  });

  it("should handle user message with TextBlock content", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: "Hello",
    });
  });

  it("should join multiple TextBlocks with newline", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Line 1",
          },
          {
            type: "text",
            text: "Line 2",
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: "Line 1\nLine 2",
    });
  });

  it("should join assistant TextBlocks without newline", () => {
    const messages: ReadonlyArray<Message> = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
          },
          {
            type: "text",
            text: " world",
          },
        ],
      },
    ];

    const result = normalizeMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Hello world");
  });
});

describe("buildOllamaRequest", () => {
  it("should build request with system string from ModelRequest", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      system: "You are a helpful assistant",
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    });
    expect(result.messages[1]).toEqual({
      role: "user",
      content: "Hello",
    });
  });

  it("should set stream parameter correctly", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const resultStreaming = buildOllamaRequest(request, true);
    const resultNonStreaming = buildOllamaRequest(request, false);

    expect(resultStreaming.stream).toBe(true);
    expect(resultNonStreaming.stream).toBe(false);
  });

  it("should map max_tokens to options.num_predict", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.options).toBeDefined();
    expect(result.options!.num_predict).toBe(500);
  });

  it("should map temperature to options.temperature", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.options).toBeDefined();
    expect(result.options!.temperature).toBe(0.7);
  });

  it("should omit temperature from options if not provided", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.options).toBeDefined();
    expect(result.options!.temperature).toBeUndefined();
  });

  it("should not include options if only max_tokens is undefined", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 0, // Falsy value
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    // max_tokens of 0 is falsy, so it won't be included
    expect(result.options).toBeUndefined();
  });

  it("should include tools in request when provided", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Use the tool",
        },
      ],
      tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: { type: "object" },
        },
      ],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.tools).toBeDefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0]).toEqual({
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: { type: "object" },
      },
    });
  });

  it("should not include tools if empty array provided", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
      tools: [],
    };

    const result = buildOllamaRequest(request, false);

    expect(result.tools).toBeUndefined();
  });

  it("should build complete request with all parameters", () => {
    const request: ModelRequest = {
      model: "neural-chat",
      max_tokens: 200,
      temperature: 0.8,
      system: "You are helpful",
      messages: [
        {
          role: "user",
          content: "Help me",
        },
      ],
      tools: [
        {
          name: "tool1",
          description: "A tool",
          input_schema: { type: "object" },
        },
      ],
    };

    const result = buildOllamaRequest(request, true);

    expect(result.model).toBe("neural-chat");
    expect(result.stream).toBe(true);
    expect(result.think).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are helpful",
    });
    expect(result.options).toBeDefined();
    expect(result.options!.num_predict).toBe(200);
    expect(result.options!.temperature).toBe(0.8);
    expect(result.tools).toHaveLength(1);
  });
});

// ollama-adapter.AC3.2: Tool calls map to ToolUseBlock with UUIDs
describe("normalizeResponse - tool calls", () => {
  it("should map single tool call to ToolUseBlock with valid UUID", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Calling tool",
        tool_calls: [
          {
            type: "function" as const,
            function: {
              name: "get_weather",
              arguments: { location: "Boston" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    expect(result.content).toHaveLength(2); // text + tool_use
    const toolUseBlock = result.content.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock?.type).toBe("tool_use");
    if (toolUseBlock?.type === "tool_use") {
      expect(toolUseBlock.id).toBeDefined();
      // Check UUID format (v4)
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidPattern.test(toolUseBlock.id)).toBe(true);
      expect(toolUseBlock.name).toBe("get_weather");
      expect(toolUseBlock.input).toEqual({ location: "Boston" });
    }
  });

  it("should generate unique UUIDs for each tool call", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "",
        tool_calls: [
          {
            type: "function" as const,
            function: {
              name: "tool1",
              arguments: { arg1: "value1" },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "tool2",
              arguments: { arg2: "value2" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
    expect(toolUseBlocks).toHaveLength(2);

    const ids = toolUseBlocks
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as any).id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ollama-adapter.AC3.3: Stop reason when tool_calls present
describe("normalizeStopReason", () => {
  it("should return tool_use when tool_calls present", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Calling tool",
        tool_calls: [
          {
            type: "function" as const,
            function: {
              name: "get_weather",
              arguments: {},
            },
          },
        ],
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeStopReason(response);
    expect(result).toBe("tool_use");
  });

  it("should return end_turn when no tool_calls and done_reason is stop", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Hello",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeStopReason(response);
    expect(result).toBe("end_turn");
  });

  it("should return max_tokens when done_reason is length", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Hello",
      },
      done: true,
      done_reason: "length" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeStopReason(response);
    expect(result).toBe("max_tokens");
  });
});

// ollama-adapter.AC3.5: Multiple parallel tool calls
describe("normalizeResponse - multiple tool calls", () => {
  it("should map multiple tool calls to multiple ToolUseBlocks with unique UUIDs", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "",
        tool_calls: [
          {
            type: "function" as const,
            function: {
              name: "search",
              arguments: { query: "AI" },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "get_weather",
              arguments: { location: "NYC" },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "calculate",
              arguments: { expr: "2+2" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
    expect(toolUseBlocks).toHaveLength(3);

    expect((toolUseBlocks[0] as any).name).toBe("search");
    expect((toolUseBlocks[1] as any).name).toBe("get_weather");
    expect((toolUseBlocks[2] as any).name).toBe("calculate");

    // Verify all IDs are unique
    const ids = toolUseBlocks.map((b) => (b as any).id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });
});

// ollama-adapter.AC4.2: Thinking maps to reasoning_content
describe("normalizeResponse - thinking", () => {
  it("should map message.thinking to reasoning_content", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Answer",
        thinking: "Let me think about this...",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    expect(result.reasoning_content).toBe("Let me think about this...");
  });

  it("should set reasoning_content to null when thinking is absent", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Answer",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    expect(result.reasoning_content).toBeNull();
  });
});

// ollama-adapter.AC5.1: HTTP 429 → rate_limit, retryable
describe("classifyHttpError - rate limiting", () => {
  it("should classify 429 as rate_limit with retryable true", () => {
    const error = classifyHttpError(429, "Too many requests");

    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("rate_limit");
    expect(error.retryable).toBe(true);
  });
});

// ollama-adapter.AC5.2: HTTP 500/502 → api_error, retryable
describe("classifyHttpError - server errors", () => {
  it("should classify 500 as api_error with retryable true", () => {
    const error = classifyHttpError(500, "Internal server error");

    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("api_error");
    expect(error.retryable).toBe(true);
  });

  it("should classify 502 as api_error with retryable true", () => {
    const error = classifyHttpError(502, "Bad gateway");

    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("api_error");
    expect(error.retryable).toBe(true);
  });
});

// ollama-adapter.AC5.3: HTTP 400/404 → api_error, not retryable
describe("classifyHttpError - client errors", () => {
  it("should classify 400 as api_error with retryable false", () => {
    const error = classifyHttpError(400, "Bad request");

    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("api_error");
    expect(error.retryable).toBe(false);
  });

  it("should classify 404 as api_error with retryable false", () => {
    const error = classifyHttpError(404, "Not found");

    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("api_error");
    expect(error.retryable).toBe(false);
  });
});

// ollama-adapter.AC5.4: Network errors are retryable
describe("isRetryableOllamaError", () => {
  it("should return true for ECONNREFUSED error", () => {
    const error = new Error("ECONNREFUSED");

    expect(isRetryableOllamaError(error)).toBe(true);
  });

  it("should return true for fetch failed error", () => {
    const error = new Error("fetch failed");

    expect(isRetryableOllamaError(error)).toBe(true);
  });

  it("should return true for network error", () => {
    const error = new Error("network error");

    expect(isRetryableOllamaError(error)).toBe(true);
  });

  it("should return true for timeout error", () => {
    const error = new Error("timeout");

    expect(isRetryableOllamaError(error)).toBe(true);
  });

  it("should return false for non-network error", () => {
    const error = new Error("some other error");

    expect(isRetryableOllamaError(error)).toBe(false);
  });

  it("should return false for non-retryable ModelError", () => {
    const error = new ModelError("api_error", false, "not retryable");

    expect(isRetryableOllamaError(error)).toBe(false);
  });

  it("should return true for retryable ModelError", () => {
    const error = new ModelError("rate_limit", true, "retryable");

    expect(isRetryableOllamaError(error)).toBe(true);
  });
});

// ollama-adapter.AC2.1: ModelResponse has non-empty content
describe("normalizeResponse - content invariant", () => {
  it("should always have non-empty content array", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Hello",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    expect(result.content.length).toBeGreaterThan(0);
  });

  it("should add fallback text block when content is empty", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 10,
      eval_count: 20,
    };

    const result = normalizeResponse(response);

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]?.type).toBe("text");
  });

  it("should include usage stats from response", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant" as const,
        content: "Hello",
      },
      done: true,
      done_reason: "stop" as const,
      prompt_eval_count: 15,
      eval_count: 25,
    };

    const result = normalizeResponse(response);

    expect(result.usage.input_tokens).toBe(15);
    expect(result.usage.output_tokens).toBe(25);
  });
});
