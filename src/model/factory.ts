// pattern: Imperative Shell

import type { ModelConfig } from "../config/schema.js";
import type { ModelProvider } from "./types.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createOpenAICompatAdapter } from "./openai-compat.js";

export function createModelProvider(config: ModelConfig): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAdapter(config);
    case "openai-compat":
      return createOpenAICompatAdapter(config);
    default:
      throw new Error(
        `Unknown model provider: ${config.provider}. Valid providers are: 'anthropic', 'openai-compat'`
      );
  }
}
