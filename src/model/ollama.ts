// pattern: Imperative Shell

import type { ModelConfig } from "../config/schema.js";
import type {
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  ToolDefinition,
  ContentBlock,
  StopReason,
} from "./types.js";
import { ModelError } from "./types.js";
import { callWithRetry } from "./retry.js";

// Internal types for Ollama API contract
type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<OllamaToolCall>;
};

type OllamaToolCall = {
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaChatRequest = {
  model: string;
  messages: Array<OllamaMessage>;
  stream: boolean;
  tools?: Array<OllamaTool>;
  think?: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
};

type OllamaChatResponse = {
  model: string;
  message: OllamaMessage & { thinking?: string };
  done: boolean;
  done_reason?: "stop" | "length";
  prompt_eval_count?: number;
  eval_count?: number;
};

// Task 1: Tool definition translation
export function normalizeToolDefinitions(
  tools: ReadonlyArray<ToolDefinition>
): Array<OllamaTool> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

// Task 2: Message normalization
export function normalizeMessages(
  msgs: ReadonlyArray<Message>
): Array<OllamaMessage> {
  const result: Array<OllamaMessage> = [];

  for (const msg of msgs) {
    if (typeof msg.content === "string") {
      result.push({
        role: msg.role === "system" ? "system" : msg.role,
        content: msg.content,
      });
      continue;
    }

    const textBlocks = msg.content.filter(
      (b): b is TextBlock => b.type === "text"
    );
    const toolUseBlocks = msg.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );
    const toolResultBlocks = msg.content.filter(
      (b): b is ToolResultBlock => b.type === "tool_result"
    );

    if (msg.role === "assistant") {
      const textContent = textBlocks.map((b) => b.text).join("");
      const ollamaMsg: OllamaMessage = {
        role: "assistant",
        content: textContent,
      };

      if (toolUseBlocks.length > 0) {
        ollamaMsg.tool_calls = toolUseBlocks.map((b) => ({
          type: "function",
          function: {
            name: b.name,
            arguments: b.input,
          },
        }));
      }

      result.push(ollamaMsg);
    } else if (msg.role === "user" && toolResultBlocks.length > 0) {
      for (const block of toolResultBlocks) {
        const content =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        result.push({
          role: "tool",
          content,
        });
      }
    } else {
      const text = textBlocks.map((b) => b.text).join("\n");
      result.push({
        role: msg.role === "system" ? "system" : "user",
        content: text || "",
      });
    }
  }

  return result;
}

// Task 2: Request building
export function buildOllamaRequest(
  request: ModelRequest,
  stream: boolean
): OllamaChatRequest {
  const messages: Array<OllamaMessage> = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  messages.push(...normalizeMessages(request.messages));

  const ollamaRequest: OllamaChatRequest = {
    model: request.model,
    messages,
    stream,
    think: true,
  };

  if (request.tools && request.tools.length > 0) {
    ollamaRequest.tools = normalizeToolDefinitions(request.tools);
  }

  const options: OllamaChatRequest["options"] = {};
  if (request.max_tokens) {
    options.num_predict = request.max_tokens;
  }
  if (request.temperature !== undefined) {
    options.temperature = request.temperature;
  }
  if (Object.keys(options).length > 0) {
    ollamaRequest.options = options;
  }

  return ollamaRequest;
}

export function normalizeStopReason(
  response: OllamaChatResponse
): StopReason {
  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    return "tool_use";
  }
  if (response.done_reason === "length") {
    return "max_tokens";
  }
  return "end_turn";
}

export function normalizeResponse(response: OllamaChatResponse): ModelResponse {
  const content: Array<ContentBlock> = [];

  if (response.message.content) {
    content.push({
      type: "text",
      text: response.message.content,
    });
  }

  if (response.message.tool_calls) {
    for (const toolCall of response.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: crypto.randomUUID(),
        name: toolCall.function.name,
        input: toolCall.function.arguments,
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    content,
    stop_reason: normalizeStopReason(response),
    usage: {
      input_tokens: response.prompt_eval_count ?? 0,
      output_tokens: response.eval_count ?? 0,
    },
    reasoning_content: response.message.thinking ?? null,
  };
}

export function classifyHttpError(status: number, body: string): ModelError {
  if (status === 429) {
    return new ModelError("rate_limit", true, `rate limit exceeded: ${body}`);
  }
  if (status === 500 || status === 502) {
    return new ModelError("api_error", true, `server error (${status}): ${body}`);
  }
  return new ModelError("api_error", false, `request failed (${status}): ${body}`);
}

export function isRetryableOllamaError(error: unknown): boolean {
  if (error instanceof ModelError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("econnrefused") ||
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("timeout")
    ) {
      return true;
    }
  }
  return false;
}

const DEFAULT_BASE_URL = "http://localhost:11434";

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  const baseUrl = config.base_url ?? DEFAULT_BASE_URL;

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return callWithRetry(
        async () => {
          const ollamaRequest = buildOllamaRequest(request, false);

          const response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ollamaRequest),
          });

          if (!response.ok) {
            const body = await response.text();
            throw classifyHttpError(response.status, body);
          }

          const data = (await response.json()) as OllamaChatResponse;
          return normalizeResponse(data);
        },
        isRetryableOllamaError
      );
    },

    async *stream(_request: ModelRequest): AsyncIterable<any> {
      throw new Error("Ollama streaming not yet implemented");
    },
  };
}
