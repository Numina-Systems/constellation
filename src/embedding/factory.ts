// pattern: Imperative Shell

import type { EmbeddingConfig } from "../config/schema.js";
import type { EmbeddingProvider } from "./types.js";
import { createOpenAIEmbeddingAdapter } from "./openai.js";
import { createOllamaEmbeddingAdapter } from "./ollama.js";

export function createEmbeddingProvider(
  config: EmbeddingConfig
): EmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIEmbeddingAdapter(config);
    case "ollama":
      return createOllamaEmbeddingAdapter(config);
    default:
      throw new Error(
        `Unknown embedding provider: ${config.provider}. Valid providers are: 'openai', 'ollama'`
      );
  }
}
