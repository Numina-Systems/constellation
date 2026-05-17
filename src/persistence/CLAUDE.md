# Persistence

Last verified: 2026-05-16

## Purpose
Provides a PostgreSQL adapter behind a port interface so all database access flows through a single abstraction. Owns schema migrations and the checkpoint store for session persistence.

## Contracts
- **Exposes**: `PersistenceProvider` interface (`connect`, `disconnect`, `runMigrations`, `query`, `withTransaction`), `createPostgresProvider(config)`, `CheckpointStore` interface (`save`, `load`, `loadLatest`, `prune`), `createCheckpointStore(persistence)`, `MessageStore` type (`count`, `listIds`, `getLatest`), `createMessageStore(persistence)`
- **Guarantees**: Migrations run in order, inside transactions, and are idempotent (tracked in `schema_migrations` table). `withTransaction` rolls back on error. Nested `withTransaction` calls use savepoints transparently via `AsyncLocalStorage` (same connection, depth-tracked). `MessageStore` provides typed read access to the `messages` table.
- **Expects**: PostgreSQL with pgvector extension available at configured URL.

## Dependencies
- **Uses**: `pg` (node-postgres), `src/config/`
- **Used by**: `src/memory/postgres-store.ts`, `src/agent/agent.ts` (message persistence), `src/agent/checkpoint-create.ts` (checkpoint persistence via `CheckpointStore`), `src/skill/postgres-store.ts` (skill embeddings), `src/search/` (memory and conversation search domains), `src/reflexion/` (prediction store, trace recorder), `src/scheduler/` (scheduled tasks), `src/activity/` (activity state, event queue), `src/tool/builtin/scheduling.ts` (owner-scoped task queries), `src/index.ts`
- **Boundary**: No module should import `pg` directly. All SQL goes through `PersistenceProvider.query`.

## Key Decisions
- Connection pooling via `pg.Pool`: Handles concurrent queries without manual management
- SQL migration files: Plain `.sql` in `migrations/`, sorted by filename prefix
- Transparent nested transactions via AsyncLocalStorage: Callers don't need to know if they're already in a transaction; inner `withTransaction` calls use savepoints automatically
- MessageStore as separate factory: Read-only typed queries for messages, keeps `PersistenceProvider` interface minimal

## Invariants
- Existing migration files are immutable (append new files only)
- All schema changes go through migration files
- `QueryFunction` generic returns typed rows; callers cast via type parameter

## Key Files
- `types.ts` -- `PersistenceProvider` and `QueryFunction` port interfaces
- `postgres.ts` -- PostgreSQL adapter implementation (includes AsyncLocalStorage transaction context for nested transactions)
- `message-store.ts` -- `MessageStore` type and `createMessageStore` factory (typed read-only access to messages table)
- `checkpoint-store.ts` -- `CheckpointStore` implementation (save, load, loadLatest, prune)
- `migrate.ts` -- Standalone migration runner entry point
- `index.ts` -- Barrel exports for persistence module
- `migrations/*.sql` -- Schema migration files (append-only, includes `010_session_checkpoints.sql`)
