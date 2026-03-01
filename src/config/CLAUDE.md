# Config

Last verified: 2026-03-01

## Purpose
Loads and validates application configuration from TOML with environment variable overrides, providing a single typed `AppConfig` consumed by all other modules.

## Contracts
- **Exposes**: `loadConfig(path?) -> AppConfig`, Zod schemas (`AppConfigSchema`, `BlueskyConfigSchema`, `SummarizationConfigSchema`, etc.), config type aliases (`AppConfig`, `BlueskyConfig`, `SummarizationConfig`, etc.)
- **Guarantees**: Returned config is fully validated. Missing optional fields have defaults. Environment variables override TOML values for secrets. `BlueskyConfig` conditionally requires `handle`, `app_password`, `did` only when `enabled: true` (via Zod `superRefine`). `summarization` section is optional; when absent, compaction uses defaults. Importance scoring weights (`role_weight_*`, `recency_decay`, `*_bonus`, `important_keywords`, `content_length_weight`) are part of the summarization section with sensible defaults.
- **Expects**: `config.toml` exists at project root (or path provided). TOML structure matches `AppConfigSchema`.

## Dependencies
- **Uses**: `@iarna/toml`, `zod`, `node:fs`
- **Used by**: `src/index.ts` (composition root), `src/persistence/migrate.ts`, `src/extensions/bluesky/` (BlueskyConfig)
- **Boundary**: Config is read-only after load. No module should mutate config at runtime.

## Key Decisions
- TOML over JSON/YAML: Human-readable, comment-friendly for local dev config
- Zod for validation: Runtime type safety at the system boundary
- Environment overrides for secrets: Config file stays in repo, secrets stay in env

## Invariants
- `AppConfig` always passes Zod validation
- Environment variables take precedence over TOML values for `api_key`, `database.url`

## Key Files
- `schema.ts` -- Zod schemas and inferred types (Functional Core)
- `config.ts` -- TOML loading, env merging, re-exports types (Imperative Shell)
