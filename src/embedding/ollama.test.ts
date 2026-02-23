// pattern: Imperative Shell

import { describe, it, expect, beforeEach } from "bun:test";
import { createOllamaEmbeddingAdapter } from "./ollama.js";
import type { EmbeddingConfig } from "../config/schema.js";

describe("Ollama Embeddings Adapter", () => {
  let config: EmbeddingConfig;

  beforeEach(() => {
    config = {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      endpoint: process.env["OLLAMA_ENDPOINT"] || "http://localhost:11434",
    };
  });

  it("should use default endpoint if not configured", () => {
    const adapterConfig: EmbeddingConfig = {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
    };

    const adapter = createOllamaEmbeddingAdapter(adapterConfig);
    expect(adapter.dimensions).toBe(768);
  });

  it("should embed a single text and return correct dimensions", async () => {
    const adapter = createOllamaEmbeddingAdapter(config);

    try {
      const text = "Hello, world!";
      const embedding = await adapter.embed(text);

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(config.dimensions);
      expect(embedding.every((x) => typeof x === "number")).toBe(true);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Failed to connect to Ollama")
      ) {
        console.log(
          "Skipping integration test: Ollama server not available"
        );
        return;
      }
      throw error;
    }
  });

  it("should batch embed multiple texts and return correct dimensions", async () => {
    const adapter = createOllamaEmbeddingAdapter(config);

    try {
      const texts = ["Hello, world!", "Testing embeddings", "Another text"];
      const embeddings = await adapter.embedBatch(texts);

      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings.length).toBe(texts.length);
      embeddings.forEach((embedding) => {
        expect(embedding.length).toBe(config.dimensions);
        expect(embedding.every((x) => typeof x === "number")).toBe(true);
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Failed to connect to Ollama")
      ) {
        console.log(
          "Skipping integration test: Ollama server not available"
        );
        return;
      }
      throw error;
    }
  });

  it("should have correct dimensions property", () => {
    const adapter = createOllamaEmbeddingAdapter(config);
    expect(adapter.dimensions).toBe(config.dimensions);
  });

  it("should report connection error when Ollama is unavailable", async () => {
    const offlineConfig: EmbeddingConfig = {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      endpoint: "http://localhost:59999",
    };

    const adapter = createOllamaEmbeddingAdapter(offlineConfig);

    try {
      await adapter.embed("test");
      expect.unreachable("Should have thrown connection error");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      // Check that we get a connection-related error
      const message = (error as Error).message;
      expect(
        message.includes("Failed to connect") ||
          message.includes("Unable to connect") ||
          message.includes("ConnectionRefused")
      ).toBe(true);
    }
  });
});
