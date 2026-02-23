// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import type { EmbeddingConfig } from "../config/schema.js";
import { createEmbeddingProvider } from "./factory.js";

describe("createEmbeddingProvider", () => {
  describe("provider selection", () => {
    it("returns OpenAI adapter for 'openai' provider", () => {
      const config: EmbeddingConfig = {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        api_key: "test-key",
      };

      const provider = createEmbeddingProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("embed");
      expect(provider).toHaveProperty("embedBatch");
      expect(provider).toHaveProperty("dimensions");
      expect(provider.dimensions).toBe(1536);
    });

    it("returns Ollama adapter for 'ollama' provider", () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        endpoint: "http://localhost:11434",
        dimensions: 768,
      };

      const provider = createEmbeddingProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("embed");
      expect(provider).toHaveProperty("embedBatch");
      expect(provider).toHaveProperty("dimensions");
      expect(provider.dimensions).toBe(768);
    });

    it("throws descriptive error for unknown provider", () => {
      const config = {
        provider: "unknown-provider",
        model: "some-model",
        dimensions: 768,
      } as any;

      expect(() => createEmbeddingProvider(config)).toThrow(
        /Unknown embedding provider: unknown-provider/
      );
      expect(() => createEmbeddingProvider(config)).toThrow(
        /Valid providers are: 'openai', 'ollama'/
      );
    });
  });

  describe("config-driven wiring", () => {
    it("creates different adapter instances for different provider configs", () => {
      const openaiConfig: EmbeddingConfig = {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        api_key: "test-key-1",
      };

      const ollamaConfig: EmbeddingConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        endpoint: "http://localhost:11434",
        dimensions: 768,
      };

      const openaiProvider = createEmbeddingProvider(openaiConfig);
      const ollamaProvider = createEmbeddingProvider(ollamaConfig);

      expect(openaiProvider).not.toBe(ollamaProvider);
      expect(openaiProvider).toHaveProperty("embed");
      expect(ollamaProvider).toHaveProperty("embed");
    });

    it("passes config correctly to selected adapter (dimensions)", () => {
      const customDimensions = 512;
      const config: EmbeddingConfig = {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: customDimensions,
        api_key: "test-key",
      };

      const provider = createEmbeddingProvider(config);

      expect(provider.dimensions).toBe(customDimensions);
    });

    it("uses default endpoint for Ollama when not specified", () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
      };

      const provider = createEmbeddingProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("embed");
    });
  });
});
