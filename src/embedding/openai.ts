// pattern: Imperative Shell

import OpenAI from "openai";
import type { EmbeddingConfig } from "../config/schema.js";
import type { EmbeddingProvider } from "./types.js";

export function createOpenAIEmbeddingAdapter(
  config: EmbeddingConfig
): EmbeddingProvider {
  const apiKey = config.api_key || process.env["OPENAI_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "OpenAI embedding adapter requires api_key in config or OPENAI_API_KEY environment variable"
    );
  }

  const client = new OpenAI({
    apiKey,
  });

  return {
    async embed(text: string): Promise<Array<number>> {
      try {
        const response = await client.embeddings.create({
          model: config.model,
          input: text,
        });

        if (!response.data[0] || !response.data[0].embedding) {
          throw new Error("No embedding returned from OpenAI");
        }

        return response.data[0].embedding;
      } catch (error) {
        if (error instanceof OpenAI.AuthenticationError) {
          throw new Error(`Authentication failed: ${error.message}`);
        }
        if (error instanceof OpenAI.APIError) {
          throw new Error(`OpenAI API error: ${error.message}`);
        }
        throw error;
      }
    },

    async embedBatch(
      texts: ReadonlyArray<string>
    ): Promise<Array<Array<number>>> {
      try {
        const response = await client.embeddings.create({
          model: config.model,
          input: Array.from(texts),
        });

        return response.data.map((item) => {
          if (!item.embedding) {
            throw new Error("No embedding returned from OpenAI");
          }
          return item.embedding;
        });
      } catch (error) {
        if (error instanceof OpenAI.AuthenticationError) {
          throw new Error(`Authentication failed: ${error.message}`);
        }
        if (error instanceof OpenAI.APIError) {
          throw new Error(`OpenAI API error: ${error.message}`);
        }
        throw error;
      }
    },

    dimensions: config.dimensions,
  };
}
