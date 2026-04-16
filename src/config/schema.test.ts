// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import { ZodError } from "zod";
import { AppConfigSchema, ModelConfigSchema, OpenRouterConfigSchema } from "./schema.js";

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

describe("ActivityConfigSchema", () => {
  describe("sleep-cycle.AC8.1: Absent [activity] config results in no activity manager, no context injection", () => {
    it("should parse config with no [activity] section and activity is undefined", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.activity).toBeUndefined();
    });
  });

  describe("sleep-cycle.AC8.2: enabled:false has same effect as absent config", () => {
    it("should parse config with activity enabled:false", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: { enabled: false },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.activity).toBeDefined();
      expect(result.activity!.enabled).toBe(false);
    });
  });

  describe("sleep-cycle.AC1.5: Invalid cron expression in config rejected at startup with clear error", () => {
    it("should reject config with enabled:true but no timezone", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          sleep_schedule: "0 22 * * *",
          wake_schedule: "0 6 * * *",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject config with enabled:true but no sleep_schedule", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          timezone: "America/Toronto",
          wake_schedule: "0 6 * * *",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject config with enabled:true but no wake_schedule", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          timezone: "America/Toronto",
          sleep_schedule: "0 22 * * *",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should successfully parse config with all required fields when enabled:true", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          timezone: "America/Toronto",
          sleep_schedule: "0 22 * * *",
          wake_schedule: "0 6 * * *",
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.activity).toBeDefined();
      expect(result.activity!.enabled).toBe(true);
      expect(result.activity!.timezone).toBe("America/Toronto");
      expect(result.activity!.sleep_schedule).toBe("0 22 * * *");
      expect(result.activity!.wake_schedule).toBe("0 6 * * *");
    });

    it("should reject config with invalid cron expression for sleep_schedule", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          timezone: "America/Toronto",
          sleep_schedule: "not a cron",
          wake_schedule: "0 6 * * *",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow(/invalid cron expression for sleep_schedule/);
    });

    it("should reject config with invalid cron expression for wake_schedule", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        activity: {
          enabled: true,
          timezone: "America/Toronto",
          sleep_schedule: "0 22 * * *",
          wake_schedule: "garbage",
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow(/invalid cron expression for wake_schedule/);
    });
  });
});

describe("SubconsciousConfigSchema continuation fields", () => {
  describe("impulse-continuation.AC3.6: Continuation budget config validation", () => {
    it("should apply defaults when continuation fields omitted", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: { enabled: false },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious).toBeDefined();
      expect(result.subconscious!.max_continuations_per_event).toBe(2);
      expect(result.subconscious!.max_continuations_per_cycle).toBe(10);
    });

    it("should accept explicit continuation values", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_event: 5,
          max_continuations_per_cycle: 20,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious!.max_continuations_per_event).toBe(5);
      expect(result.subconscious!.max_continuations_per_cycle).toBe(20);
    });

    it("should accept zero values (disables continuation)", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_event: 0,
          max_continuations_per_cycle: 0,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious!.max_continuations_per_event).toBe(0);
      expect(result.subconscious!.max_continuations_per_cycle).toBe(0);
    });

    it("should reject max_continuations_per_event > 10", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_event: 11,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject max_continuations_per_event < 0", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_event: -1,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject max_continuations_per_cycle > 50", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_cycle: 51,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject max_continuations_per_cycle < 0", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          max_continuations_per_cycle: -1,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });
  });
});

