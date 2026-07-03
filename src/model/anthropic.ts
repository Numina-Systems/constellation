// pattern: Imperative Shell
//
// Cache-friendly Anthropic prompt caching implementation:
// Anthropic renders requests as tools → system → messages.
// A cache_control breakpoint on the system param's final block caches tools + system together.
// A breakpoint on the final message's final content block caches conversation incrementally.
// Two breakpoints total, within Anthropic's limit of 4.
//
// Known limitation (20-block lookback): Anthropic's cache lookup window is 20 content blocks.
// If a single turn generates >20 new blocks, the previous cache entry is not found—the prefix
// is recalculated. This is expected and harmless; revisit only if observed in production.

import Anthropic from "@anthropic-ai/sdk";
import type { ModelConfig } from "../config/schema.js";
import type {
  ContentBlock,
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  TextBlock,
  ToolDefinition,
  UsageStats,
} from "./types.js";
import { ModelError } from "./types.js";
import { callWithRetry } from "./retry.js";

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) {
    return true;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return true;
  }
  if (error instanceof Error && error.message.includes("timeout")) {
    return true;
  }
  return false;
}

export function buildAnthropicSystemParam(
  requestSystem: string | undefined,
  messages: ReadonlyArray<Message>,
): Array<Anthropic.Messages.TextBlockParam> | undefined {
  const systemContents: Array<string> = [];

  if (requestSystem !== undefined) {
    systemContents.push(requestSystem);
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
      if (text) {
        systemContents.push(text);
      }
    }
  }

  const concatenated = systemContents.length > 0 ? systemContents.join("\n\n") : undefined;

  if (concatenated === undefined) {
    return undefined;
  }

  return [
    {
      type: "text" as const,
      text: concatenated,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

export function applyCacheControlToLastBlock(
  messages: Array<Anthropic.Messages.MessageParam>,
): Array<Anthropic.Messages.MessageParam> {
  if (messages.length === 0) {
    return messages;
  }

  const last = messages[messages.length - 1]!;
  const ephemeral = { type: "ephemeral" as const };

  const content =
    typeof last.content === "string"
      ? [{ type: "text" as const, text: last.content, cache_control: ephemeral }]
      : last.content.map((block, i) =>
          i === last.content.length - 1 ? { ...block, cache_control: ephemeral } : block,
        );

  return [...messages.slice(0, -1), { ...last, content }];
}

function buildRequestParams(request: ModelRequest): {
  system: Array<Anthropic.Messages.TextBlockParam> | undefined;
  messages: Array<Anthropic.Messages.MessageParam>;
  tools: Array<Anthropic.Messages.Tool> | undefined;
  model: string;
  max_tokens: number;
  temperature?: number;
  timeout?: number;
} {
  const systemParam = buildAnthropicSystemParam(request.system, request.messages);
  const nonSystemMessages = request.messages.filter((m) => m.role !== "system");
  const normalizedMessages = nonSystemMessages.map(normalizeMessage) as Array<Anthropic.Messages.MessageParam>;
  const messagesWithCache = applyCacheControlToLastBlock(normalizedMessages);

  return {
    system: systemParam,
    messages: messagesWithCache,
    tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
    model: request.model,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
    timeout: request.timeout,
  };
}

function normalizeToolDefinitions(
  tools: ReadonlyArray<ToolDefinition>
): Array<Anthropic.Messages.Tool> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Record<string, unknown>,
  })) as Array<Anthropic.Messages.Tool>;
}

function normalizeContentBlocks(
  blocks: Array<Anthropic.ContentBlock>
): Array<ContentBlock> {
  return blocks.map((block): ContentBlock => {
    if (block.type === "text") {
      return {
        type: "text",
        text: block.text,
      };
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>, // Anthropic SDK types input as unknown; we've validated via discriminator
      };
    }
    throw new Error(`Unexpected block type: ${block.type}`);
  });
}

function normalizeUsage(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): UsageStats {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
  };
}

function normalizeStopReasonAnthropicToCommon(reason: string): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

export function normalizeMessage(msg: Message): Anthropic.Messages.MessageParam {
  if (msg.role === "system") {
    throw new Error("system-role messages must be extracted before normalizeMessage");
  }

  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    } as Anthropic.Messages.MessageParam;
  }

  const content: Array<Anthropic.Messages.ContentBlockParam> = msg.content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text",
        text: block.text,
      } as Anthropic.Messages.TextBlockParam; // SDK requires explicit type cast for discriminated union
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      } as Anthropic.Messages.ToolUseBlockParam; // SDK requires explicit type cast for discriminated union
    }
    if (block.type === "tool_result") {
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      } as Anthropic.Messages.ToolResultBlockParam; // SDK requires explicit type cast for discriminated union
    }
    throw new Error(`Unexpected content block type: ${(block as unknown as Record<string, unknown>)["type"]}`);
  });

  return {
    role: msg.role,
    content,
  } as Anthropic.Messages.MessageParam;
}


