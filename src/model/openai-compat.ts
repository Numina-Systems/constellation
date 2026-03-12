// pattern: Imperative Shell

import OpenAI from "openai";
import type { ModelConfig } from "../config/schema.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from "./types.js";
import { ModelError } from "./types.js";
import { callWithRetry } from "./retry.js";
import {
  normalizeToolDefinitions,
  normalizeContentBlocks,
  normalizeStopReason,
  normalizeUsage,
  normalizeMessages,
} from "./openai-shared.js";

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

export { normalizeMessages } from "./openai-shared.js";


export function createOpenAICompatAdapter(config: ModelConfig): ModelProvider {
  const apiKey = config.api_key || "unused";

  const client = new OpenAI({
    apiKey,
    baseURL: config.base_url,
  });

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await callWithRetry(async () => {
        try {
          const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = [];

          if (request.system) {
            messages.push({
              role: "system",
              content: request.system,
            });
          }

          messages.push(...normalizeMessages(request.messages));

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
              error.message || "authentication failed"
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "rate limit exceeded"
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "api error"
            );
          }
          throw error;
        }
      }, isRetryableError);

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No choices in response");
      }

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      const reasoningContent = (choice.message as unknown as Record<string, unknown>)["reasoning_content"] as string | null | undefined;

      return {
        content: normalizeContentBlocks(
          choice.message.content,
          choice.message.tool_calls
        ),
        stop_reason: normalizeStopReason(choice.finish_reason),
        usage: normalizeUsage(usage as OpenAI.Completions.CompletionUsage),
        reasoning_content: reasoningContent ?? null,
      };
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const stream = await callWithRetry(async () => {
        try {
          const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = [];

          if (request.system) {
            messages.push({
              role: "system",
              content: request.system,
            });
          }

          messages.push(...normalizeMessages(request.messages));

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
              error.message || "authentication failed"
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "rate limit exceeded"
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "api error"
            );
          }
          throw error;
        }
      }, isRetryableError);

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
                const chunk = toolCall.function.arguments;
                current.arguments += chunk;

                yield {
                  type: "content_block_delta",
                  delta: {
                    type: "input_json_delta",
                    input: chunk,
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