describe("OpenRouterConfigSchema and ModelConfigSchema with openrouter provider", () => {
  describe("openrouter-provider.AC1.1: Basic openrouter provider config", () => {
    it("should parse openrouter provider with name", () => {
      const config = {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4",
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.provider).toBe("openrouter");
      expect(result.name).toBe("anthropic/claude-sonnet-4");
    });
  });

  describe("openrouter-provider.AC1.2: Nested openrouter config", () => {
    it("should parse all openrouter nested fields", () => {
      const config = {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4",
        api_key: "test-key",
        openrouter: {
          sort: "price",
          allow_fallbacks: false,
          referer: "https://myapp.com",
          title: "My App",
        },
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.openrouter).toBeDefined();
      expect(result.openrouter?.sort).toBe("price");
      expect(result.openrouter?.allow_fallbacks).toBe(false);
      expect(result.openrouter?.referer).toBe("https://myapp.com");
      expect(result.openrouter?.title).toBe("My App");
    });

    it("should accept partial openrouter config", () => {
      const config = {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4",
        openrouter: {
          sort: "throughput",
        },
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.openrouter?.sort).toBe("throughput");
      expect(result.openrouter?.allow_fallbacks).toBeUndefined();
    });

    it("should accept config without openrouter nested object", () => {
      const config = {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4",
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.openrouter).toBeUndefined();
    });

    it("should parse full AppConfig with openrouter in [model] section", () => {
      const config = {
        agent: {},
        model: {
          provider: "openrouter",
          name: "anthropic/claude-sonnet-4",
          api_key: "sk-or-test-key",
          openrouter: {
            sort: "latency",
            allow_fallbacks: true,
            referer: "https://myapp.com",
            title: "My App",
          },
        },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
      };
      const result = AppConfigSchema.parse(config);
      expect(result.model.provider).toBe("openrouter");
      expect(result.model.openrouter).toBeDefined();
      expect(result.model.openrouter?.sort).toBe("latency");
    });
  });

  describe("openrouter-provider.AC1.4: Invalid enum values", () => {
    it("should reject invalid sort value", () => {
      const config = {
        provider: "openrouter",
        name: "test",
        openrouter: {
          sort: "invalid",
        },
      };
      expect(() => ModelConfigSchema.parse(config)).toThrow(ZodError);
    });

    it("should reject invalid provider value", () => {
      const config = {
        provider: "invalid-provider",
        name: "test",
      };
      expect(() => ModelConfigSchema.parse(config)).toThrow(ZodError);
    });
  });

  describe("openrouter-provider: Other providers still work", () => {
    it("should parse anthropic provider", () => {
      const config = {
        provider: "anthropic",
        name: "claude-3-sonnet-20240229",
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.provider).toBe("anthropic");
    });

    it("should parse openai-compat provider", () => {
      const config = {
        provider: "openai-compat",
        name: "gpt-4",
        base_url: "https://api.openai.com/v1",
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.provider).toBe("openai-compat");
    });

    it("should parse ollama provider", () => {
      const config = {
        provider: "ollama",
        name: "llama2",
        base_url: "http://localhost:11434",
      };
      const result = ModelConfigSchema.parse(config);
      expect(result.provider).toBe("ollama");
    });
  });

  describe("OpenRouterConfigSchema", () => {
    it("should parse all fields", () => {
      const config = {
        sort: "latency",
        allow_fallbacks: true,
        referer: "https://example.com",
        title: "Test App",
      };
      const result = OpenRouterConfigSchema.parse(config);
      expect(result.sort).toBe("latency");
      expect(result.allow_fallbacks).toBe(true);
      expect(result.referer).toBe("https://example.com");
      expect(result.title).toBe("Test App");
    });

    it("should accept empty object", () => {
      const result = OpenRouterConfigSchema.parse({});
      expect(result).toEqual({});
    });

    it("should reject invalid sort enum", () => {
      expect(() =>
        OpenRouterConfigSchema.parse({
          sort: "invalid",
        })
      ).toThrow(ZodError);
    });

    it("should accept all valid sort options", () => {
      const sorts: Array<"price" | "throughput" | "latency"> = ["price", "throughput", "latency"];
      for (const sort of sorts) {
        const result = OpenRouterConfigSchema.parse({ sort });
        expect(result.sort).toBe(sort);
      }
    });
  });

  describe("SummarizationConfigSchema with openrouter provider", () => {
    it("should parse summarization config with openrouter provider", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        summarization: {
          provider: "openrouter",
          name: "anthropic/claude-3-5-sonnet",
        },
      };
      const result = AppConfigSchema.parse(config);
      expect(result.summarization).toBeDefined();
      expect(result.summarization!.provider).toBe("openrouter");
      expect(result.summarization!.name).toBe("anthropic/claude-3-5-sonnet");
    });
  });
});

describe("SubconsciousConfigSchema", () => {
  describe("introspection-loop.AC4.2: Introspection config defaults and bounds", () => {
    it("should apply defaults when parsing minimal subconscious config", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious).toBeDefined();
      expect(result.subconscious!.introspection_offset_minutes).toBe(3);
      expect(result.subconscious!.introspection_lookback_hours).toBe(24);
    });

    it("should reject introspection_offset_minutes: 0 (below min)", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_offset_minutes: 0,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject introspection_lookback_hours: 0 (below min)", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_lookback_hours: 0,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject introspection_offset_minutes: 31 (above max)", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_offset_minutes: 31,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should reject introspection_lookback_hours: 73 (above max)", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_lookback_hours: 73,
        },
      };

      expect(() => AppConfigSchema.parse(config)).toThrow();
    });

    it("should parse valid custom values for introspection_offset_minutes: 5", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_offset_minutes: 5,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious!.introspection_offset_minutes).toBe(5);
    });

    it("should parse valid custom values for introspection_lookback_hours: 48", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_lookback_hours: 48,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious!.introspection_lookback_hours).toBe(48);
    });

    it("should parse both custom values together", () => {
      const config = {
        agent: {},
        model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
        database: { url: "postgresql://localhost/test" },
        runtime: {},
        bluesky: {},
        subconscious: {
          enabled: false,
          introspection_offset_minutes: 5,
          introspection_lookback_hours: 48,
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.subconscious!.introspection_offset_minutes).toBe(5);
      expect(result.subconscious!.introspection_lookback_hours).toBe(48);
    });
  });
});
