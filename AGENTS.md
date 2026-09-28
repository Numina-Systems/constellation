# Constellation

Last verified: 2026-09-08

Stateful AI agent daemon ("Machine Spirit") with persistent memory, tool use, and Deno code execution. Preserve its Functional Core / Imperative Shell architecture and injected port/adapter boundaries.

## Start here

- `package.json` defines runnable commands; `tsconfig.json` defines the Bun-side type-check boundary.
- `src/index.ts` is the composition root and REPL, wiring the agent, providers, persistence, tools, and event sources.
- Existing `src/<domain>/CLAUDE.md` files explain subsystem intent. Read the relevant ones, then verify promises against implementation and callers: some are stale.
- [Codebase review and recommendations](docs/2026-09-08-codebase-review-and-recommendations.md) records source-inspected risks, remediation status, and evidence limits. These are not claims that historical incidents were runtime-reproduced.
- [Integrity and lifecycle remediation operator guide](docs/implementation-plans/2026-09-08-remediation-operator-guide.md) describes retained history, recovery, limits, failure outcomes, and safe verification commands.

## Stack and commands

Bun, TypeScript ESM with strict checking and `noUncheckedIndexedAccess`; PostgreSQL/pgvector; Deno subprocess sandbox; TOML configuration validated with Zod. Model adapters cover Anthropic, OpenAI-compatible endpoints, Ollama, and OpenRouter; embeddings use OpenAI or Ollama. MCP uses the TypeScript SDK.

| Command | Purpose and boundary |
|---|---|
| `bun run build` | Type-check with `tsc --noEmit`; does not build a bundle or check `src/runtime/deno/**`. |
| `bun test src/<domain>/<file>.test.ts` | Run a targeted test file; inspect its setup for external dependencies and mutations first. |
| `bun test` | Run the full suite, including integration tests. |
| `bun run start` | Start the configured daemon/REPL; can contact external services and modify persistent state. |
| `bun run migrate` | Apply database migrations to the configured database. |
| `bun run backfill-embeddings` | Mutate stored embeddings; can call an embedding service. |

Deno integration tests spawn real subprocesses and require Deno on PATH. Database integration tests can create, truncate, and drop tables. Verify their target and use an isolated disposable database before running them. State which checks ran and which were only inspected or skipped.

## Source map

| Area | Entry points and responsibility |
|---|---|
| Agent and context | `src/agent/`: turns, context assembly, snapshots, cache diagnostics, checkpoints. `src/compaction/`: summaries and archival replacement. |
| Storage and memory | `src/persistence/`: query/transaction port, PostgreSQL adapter, migrations, checkpoint/message stores. `src/memory/`: core/working/archival memory. |
| Retrieval and maintenance | `src/search/`, `src/recall/`, `src/diary/`, `src/skill/`, `src/archivist/`, `src/ingest/`. |
| Models and configuration | `src/model/`, `src/embedding/`, `src/rate-limit/`, `src/config/`, `src/errors/`. |
| Tools and execution | `src/tool/`, `src/custom-tool/`, `src/runtime/`, `src/shell/`, `src/secrets/`, `src/mcp/`. |
| Autonomous activity | `src/scheduler/`, `src/activity/`, `src/subconscious/`, `src/reflexion/`, `src/loop-detection/`; `src/scheduled-context.ts` formats activity context. |
| External services | `src/extensions/` and `src/extensions/bluesky/`, `src/web/`, `src/email/`. |
| Planning documents | `docs/design-plans/`, `docs/implementation-plans/`, `docs/test-plans/`; plans describe intent, not proof of completed wiring. |

## Implementation conventions

- Annotate TypeScript modules with `// pattern: Functional Core` or `// pattern: Imperative Shell`; keep policy and transformations separate from I/O.
- Prefer `createFoo()` factories returning injected interfaces for services. Structured error classes are an existing exception, not a reason to rewrite them.
- Keep domain types in `types.ts`, ports explicit, and public module exports in `index.ts`. Follow nearby `.ts` imports and `@/*` aliases (`./src/*`).
- Route database access through `PersistenceProvider`, not direct `pg` imports in domain modules. Parameterize SQL and use `withTransaction` for related mutations.
- Use subsystem errors from `src/errors/` with code, context, and useful suggestions; record errors through existing trace integration without leaking sensitive data.
- Inspect production callers and composition-root wiring when changing a helper. Tests should prove the real entry point reaches the behavior, not invoke a missing callback manually.

## Safety and review boundaries

- Existing `src/persistence/migrations/*.sql` files are immutable; append new migrations for schema changes.
- `src/runtime/deno/` runs in Deno, not Bun. Verify both sides of IPC changes; the regular build excludes that directory.
- Treat `bun.lock`, `deno.lock`, and `node_modules/` as generated. Use dependency tooling for intentional lockfile changes.
- Preserve unrelated working-tree changes, including untracked planning and sync-conflict documents. Limit edits to the requested task.
- Keep secret values out of files, terminal output, traces, and reports. Inspect configuration schemas or key presence rather than reading local secret-bearing configuration; use environment references or the existing secret resolver.
- Starting the daemon, applying migrations, backfilling data, and contacting real integrations are operational actions, not harmless validation substitutes.

## Known areas requiring verification

The September 2026 review found gaps in memory deletion authorization, sandbox output/cancellation bounds, shared-agent turn serialization, tool-result/error integrity, checkpoint wiring, and compaction persistence/recovery. Existing domain documentation sometimes describes stronger guarantees than the source enforces.

For changes in those paths, verify authorization before mutation, complete tool-call/result pairing, execution lifetime ownership, and durable old-or-new state after failure. Preserve original transcript recoverability when designing checkpoint/compaction changes. These are review targets, not claims that the current implementation already satisfies them.

Keep this file concise and update its verification date after rechecking changed guidance. Put detailed findings and design decisions in `docs/`, not in automatically loaded context.
