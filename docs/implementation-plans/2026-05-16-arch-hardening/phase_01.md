# Architectural Hardening Implementation Plan

**Goal:** Make PersistenceProvider transaction-aware via AsyncLocalStorage with savepoint-based nesting

**Architecture:** Module-level AsyncLocalStorage propagates a transaction context (`{ client, depth }`) through async call chains. `query()` checks the store and routes to the transaction client when active; `withTransaction()` detects nesting and uses SAVEPOINT/RELEASE/ROLLBACK TO instead of BEGIN/COMMIT/ROLLBACK.

**Tech Stack:** Bun (TypeScript), PostgreSQL 17, `node:async_hooks` (AsyncLocalStorage), pg PoolClient

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC2: Nested transaction support via savepoints
- **arch-hardening.AC2.1 Success:** Top-level `withTransaction` issues BEGIN/COMMIT
- **arch-hardening.AC2.2 Success:** Nested `withTransaction` issues SAVEPOINT/RELEASE (no BEGIN)
- **arch-hardening.AC2.3 Success:** Deeply nested transactions (depth > 2) use unique savepoint names
- **arch-hardening.AC2.4 Failure:** Nested error + rethrow rolls back savepoint and propagates to root ROLLBACK
- **arch-hardening.AC2.5 Failure:** Nested error + catch rolls back savepoint but parent transaction remains committable

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add AsyncLocalStorage transaction context type and storage

**Verifies:** None (infrastructure for subsequent tasks)

**Files:**
- Modify: `src/persistence/postgres.ts` (lines 1-10, add imports and module-level storage)
- Modify: `src/persistence/types.ts` (no interface changes — confirm only)

**Implementation:**

At the top of `src/persistence/postgres.ts`, add the AsyncLocalStorage import and define the transaction context type and storage instance. The `TxContext` type holds the PoolClient and a nesting depth counter.

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

type TxContext = {
  client: PoolClient;
  depth: number;
};

const txStorage = new AsyncLocalStorage<TxContext>();
```

Place this after existing imports but before `createPostgresProvider`. The `PersistenceProvider` interface in `types.ts` remains unchanged — the callback signature of `withTransaction` stays the same: `withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T>`.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(persistence): add AsyncLocalStorage transaction context type`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Rewrite query() and withTransaction() for transparent nesting

**Verifies:** arch-hardening.AC2.1, arch-hardening.AC2.2, arch-hardening.AC2.3, arch-hardening.AC2.4, arch-hardening.AC2.5

**Files:**
- Modify: `src/persistence/postgres.ts` (lines 67-97, replace both functions entirely)

**Implementation:**

Replace the current `query()` (lines 67-73) with a version that checks `txStorage.getStore()` first. If a transaction context exists, route through the transaction's client. Otherwise use the pool.

Replace the current `withTransaction()` (lines 75-97) with nested-aware logic:
- If no context exists: acquire client, BEGIN, run callback inside `txStorage.run(...)`, COMMIT on success, ROLLBACK on error, release client in finally.
- If context exists: increment depth, issue `SAVEPOINT sp_${depth}`, run callback. On success: `RELEASE SAVEPOINT sp_${depth}`. On error: `ROLLBACK TO SAVEPOINT sp_${depth}`, then rethrow.

The callback still receives a `queryFn` parameter for backward compatibility, but this `queryFn` simply delegates to the module-level `query()` (which now routes through the transaction context automatically).

```typescript
async function query<T extends Record<string, unknown>>(
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<Array<T>> {
  const ctx = txStorage.getStore();
  if (ctx) {
    const result = await ctx.client.query(sql, params as Array<unknown>);
    return result.rows as Array<T>;
  }
  const result = await pool.query(sql, params as Array<unknown>);
  return result.rows as Array<T>;
}

async function withTransaction<T>(
  fn: (queryFn: typeof query) => Promise<T>,
): Promise<T> {
  const existing = txStorage.getStore();

  if (existing) {
    const depth = existing.depth + 1;
    const savepoint = `sp_${depth}`;
    await existing.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await txStorage.run(
        { client: existing.client, depth },
        () => fn(query),
      );
      await existing.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await existing.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run(
      { client, depth: 0 },
      () => fn(query),
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Key design decisions:
- Depth starts at 0 for root transaction, increments for each nesting level
- Savepoint names are `sp_1`, `sp_2`, etc. (depth value when savepoint is created)
- The `queryFn` passed to callbacks is the module-level `query()` — it routes transparently via AsyncLocalStorage
- `ROLLBACK TO SAVEPOINT` does NOT destroy the savepoint, so parent can continue
- Client release in `finally` only at root level (nested paths don't touch the client lifecycle)

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(persistence): implement transparent nested transactions via AsyncLocalStorage`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Integration tests for transaction nesting

**Verifies:** arch-hardening.AC2.1, arch-hardening.AC2.2, arch-hardening.AC2.3, arch-hardening.AC2.4, arch-hardening.AC2.5

**Files:**
- Create: `src/persistence/tx-nesting.test.ts`

**Implementation:**

Integration tests hitting a real PostgreSQL database (following project convention). Tests must verify actual SQL behavior — not mocked.

Setup pattern (following `src/reflexion/prediction-store.test.ts`):
- `beforeAll`: create provider, connect, run migrations
- `afterEach`: truncate test tables
- `afterAll`: disconnect

Use a scratch table for test isolation. Create it in `beforeAll`:
```sql
CREATE TABLE IF NOT EXISTS tx_test (id SERIAL PRIMARY KEY, value TEXT NOT NULL)
```

Drop in `afterAll`:
```sql
DROP TABLE IF EXISTS tx_test
```

**Testing:**

Tests must verify each AC listed above:

- **arch-hardening.AC2.1:** Top-level `withTransaction` issues BEGIN/COMMIT — insert a row inside `withTransaction`, verify it's visible after the transaction completes. Insert another row, throw an error, verify the row is NOT visible (ROLLBACK worked).

- **arch-hardening.AC2.2:** Nested `withTransaction` uses SAVEPOINT — call `withTransaction` inside another `withTransaction`. Inner inserts a row. Verify the row is visible after both complete. This proves nesting doesn't issue a second BEGIN (which would error in PostgreSQL).

- **arch-hardening.AC2.3:** Deeply nested transactions use unique savepoint names — nest 3 levels deep. Each level inserts a distinct row. All rows visible after commit. This verifies depth > 2 works correctly with unique savepoint names.

- **arch-hardening.AC2.4:** Nested error + rethrow rolls back savepoint and propagates to root — outer `withTransaction` calls inner. Inner inserts a row then throws. Outer does NOT catch. Verify: entire transaction rolled back, no rows visible.

- **arch-hardening.AC2.5:** Nested error + catch rolls back savepoint but parent remains committable — outer `withTransaction` inserts row A, then wraps inner call in try/catch. Inner inserts row B then throws. Outer catches the error, inserts row C, completes normally. Verify: rows A and C visible, row B NOT visible.

Additional edge case test:
- **Non-transactional query uses pool directly** — outside any `withTransaction`, insert a row via `query()`. Verify it's immediately visible (no transaction wrapping).

Follow project pattern: `describe('arch-hardening.AC2.1: ...', () => { it('...', async () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/persistence/tx-nesting.test.ts`
Expected: All tests pass

**Commit:** `test(persistence): add integration tests for nested transaction support`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
