// pattern: Functional Core
import { z } from "zod";

const AgentConfigSchema = z.object({
  max_tool_rounds: z.number().int().positive().default(20),
  max_code_size: z.number().int().positive().default(51200),
  max_output_size: z.number().int().positive().default(1048576),
  code_timeout: z.number().int().positive().default(60000),
  max_tool_calls_per_exec: z.number().int().positive().default(25),
  context_budget: z.number().min(0).max(1).default(0.8),
});

const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const EmbeddingConfigSchema = z.object({
  provider: z.enum(["openai", "ollama"]),
  model: z.string(),
  endpoint: z.string().url().optional(),
  dimensions: z.number().int().positive().default(768),
  api_key: z.string().optional(),
});

const DatabaseConfigSchema = z.object({
  url: z.string().url(),
});

const RuntimeConfigSchema = z.object({
  working_dir: z.string().default("./workspace"),
  allowed_hosts: z.array(z.string()).default([]),
  allowed_read_paths: z.array(z.string()).default([]),
  allowed_run: z.array(z.string()).default([]),
});

const BlueskyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    handle: z.string().optional(),
    app_password: z.string().optional(),
    did: z.string().optional(),
    watched_dids: z.array(z.string()).default([]),
    jetstream_url: z.string().url().default("wss://jetstream2.us-east.bsky.network/subscribe"),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.handle) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "handle is required when bluesky is enabled", path: ["handle"] });
      }
      if (!data.app_password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "app_password is required when bluesky is enabled", path: ["app_password"] });
      }
      if (!data.did) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "did is required when bluesky is enabled", path: ["did"] });
      }
    }
  });

const WebConfigSchema = z.object({
  brave_api_key: z.string().optional(),
  tavily_api_key: z.string().optional(),
  searxng_endpoint: z.string().url().optional(),
  max_results: z.number().int().positive().default(10),
  fetch_timeout: z.number().int().positive().default(30000),
  max_fetch_size: z.number().int().positive().default(1048576),
  cache_ttl: z.number().int().positive().default(300000),
});

const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
  bluesky: BlueskyConfigSchema.default({}),
  web: WebConfigSchema.optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type BlueskyConfig = z.infer<typeof BlueskyConfigSchema>;
export type WebConfig = z.infer<typeof WebConfigSchema>;

export { AppConfigSchema, AgentConfigSchema, ModelConfigSchema, EmbeddingConfigSchema, DatabaseConfigSchema, RuntimeConfigSchema, BlueskyConfigSchema, WebConfigSchema };
