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
import type { ServerRateLimitSync } from "../rate-limit/types.js";
import {
  normalizeMessages,
  normalizeToolDefinitions,
  normalizeContentBlocks,
  normalizeStopReason,
  normalizeUsage,
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

function classifyError(error: unknown): never {
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

export function createOpenRouterAdapter(
  config: ModelConfig,
  onServerRateLimit?: ServerRateLimitSync
): ModelProvider {
  const apiKey = config.api_key || "unused";

  let lastResponseHeaders: Headers | null = null;

  const customFetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    // Inject attribution headers into the request
    const headers = new Headers(init?.headers);
    if (config.openrouter?.referer) {
      headers.set("HTTP-Referer", config.openrouter.referer);
    }
    if (config.openrouter?.title) {
      headers.set("X-Title", config.openrouter.title);
    }

    const response = await fetch(input, { ...init, headers });
    lastResponseHeaders = response.headers;
    return response;
  };

  const client = new OpenAI({
    apiKey,
    baseURL: config.base_url ?? "https://openrouter.ai/api/v1",
    fetch: customFetch,
  });

  function extractAndLogHeaders(
    model: string,
    usage: { input_tokens: number; output_tokens: number }
  ): void {
    if (!lastResponseHeaders) return;

    const cost = lastResponseHeaders.get("x-openrouter-cost");
    if (cost) {
      console.info(
        `[openrouter] cost=$${cost} model=${model} tokens=${usage.input_tokens}/${usage.output_tokens}`
      );
    }

    if (onServerRateLimit) {
      const limit = lastResponseHeaders.get("x-ratelimit-limit");
      const remaining = lastResponseHeaders.get("x-ratelimit-remaining");
      const reset = lastResponseHeaders.get("x-ratelimit-reset");

      if (limit && remaining && reset) {
        onServerRateLimit({
          limit: parseInt(limit, 10),
          remaining: parseInt(remaining, 10),
          resetAt: parseInt(reset, 10),
        });
      }
    }
  }

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

          const body: Record<string, unknown> = {
            model: request.model,
            max_tokens: request.max_tokens,
            tools: request.tools
              ? normalizeToolDefinitions(request.tools)
              : undefined,
            temperature: request.temperature,
            messages,
          };

          // Add OpenRouter provider routing
          if (
            config.openrouter?.sort ||
            config.openrouter?.allow_fallbacks !== undefined
          ) {
            body["provider"] = {
              ...(config.openrouter.sort
                ? { sort: config.openrouter.sort }
                : {}),
              ...(config.openrouter.allow_fallbacks !== undefined
                ? { allow_fallbacks: config.openrouter.allow_fallbacks }
                : {}),
            };
          }

          return await client.chat.completions.create(
            body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
          );
        } catch (error) {
          classifyError(error);
        }
      }, isRetryableError);

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No choices in response");
      }

      const usage = response.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      const reasoningContent = (
        choice.message as unknown as Record<string, unknown>
      )["reasoning_content"] as string | null | undefined;

      extractAndLogHeaders(request.model, {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
      });

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

          const body: Record<string, unknown> = {
            model: request.model,
            max_tokens: request.max_tokens,
            tools: request.tools
              ? normalizeToolDefinitions(request.tools)
              : undefined,
            temperature: request.temperature,
            messages,
            stream: true,
          };

          // Add OpenRouter provider routing
          if (
            config.openrouter?.sort ||
            config.openrouter?.allow_fallbacks !== undefined
          ) {
            body["provider"] = {
              ...(config.openrouter.sort
                ? { sort: config.openrouter.sort }
                : {}),
              ...(config.openrouter.allow_fallbacks !== undefined
                ? { allow_fallbacks: config.openrouter.allow_fallbacks }
                : {}),
            };
          }

          return await client.chat.completions.create(
            body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming
          );
        } catch (error) {
          classifyError(error);
        }
      }, isRetryableError);

      // Log cost from initial response headers (captured by custom fetch)
      extractAndLogHeaders(request.model, { input_tokens: 0, output_tokens: 0 });

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

        // Mid-stream error detection (AC7.1)
        // OpenRouter may return finish_reason: "error" which is not in standard OpenAI types
        const finishReason = choice.finish_reason as string | null;
        if (finishReason === "error") {
          throw new ModelError(
            "api_error",
            true,
            "openrouter upstream provider error during streaming"
          );
        }

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
