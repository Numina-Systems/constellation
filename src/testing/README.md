# Isolated test infrastructure

Phase 0 integration tests require an explicit disposable PostgreSQL/pgvector admin endpoint:

```sh
TEST_DATABASE_ADMIN_URL='postgresql://user:password@localhost:5432/constellation_test_admin' \
  bun run test:integration-required
```

The harness rejects non-loopback hosts, system databases, missing values, and database names it did not create. It never reads `DATABASE_URL`, and all errors redact URL credentials. Each run creates a random `constellation_test_<uuid>` database, applies migrations only to that database, and drops only that exact owned name.

Commands:

- `bun run test:unit` — deterministic Phase 0 unit/factory tests; no database or network.
- `bun run test:integration-required` — required isolated PostgreSQL gate; fails visibly if `TEST_DATABASE_ADMIN_URL` is absent or unsafe.
- `bun run test:full-isolated` — runs four stages in order: unit, the migrated legacy database suites, transaction-specific database tests, and the required integration gate.
- `bun run build` — Bun-side TypeScript check (Deno bridge remains a separate check when changed).

**Warning:** bare `bun test` may contact a database for suites not yet migrated to the harness. Use the isolated commands instead. Out-of-lease remainders are `src/custom-tool/postgres-store.test.ts`, `src/diary/integration.test.ts`, `src/ingest/ingest.test.ts`, `src/memory/manager.test.ts`, `src/secrets/postgres-store.test.ts`, and `src/subconscious/{agent,continuation-transaction,emergent,impulse}.test.ts`; they retain legacy setup and remain outside the isolated legacy command. `src/agent/agent.test.ts` has only an explicit skipped integration case and no active database setup. Do not point the admin URL at an operational/shared database. Live provider/API tests remain opt-in and are not part of these commands.
