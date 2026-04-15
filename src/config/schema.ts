// pattern: Functional Core
import { z } from "zod";
import { Cron } from "croner";

const AgentConfigSchema = z.object({
  max_tool_rounds: z.number().int().positive().default(20),
  max_code_size: z.number().int().positive().default(51200),
  max_output_size: z.number().int().positive().default(1048576),
  code_timeout: z.number().int().positive().default(60000),
  max_tool_calls_per_exec: z.number().int().positive().default(25),
  context_budget: z.number().min(0).max(1).default(0.8),
  max_context_tokens: z.number().int().positive().default(200000),
});

const OpenRouterConfigSchema = z.object({
  sort: z.enum(["price", "throughput", "latency"]).optional(),
  allow_fallbacks: z.boolean().optional(),
  referer: z.string().optional(),
  title: z.string().optional(),
});

const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat", "ollama", "openrouter"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  requests_per_minute: z.number().int().positive().optional(),
  input_tokens_per_minute: z.number().int().positive().optional(),
  output_tokens_per_minute: z.number().int().positive().optional(),
  min_output_reserve: z.number().int().positive().optional(),
  openrouter: OpenRouterConfigSchema.optional(),
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
  unrestricted: z.boolean().default(false),
  allowed_hosts: z.array(z.string()).default([]),
  allowed_read_paths: z.array(z.string()).default([]),
  allowed_write_paths: z.array(z.string()).default([]),
  allowed_run: z.array(z.string()).default([]),
});

const BlueskyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    handle: z.string().optional(),
    app_password: z.string().optional(),
    did: z.string().optional(),
    watched_dids: z.array(z.string()).default([]),
    schedule_dids: z.array(z.string()).default([]),
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

const SummarizationConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat", "ollama", "openrouter"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  requests_per_minute: z.number().int().positive().optional(),
  input_tokens_per_minute: z.number().int().positive().optional(),
  output_tokens_per_minute: z.number().int().positive().optional(),
  min_output_reserve: z.number().int().positive().optional(),
  chunk_size: z.number().int().positive().default(20),
  keep_recent: z.number().int().nonnegative().default(5),
  max_summary_tokens: z.number().int().positive().default(1024),
  clip_first: z.number().int().nonnegative().default(2),
  clip_last: z.number().int().nonnegative().default(2),
  prompt: z.string().optional(),

  // Importance scoring weights
  role_weight_system: z.number().nonnegative().default(10.0),
  role_weight_user: z.number().nonnegative().default(5.0),
  role_weight_assistant: z.number().nonnegative().default(3.0),
  recency_decay: z.number().min(0).max(1).default(0.95),
  question_bonus: z.number().nonnegative().default(2.0),
  tool_call_bonus: z.number().nonnegative().default(4.0),
  keyword_bonus: z.number().nonnegative().default(1.5),
  important_keywords: z.array(z.string()).default([
    "error",
    "fail",
    "bug",
    "fix",
    "decision",
    "agreed",
    "constraint",
    "requirement",
  ]),
  content_length_weight: z.number().nonnegative().default(1.0),
  compaction_timeout: z.number().int().positive().default(120000),
  compaction_max_retries: z.number().int().nonnegative().default(2),
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

const SkillConfigSchema = z.object({
  builtin_dir: z.string().default('./skills'),
  agent_dir: z.string().default('./agent-skills'),
  max_per_turn: z.number().int().positive().default(3),
  similarity_threshold: z.number().min(0).max(1).default(0.3),
});

const EmailConfigSchema = z.object({
  mailgun_api_key: z.string(),
  mailgun_domain: z.string(),
  from_address: z.string().email(),
  allowed_recipients: z.array(z.string().email()),
});

const ActivityConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    timezone: z.string().optional(),
    sleep_schedule: z.string().optional(),
    wake_schedule: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.timezone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "timezone is required when activity is enabled",
          path: ["timezone"],
        });
      }
      if (!data.sleep_schedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sleep_schedule is required when activity is enabled",
          path: ["sleep_schedule"],
        });
      } else {
        try {
          new Cron(data.sleep_schedule);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `invalid cron expression for sleep_schedule: ${data.sleep_schedule}`,
            path: ["sleep_schedule"],
          });
        }
      }
      if (!data.wake_schedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "wake_schedule is required when activity is enabled",
          path: ["wake_schedule"],
        });
      } else {
        try {
          new Cron(data.wake_schedule);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `invalid cron expression for wake_schedule: ${data.wake_schedule}`,
            path: ["wake_schedule"],
          });
        }
      }
    }
  });

const SubconsciousConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    inner_conversation_id: z.string().optional(),
    impulse_interval_minutes: z.number().min(5).max(120).default(20),
    max_tool_rounds: z.number().min(1).max(20).default(5),
    engagement_half_life_days: z.number().min(1).max(90).default(7),
    max_active_interests: z.number().min(1).max(50).default(10),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && !data.inner_conversation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inner_conversation_id is required when subconscious is enabled",
        path: ["inner_conversation_id"],
      });
    }
  });

const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
  bluesky: BlueskyConfigSchema.default({}),
  summarization: SummarizationConfigSchema.optional(),
  web: WebConfigSchema.optional(),
  skills: SkillConfigSchema.optional(),
  email: EmailConfigSchema.optional(),
  activity: ActivityConfigSchema.optional(),
  subconscious: SubconsciousConfigSchema.optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type BlueskyConfig = z.infer<typeof BlueskyConfigSchema>;
export type SummarizationConfig = z.infer<typeof SummarizationConfigSchema>;
export type WebConfig = z.infer<typeof WebConfigSchema>;
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type ActivityConfig = z.infer<typeof ActivityConfigSchema>;
export type SubconsciousConfig = z.infer<typeof SubconsciousConfigSchema>;

export { AppConfigSchema, AgentConfigSchema, ModelConfigSchema, OpenRouterConfigSchema, EmbeddingConfigSchema, DatabaseConfigSchema, RuntimeConfigSchema, BlueskyConfigSchema, SummarizationConfigSchema, WebConfigSchema, SkillConfigSchema, EmailConfigSchema, ActivityConfigSchema, SubconsciousConfigSchema };
