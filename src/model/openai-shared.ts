// pattern: Functional Core (throws on malformed input)

import OpenAI from "openai";
import type {
  ContentBlock,
  Message,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolDefinition,
  UsageStats,
} from "./types.js";
import { ModelError } from "./types.js";

export function normalizeToolDefinitions(
  tools: ReadonlyArray<ToolDefinition>
): Array<OpenAI.Chat.ChatCompletionTool> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function normalizeContentBlocks(
  content: string | null,
  toolCalls: Array<OpenAI.Chat.ChatCompletionMessageToolCall> | undefined
): Array<ContentBlock> {
  const blocks: Array<ContentBlock> = [];

  if (content) {
    blocks.push({
      type: "text",
      text: content,
    });
  }

  if (toolCalls) {
    for (const toolCall of toolCalls) {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        throw new ModelError(
          "api_error",
          false,
          `failed to parse tool call arguments: ${toolCall.function.arguments}`
        );
      }
      blocks.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input,
      });
    }
  }

  return blocks;
}

export function normalizeStopReason(
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

export function normalizeUsage(usage: OpenAI.Completions.CompletionUsage): UsageStats {
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
  };
}

export function normalizeMessages(msgs: ReadonlyArray<Message>): Array<OpenAI.Chat.ChatCompletionMessageParam> {
  const result: Array<OpenAI.Chat.ChatCompletionMessageParam> = [];

  for (const msg of msgs) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
      result.push({ role: "system", content: text });
      continue;
    }

    if (typeof msg.content === "string") {
      if (msg.role === "assistant" && msg.reasoning_content) {
        result.push({
          role: "assistant",
          content: msg.content,
          reasoning_content: msg.reasoning_content,
        } as OpenAI.Chat.ChatCompletionMessageParam);
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
      continue;
    }

    const textBlocks = msg.content.filter((b): b is TextBlock => b.type === "text");
    const toolUseBlocks = msg.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const toolResultBlocks = msg.content.filter((b): b is ToolResultBlock => b.type === "tool_result");

    if (msg.role === "assistant") {
      const textContent = textBlocks.map((b) => b.text).join("") || null;
      const toolCalls: Array<OpenAI.Chat.ChatCompletionMessageToolCall> = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function" as const,
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input),
        },
      }));

      result.push({
        role: "assistant",
        content: textContent,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
      } as OpenAI.Chat.ChatCompletionMessageParam);
    } else if (msg.role === "user" && toolResultBlocks.length > 0) {
      for (const block of toolResultBlocks) {
        const content = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content);
        result.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content,
        });
      }
    } else {
      const contentParts: Array<OpenAI.Chat.ChatCompletionContentPart> = textBlocks.map((b) => ({
        type: "text" as const,
        text: b.text,
      }));
      if (contentParts.length > 0) {
        result.push({ role: "user", content: contentParts });
      } else {
        result.push({ role: "user", content: "" });
      }
    }
  }

  return result;
}
