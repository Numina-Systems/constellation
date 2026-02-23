# Persistence

Last verified: 2026-02-23

## Purpose
Provides a PostgreSQL adapter behind a port interface so all database access flows through a single abstraction. Owns schema migrations.

## Contracts
- **Exposes**: `PersistenceProvider` interface (`connect`, `disconnect`, `runMigrations`, `query`, `withTransaction`), `createPostgresProvider(config)`
- **Guarantees**: Migrations run in order, inside transactions, and are idempotent (tracked in `schema_migrations` table). `withTransaction` rolls back on error.
- **Expects**: PostgreSQL with pgvector extension available at configured URL.

## Dependencies
- **Uses**: `pg` (node-postgres), `src/config/`
- **Used by**: `src/memory/postgres-store.ts`, `src/agent/agent.ts` (message persistence), `src/index.ts`
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
- `migrations/*.sql` -- Schema migration files (append-only)
