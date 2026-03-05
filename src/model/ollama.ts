// pattern: Imperative Shell

import type { ModelConfig } from "../config/schema.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  return {
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      throw new Error(
        `Ollama adapter not yet implemented (model: ${config.name})`
      );
    },
    stream(_request: ModelRequest) {
      throw new Error(
        `Ollama adapter not yet implemented (model: ${config.name})`
      );
    },
  };
}
