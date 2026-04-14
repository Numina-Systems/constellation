# Constellation

Last verified: 2026-04-14

Stateful AI agent daemon ("Machine Spirit") with persistent memory, tool use, and sandboxed code execution. Built on a Functional Core / Imperative Shell architecture with hexagonal port/adapter boundaries.

## Tech Stack
- Runtime: Bun (TypeScript, ESM)
- Language: TypeScript 5.7+ (strict mode, `noUncheckedIndexedAccess`)
- Database: PostgreSQL 17 with pgvector extension
- Sandbox: Deno (subprocess with IPC bridge)
- LLM: Anthropic SDK, OpenAI-compatible endpoints, Ollama (native `/api/chat`), OpenRouter
- Embeddings: OpenAI, Ollama
- Config: TOML with Zod validation
- Testing: `bun test`

## Commands
- `bun run start` -- Start the daemon REPL
- `bun run build` -- Type-check (`tsc --noEmit`)
- `bun test` -- Run all tests
- `bun run migrate` -- Run database migrations
- `bun run backfill-embeddings` -- Backfill embeddings for existing messages
- `docker compose up -d` -- Start pgvector PostgreSQL

## Project Structure
- `src/config/` -- TOML config loading, Zod schemas
- `src/persistence/` -- PostgreSQL adapter, migrations
- `src/model/` -- LLM provider port (Anthropic, OpenAI-compat, Ollama, OpenRouter)
- `src/embedding/` -- Embedding provider port (OpenAI, Ollama)
- `src/memory/` -- Three-tier memory system (core/working/archival)
- `src/search/` -- Hybrid search (semantic + keyword + RRF) across memory and conversations
- `src/tool/` -- Tool registry, built-in tools (memory, code, compaction, web, scheduling, search)
- `src/web/` -- Web search and fetch pipeline (Brave, Tavily, SearXNG, DuckDuckGo)
- `src/runtime/` -- Deno sandbox executor with IPC bridge
- `src/rate-limit/` -- Client-side token bucket rate limiter for model providers
- `src/skill/` -- Embedding-based skill retrieval (YAML frontmatter parsing, change detection, semantic search)
- `src/agent/` -- Agent loop, context building, compression, context providers, per-turn skill injection, per-turn trace recording
- `src/compaction/` -- Context compression pipeline (summarize, archive, clip-archive)
- `src/reflexion/` -- Prediction journaling, operation tracing, introspection tools, context provider
- `src/scheduler/` -- PostgreSQL-backed cron scheduler with owner isolation (agent-owned vs system-owned tasks)
- `src/activity/` -- Circadian sleep/wake cycle with event queuing, sleep tasks, and activity-aware dispatch
- `src/scheduled-context.ts` -- Pure function: formats operation traces into compact `[Recent Activity]` summaries for scheduled task events
- `src/subconscious/` -- Interest registry, curiosity threads, engagement decay, exploration logging (PostgreSQL-backed)
- `src/email/` -- Email sending via Mailgun with recipient allowlist (send_email tool)
- `src/extensions/` -- Extension interfaces (DataSource, Coordinator, Scheduler, ToolProvider), DataSource registry factory, and implementations
- `src/extensions/bluesky/` -- Bluesky DataSource (Jetstream firehose, AT Protocol)
- `src/index.ts` -- Entry point, composition root (single agent with DataSource registry routing), REPL

## Conventions
- **Functional Core / Imperative Shell**: Every file annotates its pattern (`// pattern: Functional Core` or `// pattern: Imperative Shell`)
- **Port/Adapter boundaries**: Domain types live in `types.ts`, port interfaces in dedicated files, adapters in implementation files
- **Barrel exports**: Each module has `index.ts` exporting public API
- **Factory functions over classes**: `createFoo()` returns interface, no `new`
- **Path aliases**: `@/*` maps to `./src/*` (tsconfig paths)
- **Environment overrides**: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, `OPENROUTER_API_KEY`, `EMBEDDING_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` override config.toml values

## Boundaries
- Safe to edit: `src/`
- Immutable: `src/persistence/migrations/*.sql` (append-only, never modify existing)
- Generated: `bun.lock`, `deno.lock`, `node_modules/`
- Sandbox boundary: `src/runtime/deno/` is Deno code (excluded from tsconfig), everything else is Bun
