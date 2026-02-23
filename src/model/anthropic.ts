// pattern: Imperative Shell

import Anthropic from "@anthropic-ai/sdk";
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
  if (error instanceof Anthropic.RateLimitError) {
    return true;
  }
  if (error instanceof Error && error.message.includes("timeout")) {
    return true;
  }
  return false;
}

function normalizeToolDefinitions(
  tools: ToolDefinition[]
): Anthropic.Messages.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Record<string, unknown>,
  })) as Anthropic.Messages.Tool[];
}

function normalizeContentBlocks(
  blocks: Anthropic.ContentBlock[]
): ContentBlock[] {
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
        input: block.input as Record<string, unknown>,
      };
    }
    throw new Error(`Unexpected block type: ${block.type}`);
  });
}

function normalizeUsage(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): UsageStats {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? undefined,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? undefined,
  };
}

function normalizeMessage(msg: Message): Anthropic.Messages.MessageParam {
  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    } as Anthropic.Messages.MessageParam;
  }

  const content: Anthropic.Messages.ContentBlockParam[] = msg.content.map((block) => {
    if (block.type === "text") {
      return {
        type: "text",
        text: block.text,
      } as Anthropic.Messages.TextBlockParam;
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      } as Anthropic.Messages.ToolUseBlockParam;
    }
    if (block.type === "tool_result") {
      const contentValue = typeof block.content === "string" ? block.content : block.content;
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: contentValue,
        is_error: block.is_error,
      } as Anthropic.Messages.ToolResultBlockParam;
    }
    throw new Error(`Unexpected content block type: ${(block as any).type}`);
  });

  return {
    role: msg.role,
    content,
  } as Anthropic.Messages.MessageParam;
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  onError?: (error: unknown, attempt: number) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (onError) {
        onError(error, attempt);
      }

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

export function createAnthropicAdapter(config: ModelConfig): ModelProvider {
  const apiKey = config.api_key || process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Anthropic adapter requires api_key in config or ANTHROPIC_API_KEY environment variable"
    );
  }

  const client = new Anthropic({
    apiKey,
  });

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await callWithRetry(async () => {
        try {
          return await client.messages.create({
            model: request.model,
            max_tokens: request.max_tokens,
            system: request.system,
            tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
            temperature: request.temperature,
            messages: request.messages.map(normalizeMessage) as Anthropic.Messages.MessageParam[],
          });
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) {
            throw new ModelError(
              "auth",
              false,
              error.message || "Authentication failed"
            );
          }
          if (error instanceof Anthropic.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "Rate limit exceeded"
            );
          }
          if (error instanceof Anthropic.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "API error"
            );
          }
          throw error;
        }
      });

      return {
        content: normalizeContentBlocks(response.content),
        stop_reason: response.stop_reason as any,
        usage: normalizeUsage(response.usage),
      };
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const stream = await callWithRetry(async () => {
        try {
          return await client.messages.stream({
            model: request.model,
            max_tokens: request.max_tokens,
            system: request.system,
            tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
            temperature: request.temperature,
            messages: request.messages.map(normalizeMessage),
          });
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) {
            throw new ModelError(
              "auth",
              false,
              error.message || "Authentication failed"
            );
          }
          if (error instanceof Anthropic.RateLimitError) {
            throw new ModelError(
              "rate_limit",
              true,
              error.message || "Rate limit exceeded"
            );
          }
          if (error instanceof Anthropic.APIError) {
            throw new ModelError(
              "api_error",
              false,
              error.message || "API error"
            );
          }
          throw error;
        }
      });

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
                id: (event.content_block as any).id,
                name: (event.content_block as any).name,
              }),
            },
          };
        } else if (event.type === "content_block_delta") {
          yield {
            type: "content_block_delta",
            delta: {
              type: event.delta.type,
              ...(event.delta.type === "text_delta" && {
                text: (event.delta as any).text,
              }),
              ...(event.delta.type === "input_json_delta" && {
                input: (event.delta as any).partial_json,
              }),
              index: event.index,
            },
          };
        } else if (event.type === "message_delta") {
          yield {
            type: "message_stop",
            message: {
              stop_reason: event.delta.stop_reason as any,
            },
          };
        }
      }
    },
  };
}
