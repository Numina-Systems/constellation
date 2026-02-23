// pattern: Imperative Shell

import OpenAI from "openai";
import type { ModelConfig } from "../config/schema.js";
import type {
  ContentBlock,
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  ToolDefinition,
  UsageStats,
} from "./types.js";
import { ModelError } from "./types.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.RateLimitError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("econnrefused")) {
      return true;
    }
  }
  return false;
}

function normalizeToolDefinitions(
  tools: ToolDefinition[]
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function normalizeContentBlocks(
  content: string | null,
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (content) {
    blocks.push({
      type: "text",
      text: content,
    });
  }

  if (toolCalls) {
    for (const toolCall of toolCalls) {
      blocks.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      });
    }
  }

  return blocks;
}

function normalizeStopReason(
  finishReason: string | null
): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
  if (finishReason === "tool_calls") {
    return "tool_use";
  }
  if (finishReason === "length") {
    return "max_tokens";
  }
  if (finishReason === "stop") {
    return "end_turn";
  }
  return "stop_sequence";
}

function normalizeUsage(usage: OpenAI.Completions.CompletionUsage): UsageStats {
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
  };
}

function normalizeMessage(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  const contentArray: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      contentArray.push({
        type: "text",
        text: block.text,
      });
    } else if (block.type === "tool_result") {
      // Tool results are passed as separate message with tool_results role
      // This is a limitation: OpenAI format separates tool results
      // For now, we'll serialize it as text
      contentArray.push({
        type: "text",
        text: `Tool result: ${typeof block.content === "string" ? block.content : JSON.stringify(block.content)}`,
      });
    }
  }

  return {
    role: msg.role,
    content: contentArray,
  } as OpenAI.Chat.ChatCompletionMessageParam;
}

async function callWithRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}

export function createOpenAICompatAdapter(config: ModelConfig): ModelProvider {
  const apiKey = config.api_key || process.env["OPENAI_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "OpenAI-compatible adapter requires api_key in config or OPENAI_API_KEY environment variable"
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.base_url,
  });

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await callWithRetry(async () => {
        try {
          const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

          if (request.system) {
            messages.push({
              role: "system",
              content: request.system,
            });
          }

          messages.push(...request.messages.map(normalizeMessage));

          return await client.chat.completions.create({
            model: request.model,
            max_tokens: request.max_tokens,
            tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
            temperature: request.temperature,
            messages,
          });
        } catch (error) {
          if (error instanceof OpenAI.AuthenticationError) {
            throw new ModelError(
              "auth",
              false,
              error.message || "Authentication failed"
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "Rate limit exceeded"
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "API error"
            );
          }
          throw error;
        }
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No choices in response");
      }

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        content: normalizeContentBlocks(
          choice.message.content,
          choice.message.tool_calls
        ),
        stop_reason: normalizeStopReason(choice.finish_reason),
        usage: normalizeUsage(usage as OpenAI.Completions.CompletionUsage),
      };
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const stream = await callWithRetry(async () => {
        try {
          const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

          if (request.system) {
            messages.push({
              role: "system",
              content: request.system,
            });
          }

          messages.push(...request.messages.map(normalizeMessage));

          return await client.chat.completions.create({
            model: request.model,
            max_tokens: request.max_tokens,
            tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
            temperature: request.temperature,
            messages,
            stream: true,
          });
        } catch (error) {
          if (error instanceof OpenAI.AuthenticationError) {
            throw new ModelError(
              "auth",
              false,
              error.message || "Authentication failed"
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "Rate limit exceeded"
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "API error"
            );
          }
          throw error;
        }
      });

      let messageId = "";
      const toolCallMap = new Map<number, { name: string; arguments: string }>();

      for await (const event of stream) {
        // Extract message ID from first chunk
        if (!messageId && event.id) {
          messageId = event.id;
          yield {
            type: "message_start",
            message: {
              id: messageId,
              usage: {
                input_tokens: 0,
                output_tokens: 0,
              },
            },
          };
        }

        const choice = event.choices[0];
        if (!choice) continue;

        // Handle content blocks
        if (choice.delta.content) {
          if (!toolCallMap.has(0)) {
            yield {
              type: "content_block_start",
              content_block: {
                type: "text",
                index: 0,
              },
            };
            toolCallMap.set(0, { name: "", arguments: "" });
          }

          yield {
            type: "content_block_delta",
            delta: {
              type: "text_delta",
              text: choice.delta.content,
              index: 0,
            },
          };
        }

        // Handle tool calls
        if (choice.delta.tool_calls) {
          for (const toolCall of choice.delta.tool_calls) {
            const index = toolCall.index;

            if (!toolCallMap.has(index)) {
              toolCallMap.set(index, { name: "", arguments: "" });

              yield {
                type: "content_block_start",
                content_block: {
                  type: "tool_use",
                  index,
                  id: toolCall.id,
                  name: toolCall.function?.name || "",
                },
              };
            }

            const current = toolCallMap.get(index);
            if (current) {
              if (toolCall.function?.name) {
                current.name = toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                current.arguments += toolCall.function.arguments;

                yield {
                  type: "content_block_delta",
                  delta: {
                    type: "input_json_delta",
                    input: current.arguments,
                    index,
                  },
                };
              }
            }
          }
        }

        // Handle finish reason
        if (choice.finish_reason) {
          yield {
            type: "message_stop",
            message: {
              stop_reason: normalizeStopReason(choice.finish_reason),
            },
          };
        }
      }
    },
  };
}
