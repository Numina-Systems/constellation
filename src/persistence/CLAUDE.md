# Persistence

Last verified: 2026-05-16

## Purpose
Provides a PostgreSQL adapter behind a port interface so all database access flows through a single abstraction. Owns schema migrations and the checkpoint store for session persistence.

## Contracts
- **Exposes**: `PersistenceProvider` interface (`connect`, `disconnect`, `runMigrations`, `query`, `withTransaction`), `createPostgresProvider(config)`, `CheckpointStore` interface (`save`, `load`, `loadLatest`, `prune`), `createCheckpointStore(persistence)`
- **Guarantees**: Migrations run in order, inside transactions, and are idempotent (tracked in `schema_migrations` table). `withTransaction` rolls back on error.
- **Expects**: PostgreSQL with pgvector extension available at configured URL.

## Dependencies
- **Uses**: `pg` (node-postgres), `src/config/`
- **Used by**: `src/memory/postgres-store.ts`, `src/agent/agent.ts` (message persistence), `src/agent/checkpoint-create.ts` (checkpoint persistence via `CheckpointStore`), `src/skill/postgres-store.ts` (skill embeddings), `src/search/` (memory and conversation search domains), `src/reflexion/` (prediction store, trace recorder), `src/scheduler/` (scheduled tasks), `src/activity/` (activity state, event queue), `src/tool/builtin/scheduling.ts` (owner-scoped task queries), `src/index.ts`
- **Boundary**: No module should import `pg` directly. All SQL goes through `PersistenceProvider.query`.

## Key Decisions
- Connection pooling via `pg.Pool`: Handles concurrent queries without manual management
- SQL migration files: Plain `.sql` in `migrations/`, sorted by filename prefix

## Invariants
- Existing migration files are immutable (append new files only)
- All schema changes go through migration files
- `QueryFunction` generic returns typed rows; callers cast via type parameter

## Key Files
- `types.ts` -- `PersistenceProvider` and `QueryFunction` port interfaces
- `postgres.ts` -- PostgreSQL adapter implementation
- `migrate.ts` -- Standalone migration runner entry point
- `checkpoint-store.ts` -- `CheckpointStore` implementation (save, load, loadLatest, prune)
- `index.ts` -- Barrel exports for persistence module
- `migrations/*.sql` -- Schema migration files (append-only, includes `010_session_checkpoints.sql`)
