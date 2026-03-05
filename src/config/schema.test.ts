// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import { AppConfigSchema } from "./schema.js";

describe("BlueskyConfigSchema", () => {
  describe("bsky-datasource.AC4.1: Parse full [bluesky] config with all fields", () => {
    it("should parse a complete bluesky config and verify typed result contains correct values", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          handle: "spirit.bsky.social",
          app_password: "xxxx-xxxx-xxxx-xxxx",
          did: "did:plc:example",
          watched_dids: ["did:plc:friend1", "did:plc:friend2"],
          jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.bluesky.enabled).toBe(true);
      expect(result.bluesky.handle).toBe("spirit.bsky.social");
      expect(result.bluesky.app_password).toBe("xxxx-xxxx-xxxx-xxxx");
      expect(result.bluesky.did).toBe("did:plc:example");
      expect(result.bluesky.watched_dids).toEqual(["did:plc:friend1", "did:plc:friend2"]);
      expect(result.bluesky.jetstream_url).toBe("wss://jetstream2.us-east.bsky.network/subscribe");
    });
  });

  describe("bsky-datasource.AC4.2: Validation fails when enabled:true but required fields missing", () => {
    it("should fail validation when enabled:true but handle is missing", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          app_password: "xxxx-xxxx-xxxx-xxxx",
          did: "did:plc:example",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should fail validation when enabled:true but app_password is missing", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          handle: "spirit.bsky.social",
          did: "did:plc:example",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should fail validation when enabled:true but did is missing", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          handle: "spirit.bsky.social",
          app_password: "xxxx-xxxx-xxxx-xxxx",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });
  });

  describe("bsky-datasource.AC4.5: watched_dids can be empty (defaults to [])", () => {
    it("should parse config with enabled:true, required fields present, watched_dids omitted", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          handle: "spirit.bsky.social",
          app_password: "xxxx-xxxx-xxxx-xxxx",
          did: "did:plc:example",
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.bluesky.watched_dids).toEqual([]);
    });

    it("should allow watched_dids to be an empty array", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: true,
          handle: "spirit.bsky.social",
          app_password: "xxxx-xxxx-xxxx-xxxx",
          did: "did:plc:example",
          watched_dids: [],
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.bluesky.watched_dids).toEqual([]);
    });
  });

  describe("bsky-datasource.AC4.6: Feature disabled when enabled:false or [bluesky] section absent", () => {
    it("should parse config with no [bluesky] section and default enabled to false", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.bluesky.enabled).toBe(false);
    });

    it("should parse config with enabled:false and allow optional fields to be absent", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {
          enabled: false,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.bluesky.enabled).toBe(false);
    });
  });
});

describe("SummarizationConfigSchema", () => {
  describe("compaction-v2.AC3.5: Scoring config fields with defaults", () => {
    it("should parse minimal summarization config and apply scoring defaults", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "openai-compat",
          name: "test-model",
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.summarization).toBeDefined();
      expect(result.summarization!.provider).toBe("openai-compat");
      expect(result.summarization!.name).toBe("test-model");

      // Verify scoring defaults are applied
      expect(result.summarization!.role_weight_system).toBe(10.0);
      expect(result.summarization!.role_weight_user).toBe(5.0);
      expect(result.summarization!.role_weight_assistant).toBe(3.0);
      expect(result.summarization!.recency_decay).toBe(0.95);
      expect(result.summarization!.question_bonus).toBe(2.0);
      expect(result.summarization!.tool_call_bonus).toBe(4.0);
      expect(result.summarization!.keyword_bonus).toBe(1.5);
      expect(result.summarization!.important_keywords).toEqual([
        "error",
        "fail",
        "bug",
        "fix",
        "decision",
        "agreed",
        "constraint",
        "requirement",
      ]);
      expect(result.summarization!.content_length_weight).toBe(1.0);
    });

    it("should accept custom scoring values", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "anthropic",
          name: "claude-3-sonnet",
          role_weight_system: 15.0,
          role_weight_user: 8.0,
          role_weight_assistant: 5.0,
          recency_decay: 0.9,
          question_bonus: 3.0,
          tool_call_bonus: 5.0,
          keyword_bonus: 2.0,
          important_keywords: ["critical", "urgent"],
          content_length_weight: 1.5,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.summarization!.role_weight_system).toBe(15.0);
      expect(result.summarization!.role_weight_user).toBe(8.0);
      expect(result.summarization!.role_weight_assistant).toBe(5.0);
      expect(result.summarization!.recency_decay).toBe(0.9);
      expect(result.summarization!.question_bonus).toBe(3.0);
      expect(result.summarization!.tool_call_bonus).toBe(5.0);
      expect(result.summarization!.keyword_bonus).toBe(2.0);
      expect(result.summarization!.important_keywords).toEqual(["critical", "urgent"]);
      expect(result.summarization!.content_length_weight).toBe(1.5);
    });

    it("should reject recency_decay > 1", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "openai-compat",
          name: "test-model",
          recency_decay: 1.5,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject negative weights", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "openai-compat",
          name: "test-model",
          role_weight_system: -5.0,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });
  });
});

