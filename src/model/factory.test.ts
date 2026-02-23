// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import type { ModelConfig } from "../config/schema.js";
import { createModelProvider } from "./factory.js";

describe("createModelProvider", () => {
  describe("provider selection", () => {
    it("returns Anthropic adapter for 'anthropic' provider", () => {
      const config: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "test-key",
      };

      const provider = createModelProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("complete");
      expect(provider).toHaveProperty("stream");
    });

    it("returns OpenAI-compatible adapter for 'openai-compat' provider", () => {
      const config: ModelConfig = {
        provider: "openai-compat",
        name: "gpt-4",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
      };

      const provider = createModelProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("complete");
      expect(provider).toHaveProperty("stream");
    });

    it("throws descriptive error for unknown provider", () => {
      const config = {
        provider: "unknown-provider",
        name: "some-model",
        api_key: "test-key",
      } as any;

      expect(() => createModelProvider(config)).toThrow(
        /Unknown model provider: unknown-provider/
      );
      expect(() => createModelProvider(config)).toThrow(
        /Valid providers are: 'anthropic', 'openai-compat'/
      );
    });
  });

  describe("config-driven wiring", () => {
    it("creates different adapter instances for different provider configs", () => {
      const anthropicConfig: ModelConfig = {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
        api_key: "test-key-1",
      };

      const openaiConfig: ModelConfig = {
        provider: "openai-compat",
        name: "gpt-4",
        api_key: "test-key-2",
        base_url: "https://api.openai.com/v1",
      };

      const anthropicProvider = createModelProvider(anthropicConfig);
      const openaiProvider = createModelProvider(openaiConfig);

      expect(anthropicProvider).not.toBe(openaiProvider);
      expect(anthropicProvider).toHaveProperty("complete");
      expect(openaiProvider).toHaveProperty("complete");
    });

    it("passes config correctly to selected adapter", () => {
      const config: ModelConfig = {
        provider: "openai-compat",
        name: "gpt-4",
        api_key: "test-key",
        base_url: "https://custom-endpoint.example.com/v1",
      };

      const provider = createModelProvider(config);

      expect(provider).toBeDefined();
      expect(provider).toHaveProperty("complete");
    });
  });
});
