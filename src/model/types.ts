// pattern: Functional Core

/**
 * Shared types for model providers.
 * These types define the port interface that all model adapters normalize to.
 */

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type Message = {
  role: "user" | "assistant";
  content: string | Array<ContentBlock>;
};

export type ModelRequest = {
  messages: ReadonlyArray<Message>;
  system?: string;
  tools?: ReadonlyArray<ToolDefinition>;
  model: string;
  max_tokens: number;
  temperature?: number;
};

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type ModelResponse = {
  content: Array<ContentBlock>;
  stop_reason: StopReason;
  usage: UsageStats;
};

export type StreamEventMessageStart = {
  type: "message_start";
  message: {
    id: string;
    usage: UsageStats;
  };
};

export type StreamEventContentBlockStart = {
  type: "content_block_start";
  content_block: {
    type: string;
    index: number;
    id?: string;
    name?: string;
  };
};

export type StreamEventContentBlockDelta = {
  type: "content_block_delta";
  delta: {
    type: string;
    text?: string;
    input?: string;
    index: number;
  };
};

export type StreamEventMessageStop = {
  type: "message_stop";
  message: {
    stop_reason: StopReason;
  };
};

export type StreamEvent =
  | StreamEventMessageStart
  | StreamEventContentBlockStart
  | StreamEventContentBlockDelta
  | StreamEventMessageStop;

export type ModelErrorCode = "auth" | "rate_limit" | "timeout" | "api_error";

export class ModelError extends Error {
  constructor(
    public code: ModelErrorCode,
    public retryable: boolean = false,
    message: string = ""
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export interface ModelProvider {
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<StreamEvent>;
}
