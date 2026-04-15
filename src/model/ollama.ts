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
import { ModelError, type StreamEvent } from "./types.js";
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

export type OllamaStreamChunk = {
  model: string;
  message: {
    role: "assistant";
    content?: string;
    thinking?: string;
    tool_calls?: Array<OllamaToolCall>;
  };
  done: boolean;
  done_reason?: "stop" | "length";
  prompt_eval_count?: number;
  eval_count?: number;
};

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
  if (request.max_tokens !== undefined) {
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
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
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

export async function* parseNDJSON(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<OllamaStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new ModelError(
            "api_error",
            false,
            `malformed NDJSON line: ${trimmed}`
          );
        }

        const chunk = parsed as OllamaStreamChunk;

        if ((chunk as Record<string, unknown>)["error"]) {
          throw new ModelError(
            "api_error",
            false,
            `ollama streaming error: ${(chunk as Record<string, unknown>)["error"]}`
          );
        }

        yield chunk;
      }
    }

    // Process remaining buffer
    const trimmed = buffer.trim();
    if (trimmed) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new ModelError(
          "api_error",
          false,
          `malformed NDJSON line: ${trimmed}`
        );
      }

      const remaining = parsed as OllamaStreamChunk;

      if ((remaining as Record<string, unknown>)["error"]) {
        throw new ModelError(
          "api_error",
          false,
          `ollama streaming error: ${(remaining as Record<string, unknown>)["error"]}`
        );
      }

      yield remaining;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* mapChunksToStreamEvents(
  chunks: AsyncIterable<OllamaStreamChunk>
): AsyncGenerator<StreamEvent> {
  let thinkingStarted = false;
  let contentStarted = false;
  let blockIndex = 0;
  let lastChunk: OllamaStreamChunk | null = null;

  // Emit MessageStart
  yield {
    type: "message_start",
    message: {
      id: crypto.randomUUID(),
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };

  for await (const chunk of chunks) {
    lastChunk = chunk;

    // Handle thinking content
    if (chunk.message.thinking) {
      if (!thinkingStarted) {
        yield {
          type: "content_block_start",
          content_block: { type: "thinking", index: blockIndex },
        };
        thinkingStarted = true;
      }
      yield {
        type: "content_block_delta",
        delta: {
          type: "thinking_delta",
          text: chunk.message.thinking,
          index: blockIndex,
        },
      };
    }

    // Handle text content
    if (chunk.message.content) {
      if (thinkingStarted && !contentStarted) {
        // Transition from thinking to content — start new block
        blockIndex++;
      }
      if (!contentStarted) {
        yield {
          type: "content_block_start",
          content_block: { type: "text", index: blockIndex },
        };
        contentStarted = true;
      }
      yield {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: chunk.message.content,
          index: blockIndex,
        },
      };
    }

    // Handle tool calls (arrive in final chunk with done: true)
    if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
      for (const toolCall of chunk.message.tool_calls) {
        blockIndex++;
        const toolId = crypto.randomUUID();

        yield {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            index: blockIndex,
            id: toolId,
            name: toolCall.function.name,
          },
        };

        yield {
          type: "content_block_delta",
          delta: {
            type: "input_json_delta",
            input: JSON.stringify(toolCall.function.arguments),
            index: blockIndex,
          },
        };
      }
    }
  }

  // Emit MessageStop with stop reason from final chunk
  const stopReason: StopReason = lastChunk
    ? normalizeStopReason({
        message: lastChunk.message as OllamaChatResponse["message"],
        done: lastChunk.done,
        done_reason: lastChunk.done_reason,
        model: lastChunk.model,
      } as OllamaChatResponse)
    : "end_turn";

  yield {
    type: "message_stop",
    message: { stop_reason: stopReason },
  };
}

const DEFAULT_BASE_URL = "http://localhost:11434";

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  const baseUrl = config.base_url ?? DEFAULT_BASE_URL;

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return callWithRetry(
        async () => {
          const ollamaRequest = buildOllamaRequest(request, false);

          try {
            const response = await fetch(`${baseUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(ollamaRequest),
              ...(request.timeout != null ? { signal: AbortSignal.timeout(request.timeout) } : {}),
            });

            if (!response.ok) {
              const body = await response.text();
              throw classifyHttpError(response.status, body);
            }

            const data = (await response.json()) as OllamaChatResponse;
            return normalizeResponse(data);
          } catch (error) {
            if (error instanceof DOMException && error.name === "TimeoutError") {
              throw new ModelError("timeout", true, "request timed out");
            }
            throw error;
          }
        },
        isRetryableOllamaError
      );
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const ollamaRequest = buildOllamaRequest(request, true);

      const response = await callWithRetry(
        async () => {
          try {
            const res = await fetch(`${baseUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(ollamaRequest),
              ...(request.timeout != null ? { signal: AbortSignal.timeout(request.timeout) } : {}),
            });

            if (!res.ok) {
              const body = await res.text();
              throw classifyHttpError(res.status, body);
            }

            return res;
          } catch (error) {
            if (error instanceof DOMException && error.name === "TimeoutError") {
              throw new ModelError("timeout", true, "request timed out");
            }
            throw error;
          }
        },
        isRetryableOllamaError
      );

      if (!response.body) {
        throw new ModelError("api_error", false, "no response body for streaming");
      }

      yield* mapChunksToStreamEvents(parseNDJSON(response.body));
    },
  };
}
