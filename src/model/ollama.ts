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
} from "./types.js";

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

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  return {
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      throw new Error(
        `Ollama adapter not yet implemented (model: ${config.name})`
      );
    },
    stream(_request: ModelRequest) {
      throw new Error(
        `Ollama adapter not yet implemented (model: ${config.name})`
      );
    },
  };
}
