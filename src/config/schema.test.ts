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