describe("ModelConfigSchema and SummarizationConfigSchema rate limits", () => {
  describe("rate-limiter.AC2.2: Rate limit fields are optional; when absent, no defaults applied at schema level", () => {
    it("should parse full AppConfig with no rate limit fields on [model]", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.model.requests_per_minute).toBeUndefined();
      expect(result.model.input_tokens_per_minute).toBeUndefined();
      expect(result.model.output_tokens_per_minute).toBeUndefined();
      expect(result.model.min_output_reserve).toBeUndefined();
    });

    it("should parse config with all four rate limit fields on [model]", () => {
      const config = {
        agent: {},
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022",
          requests_per_minute: 50,
          input_tokens_per_minute: 40000,
          output_tokens_per_minute: 8000,
          min_output_reserve: 1024,
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.model.requests_per_minute).toBe(50);
      expect(result.model.input_tokens_per_minute).toBe(40000);
      expect(result.model.output_tokens_per_minute).toBe(8000);
      expect(result.model.min_output_reserve).toBe(1024);
    });
  });

  describe("rate-limiter.AC2.3: Summarization model can have different rate limits than the main model", () => {
    it("should parse config with different rate limit fields on [model] and [summarization]", () => {
      const config = {
        agent: {},
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022",
          requests_per_minute: 50,
          input_tokens_per_minute: 40000,
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "openai-compat",
          name: "olmo-3:7b-think",
          requests_per_minute: 30,
          input_tokens_per_minute: 20000,
          output_tokens_per_minute: 4000,
          min_output_reserve: 512,
        },
      };

      const result = AppConfigSchema.parse(config);

      // Verify model rate limits
      expect(result.model.requests_per_minute).toBe(50);
      expect(result.model.input_tokens_per_minute).toBe(40000);
      expect(result.model.output_tokens_per_minute).toBeUndefined();

      // Verify summarization has different rate limits
      expect(result.summarization!.requests_per_minute).toBe(30);
      expect(result.summarization!.input_tokens_per_minute).toBe(20000);
      expect(result.summarization!.output_tokens_per_minute).toBe(4000);
      expect(result.summarization!.min_output_reserve).toBe(512);
    });
  });

  describe("rate-limiter.AC2.4: Invalid rate limit config values (zero, negative, non-integer) are rejected", () => {
    it("should reject requests_per_minute: 0 (zero) on [model]", () => {
      const config = {
        agent: {},
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022",
          requests_per_minute: 0,
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject input_tokens_per_minute: -100 (negative) on [model]", () => {
      const config = {
        agent: {},
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022",
          input_tokens_per_minute: -100,
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject output_tokens_per_minute: 1.5 (non-integer) on [model]", () => {
      const config = {
        agent: {},
        model: {
          provider: "anthropic",
          name: "claude-3-5-sonnet-20241022",
          output_tokens_per_minute: 1.5,
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });
  });

  describe("ollama-adapter.AC1: Ollama model provider config validation", () => {
    it("ollama-adapter.AC1.1: Config with provider='ollama' in [model] section parses without error", () => {
      const config = {
        agent: {},
        model: {
          provider: "ollama",
          name: "llama3.1:8b",
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.model.provider).toBe("ollama");
      expect(result.model.name).toBe("llama3.1:8b");
    });

    it("ollama-adapter.AC1.2: Config with provider='ollama' in [summarization] section parses without error", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "ollama",
          name: "llama3.1:8b",
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.summarization).toBeDefined();
      expect(result.summarization!.provider).toBe("ollama");
      expect(result.summarization!.name).toBe("llama3.1:8b");
    });

    it("ollama-adapter.AC1.3: Config with provider='ollama' and no base_url parses (base_url is optional at schema level)", () => {
      const config = {
        agent: {},
        model: {
          provider: "ollama",
          name: "llama3.1:8b",
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.model.provider).toBe("ollama");
      expect(result.model.base_url).toBeUndefined();
    });

    it("ollama-adapter.AC1.4: Config with provider='ollama' and no api_key parses without error", () => {
      const config = {
        agent: {},
        model: {
          provider: "ollama",
          name: "llama3.1:8b",
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.model.provider).toBe("ollama");
      expect(result.model.api_key).toBeUndefined();
    });
  });
});
