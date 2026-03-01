# Constellation

Last verified: 2026-03-01

Stateful AI agent daemon ("Machine Spirit") with persistent memory, tool use, and sandboxed code execution. Built on a Functional Core / Imperative Shell architecture with hexagonal port/adapter boundaries.

## Tech Stack
- Runtime: Bun (TypeScript, ESM)
- Language: TypeScript 5.7+ (strict mode, `noUncheckedIndexedAccess`)
- Database: PostgreSQL 17 with pgvector extension
- Sandbox: Deno (subprocess with IPC bridge)
- LLM: Anthropic SDK, OpenAI-compatible endpoints
- Embeddings: OpenAI, Ollama
- Config: TOML with Zod validation
- Testing: `bun test`

## Commands
- `bun run start` -- Start the daemon REPL
- `bun run build` -- Type-check (`tsc --noEmit`)
- `bun test` -- Run all tests
- `bun run migrate` -- Run database migrations
- `docker compose up -d` -- Start pgvector PostgreSQL

## Project Structure
- `src/config/` -- TOML config loading, Zod schemas
- `src/persistence/` -- PostgreSQL adapter, migrations
- `src/model/` -- LLM provider port (Anthropic, OpenAI-compat)
- `src/embedding/` -- Embedding provider port (OpenAI, Ollama)
- `src/memory/` -- Three-tier memory system (core/working/archival)
- `src/tool/` -- Tool registry, built-in tools (memory, code, compaction)
- `src/runtime/` -- Deno sandbox executor with IPC bridge
- `src/agent/` -- Agent loop, context building, compression
- `src/compaction/` -- Context compression pipeline (summarize, archive, clip-archive)
- `src/extensions/` -- Extension interfaces (DataSource, Coordinator, Scheduler, ToolProvider) and implementations
- `src/extensions/bluesky/` -- Bluesky DataSource (Jetstream firehose, AT Protocol)
- `src/index.ts` -- Entry point, composition root, REPL

## Conventions
- **Functional Core / Imperative Shell**: Every file annotates its pattern (`// pattern: Functional Core` or `// pattern: Imperative Shell`)
- **Port/Adapter boundaries**: Domain types live in `types.ts`, port interfaces in dedicated files, adapters in implementation files
- **Barrel exports**: Each module has `index.ts` exporting public API
- **Factory functions over classes**: `createFoo()` returns interface, no `new`
- **Path aliases**: `@/*` maps to `./src/*` (tsconfig paths)
- **Environment overrides**: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, `EMBEDDING_API_KEY` override config.toml values

## Boundaries
- Safe to edit: `src/`
- Immutable: `src/persistence/migrations/*.sql` (append-only, never modify existing)
- Generated: `bun.lock`, `deno.lock`, `node_modules/`
- Sandbox boundary: `src/runtime/deno/` is Deno code (excluded from tsconfig), everything else is Bun
