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

const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export { AppConfigSchema, AgentConfigSchema, ModelConfigSchema, EmbeddingConfigSchema, DatabaseConfigSchema, RuntimeConfigSchema };
