// pattern: Functional Core

export type {
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  ToolDefinition,
  Message,
  ModelRequest,
  StopReason,
  UsageStats,
  ModelResponse,
  StreamEventMessageStart,
  StreamEventContentBlockStart,
  StreamEventContentBlockDelta,
  StreamEventMessageStop,
  StreamEvent,
  ModelErrorCode,
} from "./types.js";

export { ModelError, type ModelProvider } from "./types.js";
export { createAnthropicAdapter } from "./anthropic.js";
export { createOpenAICompatAdapter } from "./openai-compat.js";
export { createOllamaAdapter } from "./ollama.js";
export { createOpenRouterAdapter } from "./openrouter.js";
export { createModelProvider } from "./factory.js";
export * from "./exchange.js";
export * from "./budget.js";
export * from "./usage.js";
export * from "./cancellation.js";