export function createAnthropicAdapter(config: ModelConfig): ModelProvider {
  const apiKey = config.api_key || process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "anthropic adapter requires api_key in config or ANTHROPIC_API_KEY environment variable"
    );
  }

  const client = new Anthropic({
    apiKey,
    ...(config.base_url != null ? { baseURL: config.base_url } : {}),
  });

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await callWithRetry(async () => {
        try {
          const params = buildRequestParams(request);

          const stream = client.messages.stream(
            {
              model: params.model,
              max_tokens: params.max_tokens,
              system: params.system,
              tools: params.tools,
              temperature: params.temperature,
              messages: params.messages,
            },
            ...(params.timeout != null ? [{ timeout: params.timeout }] : []),
          );
          return await stream.finalMessage();
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) {
            throw new ModelError(
              "PROVIDER_UNAVAILABLE",
              error.message || "authentication failed",
              false,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.APIConnectionTimeoutError) {
            throw new ModelError(
              "TIMEOUT",
              error.message || "request timed out",
              true,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.RateLimitError) {
            throw new ModelError(
              "RATE_LIMITED",
              error.message || "rate limit exceeded",
              true,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.APIError) {
            throw new ModelError(
              "INVALID_RESPONSE",
              error.message || "api error",
              false,
              { provider: "anthropic" }
            );
          }
          throw error;
        }
      }, isRetryableError);

      return {
        content: normalizeContentBlocks(response.content),
        stop_reason: normalizeStopReasonAnthropicToCommon(response.stop_reason ?? "end_turn"),
        usage: normalizeUsage(response.usage),
      };
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const stream = await callWithRetry(async () => {
        try {
          const params = buildRequestParams(request);

          return await client.messages.stream(
            {
              model: params.model,
              max_tokens: params.max_tokens,
              system: params.system,
              tools: params.tools,
              temperature: params.temperature,
              messages: params.messages,
            },
            ...(params.timeout != null ? [{ timeout: params.timeout }] : []),
          );
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) {
            throw new ModelError(
              "PROVIDER_UNAVAILABLE",
              error.message || "authentication failed",
              false,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.APIConnectionTimeoutError) {
            throw new ModelError(
              "TIMEOUT",
              error.message || "request timed out",
              true,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.RateLimitError) {
            throw new ModelError(
              "RATE_LIMITED",
              error.message || "rate limit exceeded",
              true,
              { provider: "anthropic" }
            );
          }
          if (error instanceof Anthropic.APIError) {
            throw new ModelError(
              "INVALID_RESPONSE",
              error.message || "api error",
              false,
              { provider: "anthropic" }
            );
          }
          throw error;
        }
      }, isRetryableError);

      for await (const event of stream) {
        if (event.type === "message_start") {
          yield {
            type: "message_start",
            message: {
              id: event.message.id,
              usage: normalizeUsage(event.message.usage),
            },
          };
        } else if (event.type === "content_block_start") {
          yield {
            type: "content_block_start",
            content_block: {
              type: event.content_block.type,
              index: event.index,
              ...(event.content_block.type === "tool_use" && {
                // SDK types content_block as generic ContentBlock; tool_use variant has id and name
                id: (event.content_block as unknown as { id?: string }).id,
                name: (event.content_block as unknown as { name?: string }).name,
              }),
            },
          };
        } else if (event.type === "content_block_delta") {
          yield {
            type: "content_block_delta",
            delta: {
              type: event.delta.type,
              ...(event.delta.type === "text_delta" && {
                // SDK types delta as generic ContentBlockDelta; text_delta variant has text property
                text: (event.delta as unknown as { text?: string }).text,
              }),
              ...(event.delta.type === "input_json_delta" && {
                // SDK types delta as generic ContentBlockDelta; input_json_delta variant has partial_json
                input: (event.delta as unknown as { partial_json?: string }).partial_json,
              }),
              index: event.index,
            },
          };
        } else if (event.type === "message_delta") {
          yield {
            type: "message_stop",
            message: {
              // SDK types stop_reason as string; we map to normalized StopReason type via function
              stop_reason: normalizeStopReasonAnthropicToCommon(event.delta.stop_reason ?? "end_turn"),
            },
          };
        }
      }
    },
  };
}
