// pattern: Imperative Shell

import type { ModelConfig } from "../config/schema.js";
import type { ModelProvider } from "./types.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createOpenAICompatAdapter } from "./openai-compat.js";
import { createOllamaAdapter } from "./ollama.js";
import { createOpenRouterAdapter } from "./openrouter.js";

export function createModelProvider(config: ModelConfig): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAdapter(config);
    case "openai-compat":
      return createOpenAICompatAdapter(config);
    case "ollama":
      return createOllamaAdapter(config);
    case "openrouter":
      return createOpenRouterAdapter(config);
    default:
      throw new Error(
        `Unknown model provider: ${config.provider}. Valid providers are: 'anthropic', 'openai-compat', 'ollama', 'openrouter'`
      );
  }
}
