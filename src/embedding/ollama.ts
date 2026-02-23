// pattern: Imperative Shell

import type { EmbeddingConfig } from "../config/schema.js";
import type { EmbeddingProvider } from "./types.js";

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

interface OllamaEmbedResponse {
  embeddings: Array<Array<number>>;
}

export function createOllamaEmbeddingAdapter(
  config: EmbeddingConfig
): EmbeddingProvider {
  const endpoint = config.endpoint || DEFAULT_OLLAMA_ENDPOINT;

  return {
    async embed(text: string): Promise<Array<number>> {
      try {
        const response = await fetch(`${endpoint}/api/embed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            input: text,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as OllamaEmbedResponse;

        if (!data.embeddings || !data.embeddings[0]) {
          throw new Error("No embedding returned from Ollama");
        }

        return data.embeddings[0];
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith("Ollama")) {
          throw new Error(
            `Failed to connect to Ollama at ${endpoint}: ${error.message}`
          );
        }
        throw error;
      }
    },

    async embedBatch(
      texts: ReadonlyArray<string>
    ): Promise<Array<Array<number>>> {
      try {
        const response = await fetch(`${endpoint}/api/embed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            input: Array.from(texts),
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as OllamaEmbedResponse;

        if (!data.embeddings) {
          throw new Error("No embeddings returned from Ollama");
        }

        return data.embeddings;
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith("Ollama")) {
          throw new Error(
            `Failed to connect to Ollama at ${endpoint}: ${error.message}`
          );
        }
        throw error;
      }
    },

    dimensions: config.dimensions,
  };
}
