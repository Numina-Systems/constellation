# Phase 0 verification commands

The safe default is the unit command:

```sh
bun run build
bun run test:unit
```

Database-backed verification is explicitly isolated. It requires a local disposable PostgreSQL/pgvector admin endpoint in `TEST_DATABASE_ADMIN_URL`; the harness creates a uniquely named `constellation_test_<uuid>` database, applies migrations there, and drops only that database during teardown.

```sh
bun run test:integration-required
bun run test:legacy-isolated
bun run test:full-isolated
```

`test:integration-required` intentionally fails when `TEST_DATABASE_ADMIN_URL` is absent. No test command in this document falls back to `DATABASE_URL`, and no operational database should be used as a test prerequisite.

**Warning:** bare `bun test` may contact a database for any suite not yet migrated to the isolated harness. The out-of-lease remainders are `src/custom-tool/postgres-store.test.ts`, `src/diary/integration.test.ts`, `src/ingest/ingest.test.ts`, `src/memory/manager.test.ts`, `src/secrets/postgres-store.test.ts`, and `src/subconscious/{agent,continuation-transaction,emergent,impulse}.test.ts`; they retain legacy setup and are not in `test:legacy-isolated`. `src/agent/agent.test.ts` has only an explicit skipped integration block and no active database setup. All leased database-touching suites listed in the isolated scripts use a unique harness database.

The contracts files `src/contracts/execution.ts` and `src/contracts/history.ts`, plus barrel indexes `src/contracts/index.ts` and `src/testing/index.ts`, are type-only/re-export-only and are intentionally exempt from FCIS pattern comments. Runtime contract code in `src/contracts/outcomes.ts` is annotated.

Live provider/API tests remain opt-in and are not part of Phase 0 unit or isolated commands. The legacy compaction suite additionally requires a reachable Ollama endpoint when its tests are executed; absence is reported as a visible skip.
