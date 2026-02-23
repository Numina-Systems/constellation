// pattern: Imperative Shell

import { describe, it, expect, beforeEach } from "bun:test";
import { createOpenAIEmbeddingAdapter } from "./openai.js";
import type { EmbeddingConfig } from "../config/schema.js";

describe("OpenAI Embeddings Adapter", () => {
  let config: EmbeddingConfig;

  beforeEach(() => {
    config = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      api_key: process.env["OPENAI_API_KEY"],
    };
  });

  it("should throw error if no API key provided", () => {
    const noKeyConfig: EmbeddingConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      api_key: undefined,
    };

    // Clear the environment variable temporarily
    const originalKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];

    try {
      expect(() => createOpenAIEmbeddingAdapter(noKeyConfig)).toThrow(
        /api_key in config or OPENAI_API_KEY/
      );
    } finally {
      if (originalKey) {
        process.env["OPENAI_API_KEY"] = originalKey;
      }
    }
  });

  it("should embed a single text and return correct dimensions", async () => {
    if (!config.api_key) {
      console.log("Skipping integration test: OPENAI_API_KEY not set");
      return;
    }

    const adapter = createOpenAIEmbeddingAdapter(config);
    const text = "Hello, world!";

    const embedding = await adapter.embed(text);

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(config.dimensions);
    expect(embedding.every((x) => typeof x === "number")).toBe(true);
  });

  it("should batch embed multiple texts and return correct dimensions", async () => {
    if (!config.api_key) {
      console.log(
        "Skipping integration test: OPENAI_API_KEY not set"
      );
      return;
    }

    const adapter = createOpenAIEmbeddingAdapter(config);
    const texts = ["Hello, world!", "Testing embeddings", "Another text"];

    const embeddings = await adapter.embedBatch(texts);

    expect(Array.isArray(embeddings)).toBe(true);
    expect(embeddings.length).toBe(texts.length);
    embeddings.forEach((embedding) => {
      expect(embedding.length).toBe(config.dimensions);
      expect(embedding.every((x) => typeof x === "number")).toBe(true);
    });
  });

  it("should have correct dimensions property", () => {
    if (!config.api_key) {
      console.log("Skipping integration test: OPENAI_API_KEY not set");
      return;
    }

    const adapter = createOpenAIEmbeddingAdapter(config);
    expect(adapter.dimensions).toBe(config.dimensions);
  });
});
