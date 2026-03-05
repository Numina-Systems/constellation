// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import {
  normalizeToolDefinitions,
  normalizeMessages,
  buildOllamaRequest,
} from "./ollama.js";
import type { Message, ToolDefinition, ModelRequest } from "./types.js";

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
