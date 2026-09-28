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
import { buildCancellationRequestOptions, composeCancellation, isTimeoutCancellation } from "./cancellation.js";
import {
  isOpenAIUserAbort,
  normalizeToolDefinitions,
  normalizeContentBlocks,
  normalizeStopReason,
  normalizeUsage,
  normalizeMessages,
} from "./openai-shared.js";

function isRetryableError(error: unknown): boolean {
  if (isOpenAIUserAbort(error)) return false;
  if (error instanceof OpenAI.RateLimitError) {
    return true;
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
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
      const cancellation = composeCancellation({ signal: request.signal, deadline: request.deadline, timeout: request.timeout });
      try {
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

          return await client.chat.completions.create(
            {
              model: request.model,
              max_tokens: request.max_tokens,
              tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
              temperature: request.temperature,
              messages,
            },
            ...(request.timeout != null || request.signal != null || request.deadline != null
              ? [buildCancellationRequestOptions(cancellation)]
              : []),
          );
        } catch (error) {
          if (isOpenAIUserAbort(error)) {
            const timedOut = isTimeoutCancellation(cancellation.signal, request.deadline);
            throw new ModelError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "request timed out" : "request cancelled", timedOut, { provider: "openai-compat" });
          }
          if (error instanceof OpenAI.AuthenticationError) {
            throw new ModelError(
              "PROVIDER_UNAVAILABLE",
              error.message || "authentication failed",
              false,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.APIConnectionTimeoutError) {
            throw new ModelError(
              "TIMEOUT",
              error.message || "request timed out",
              true,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "RATE_LIMITED",
              error.message || "rate limit exceeded",
              true,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "INVALID_RESPONSE",
              error.message || "api error",
              false,
              { provider: "openai-compat" }
            );
          }
          throw error;
        }
        }, isRetryableError, undefined, { signal: cancellation.signal, deadline: request.deadline });

      const choice = response.choices?.[0];
      if (!choice) {
        const raw = JSON.stringify(response).slice(0, 500);
        throw new ModelError(
          "INVALID_RESPONSE",
          `no choices in response (model=${request.model}): ${raw}`,
          true,
          { provider: "openai-compat" }
        );
      }

      const usage = normalizeUsage(response.usage) ?? { input_tokens: 0, output_tokens: 0 };
      const reasoningContent = (choice.message as unknown as Record<string, unknown>)["reasoning_content"] as string | null | undefined;

      return {
        content: normalizeContentBlocks(
          choice.message.content,
          choice.message.tool_calls
        ),
        stop_reason: normalizeStopReason(choice.finish_reason),
        usage,
        reasoning_content: reasoningContent ?? null,
      };
      } finally {
        cancellation.dispose();
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const cancellation = composeCancellation({ signal: request.signal, deadline: request.deadline, timeout: request.timeout });
      let activeStream: { readonly controller: AbortController } | null = null;
      try {
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

          return await client.chat.completions.create(
            {
              model: request.model,
              max_tokens: request.max_tokens,
              tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
              temperature: request.temperature,
              messages,
              stream: true,
              ...(config.stream_usage === true ? { stream_options: { include_usage: true } } : {}),
            },
            ...(request.timeout != null || request.signal != null || request.deadline != null
              ? [buildCancellationRequestOptions(cancellation)]
              : []),
          );
        } catch (error) {
          if (isOpenAIUserAbort(error)) {
            const timedOut = isTimeoutCancellation(cancellation.signal, request.deadline);
            throw new ModelError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "request timed out" : "request cancelled", timedOut, { provider: "openai-compat" });
          }
          if (error instanceof OpenAI.AuthenticationError) {
            throw new ModelError(
              "PROVIDER_UNAVAILABLE",
              error.message || "authentication failed",
              false,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.APIConnectionTimeoutError) {
            throw new ModelError(
              "TIMEOUT",
              error.message || "request timed out",
              true,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.RateLimitError) {
            throw new ModelError(
              "RATE_LIMITED",
              error.message || "rate limit exceeded",
              true,
              { provider: "openai-compat" }
            );
          }
          if (error instanceof OpenAI.APIError) {
            throw new ModelError(
              "INVALID_RESPONSE",
              error.message || "api error",
              false,
              { provider: "openai-compat" }
            );
          }
          throw error;
        }
        }, isRetryableError, undefined, { signal: cancellation.signal, deadline: cancellation.deadline });
        activeStream = stream;

      let messageId = "";
      let finalUsage = null as ReturnType<typeof normalizeUsage>;
      let finalStopReason: ReturnType<typeof normalizeStopReason> = "end_turn";
      // TODO: toolCallMap is overloaded for text block tracking — introduce separate textBlockStarted flag (fix in both openrouter.ts and openai-compat.ts)
      const toolCallMap = new Map<number, { name: string; arguments: string }>();

      for await (const event of stream) {
        // Extract message ID from first chunk
        if (!messageId && event.id) {
          messageId = event.id;
          yield {
            type: "message_start",
            message: {
              id: messageId,
            },
          };
        }

        finalUsage = normalizeUsage(event.usage) ?? finalUsage;
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
        if (choice.finish_reason) finalStopReason = normalizeStopReason(choice.finish_reason);
      }
      if (cancellation.signal.aborted) {
        const timedOut = isTimeoutCancellation(cancellation.signal, cancellation.deadline);
        throw new ModelError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "request timed out" : "request cancelled", timedOut, { provider: "openai-compat" });
      }
      yield { type: "message_stop", message: { stop_reason: finalStopReason, ...(finalUsage ? { usage: finalUsage } : {}) } };
      } catch (error) {
        if (cancellation.signal.aborted || isOpenAIUserAbort(error)) {
          const timedOut = isTimeoutCancellation(cancellation.signal, request.deadline);
          throw new ModelError(timedOut ? "TIMEOUT" : "CANCELLED", timedOut ? "request timed out" : "request cancelled", timedOut, { provider: "openai-compat" });
        }
        throw error;
      } finally {
        activeStream?.controller.abort();
        cancellation.dispose();
      }
    },
  };
}
