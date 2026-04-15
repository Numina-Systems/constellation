# Config

Last verified: 2026-04-15

## Purpose
Loads and validates application configuration from TOML with environment variable overrides, providing a single typed `AppConfig` consumed by all other modules.

## Contracts
- **Exposes**: `loadConfig(path?) -> AppConfig`, Zod schemas (`AppConfigSchema`, `BlueskyConfigSchema`, `SummarizationConfigSchema`, `WebConfigSchema`, `SkillConfigSchema`, `EmailConfigSchema`, `ActivityConfigSchema`, `McpConfigSchema`, `SubconsciousConfigSchema`, etc.), config type aliases (`AppConfig`, `BlueskyConfig`, `SummarizationConfig`, `WebConfig`, `SkillConfig`, `EmailConfig`, `ActivityConfig`, `McpConfig`, `SubconsciousConfig`, etc.)
- **Guarantees**: Returned config is fully validated. Missing optional fields have defaults. Environment variables override TOML values for secrets — **provider-aware**: `ANTHROPIC_API_KEY` only applies when `provider = "anthropic"`, `OPENAI_COMPAT_API_KEY` only when `provider = "openai-compat"`. `model.provider` and `summarization.provider` accept `"anthropic" | "openai-compat" | "ollama"` (Ollama requires no API key). Bun auto-loads `.env` at startup; use `.env.example` as template. `BlueskyConfig` conditionally requires `handle`, `app_password`, `did` only when `enabled: true` (via Zod `superRefine`). `BlueskyConfig.schedule_dids` (default `[]`) lists DIDs that can request scheduling but not general interaction. `summarization` section is optional; when absent, compaction uses defaults. Importance scoring weights (`role_weight_*`, `recency_decay`, `*_bonus`, `important_keywords`, `content_length_weight`) are part of the summarization section with sensible defaults. `[web]` section is optional; when absent, web tools are not registered. `[skills]` section is optional; when absent, skill retrieval is not available. SkillConfig fields: `builtin_dir` (default `./skills`), `agent_dir` (default `./agent-skills`), `max_per_turn` (default `3`), `similarity_threshold` (default `0.3`). `[email]` section is optional; when absent, email tools are not registered. EmailConfig fields: `mailgun_api_key`, `mailgun_domain`, `from_address` (validated email), `allowed_recipients` (array of validated emails). `[activity]` section is optional; when absent, activity management is disabled. ActivityConfig conditionally requires `timezone`, `sleep_schedule`, `wake_schedule` only when `enabled: true` (via Zod `superRefine`). Cron expressions validated at load time. `[mcp]` section defaults to `{ enabled: false, servers: {} }` when absent. McpConfig fields: `enabled` (default `false`), `servers` (record of `McpServerConfig` with discriminated union on `transport`: `"stdio"` or `"http"`). McpConfigSchema is imported from `src/mcp/schema.ts`. `[subconscious]` section is optional; when absent, subconscious system is disabled. SubconsciousConfig conditionally requires `inner_conversation_id` when `enabled: true` (via Zod `superRefine`). SubconsciousConfig fields: `enabled` (default `false`), `inner_conversation_id`, `impulse_interval_minutes` (5-120, default `20`), `max_tool_rounds` (1-20, default `5`), `engagement_half_life_days` (1-90, default `7`), `max_active_interests` (1-50, default `10`).
- **Expects**: `config.toml` exists at project root (or path provided). TOML structure matches `AppConfigSchema`.

## Dependencies
- **Uses**: `@iarna/toml`, `zod`, `node:fs`, `croner` (for cron validation)
- **Used by**: `src/index.ts` (composition root), `src/persistence/migrate.ts`, `src/extensions/bluesky/` (BlueskyConfig), `src/web/` (WebConfig), `src/skill/` (SkillConfig), `src/email/` (EmailConfig), `src/scheduler/`, `src/activity/` (ActivityConfig via ScheduleConfig), `src/mcp/` (McpConfig via McpConfigSchema import), `src/subconscious/` (SubconsciousConfig)
- **Boundary**: Config is read-only after load. No module should mutate config at runtime.

## Key Decisions
- TOML over JSON/YAML: Human-readable, comment-friendly for local dev config
- Zod for validation: Runtime type safety at the system boundary
- Environment overrides for secrets: Config file stays in repo, secrets stay in env

## Invariants
- `AppConfig` always passes Zod validation
- Environment variables take precedence over TOML values for `api_key` (provider-matched), `database.url`, `brave_api_key`, `tavily_api_key`, `mailgun_api_key`, `mailgun_domain`

## Key Files
- `schema.ts` -- Zod schemas and inferred types (Functional Core)
- `config.ts` -- TOML loading, env merging, re-exports types (Imperative Shell)
