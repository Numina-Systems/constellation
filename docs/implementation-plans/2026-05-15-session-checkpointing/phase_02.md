# Session Checkpointing Implementation Plan

**Goal:** Create the `session_checkpoints` table and implement the PostgreSQL adapter for checkpoint CRUD and pruning.

**Architecture:** Append-only migration for the table schema, plus an Imperative Shell adapter implementing `CheckpointStore` via the existing `PersistenceProvider` query interface. Save and prune run in a single transaction for atomicity.

**Tech Stack:** Bun, TypeScript 5.7+, PostgreSQL, Zod

**Scope:** Phase 2 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC4: Pruning
- **session-checkpointing.AC4.1 Success:** After creating a new checkpoint, old checkpoints beyond the retention limit are deleted
- **session-checkpointing.AC4.2 Success:** Retention limit is configurable via `checkpoint_retention` (default 5)
- **session-checkpointing.AC4.3 Success:** Pruning deletes by `created_at` ascending (oldest first)
- **session-checkpointing.AC4.4 Edge:** Conversations with fewer checkpoints than the retention limit are unaffected by pruning

### session-checkpointing.AC5: Storage and Migration
- **session-checkpointing.AC5.1 Success:** New `session_checkpoints` table is created via append-only migration
- **session-checkpointing.AC5.2 Success:** Table schema: `id` (UUID PK), `conversation_id` (text, indexed), `owner` (text, indexed), `trigger` (text), `checkpoint_data` (JSONB), `created_at` (timestamptz, default now())

---

<!-- START_TASK_1 -->
### Task 1: Database migration

**Verifies:** session-checkpointing.AC5.1, AC5.2

**Files:**
- Create: `src/persistence/migrations/010_create_session_checkpoints.sql`

**Implementation:**

Create `src/persistence/migrations/010_create_session_checkpoints.sql`:

```sql
CREATE TABLE IF NOT EXISTS session_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    trigger TEXT NOT NULL,
    checkpoint_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_conversation_id
    ON session_checkpoints (conversation_id);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner
    ON session_checkpoints (owner);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner_created_at
    ON session_checkpoints (owner, created_at DESC);
```

The composite index on `(owner, created_at DESC)` supports the `loadLatest` query efficiently. The individual `conversation_id` index supports pruning queries.

Follow existing migration conventions:
- File naming: `NNN_description.sql` (this is 010)
- CREATE IF NOT EXISTS for idempotency
- No modification of existing tables

**Note:** Verify migration number at implementation time against the latest `src/persistence/migrations/` directory state. If `010` is already taken, use the next available number.

**Verification:**
Run: `bun run migrate`
Expected: Migration 010 applies cleanly. Running again is a no-op.

**Commit:** `feat(checkpoint): add session_checkpoints table migration`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: CheckpointStore implementation

**Verifies:** session-checkpointing.AC4.1, AC4.3, AC5.2

**Files:**
- Create: `src/persistence/checkpoint-store.ts`

**Implementation:**

Create `src/persistence/checkpoint-store.ts` with pattern annotation `// pattern: Imperative Shell`.

Import `SessionCheckpoint` and `deserializeCheckpoint` from `@/agent/checkpoint-types.js` and `@/agent/checkpoint-serializer.js` respectively. Import `QueryFunction` from `./types.js`.

Define the `CheckpointStore` type:

```typescript
type CheckpointStore = {
  save(checkpoint: SessionCheckpoint): Promise<void>;
  load(id: string): Promise<SessionCheckpoint | null>;
  loadLatest(owner: string): Promise<SessionCheckpoint | null>;
  prune(conversationId: string, retainCount: number): Promise<number>;
};
```

Implement `createCheckpointStore(query: QueryFunction, withTransaction: <T>(fn: (q: QueryFunction) => Promise<T>) => Promise<T>): CheckpointStore`:

1. **`save(checkpoint)`** — INSERT into `session_checkpoints`:
   ```sql
   INSERT INTO session_checkpoints (id, conversation_id, owner, trigger, checkpoint_data, created_at)
   VALUES ($1, $2, $3, $4, $5, $6)
   ```
   Parameters: `[checkpoint.id, checkpoint.conversationId, checkpoint.owner, checkpoint.trigger, JSON.stringify(checkpoint), checkpoint.createdAt]`

   Note: The entire `SessionCheckpoint` is stored in `checkpoint_data` as JSONB. The top-level columns (`conversation_id`, `owner`, `trigger`, `created_at`) are denormalized for querying and indexing.

2. **`load(id)`** — SELECT by primary key:
   ```sql
   SELECT checkpoint_data FROM session_checkpoints WHERE id = $1
   ```
   If no row, return `null`. Otherwise, pass `rows[0].checkpoint_data` through `deserializeCheckpoint()` and return the validated object.

3. **`loadLatest(owner)`** — SELECT most recent by owner:
   ```sql
   SELECT checkpoint_data FROM session_checkpoints
   WHERE owner = $1
   ORDER BY created_at DESC
   LIMIT 1
   ```
   Same null/deserialize logic as `load`.

4. **`prune(conversationId, retainCount)`** — DELETE oldest beyond retention, return count deleted:
   ```sql
   DELETE FROM session_checkpoints
   WHERE conversation_id = $1
     AND id NOT IN (
       SELECT id FROM session_checkpoints
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     )
   ```
   Return `Number(result.length)` (the number of deleted rows, derived from `query` return type `Array<T>` — use a `RETURNING id` clause to get the count).

   Revised query with RETURNING:
   ```sql
   DELETE FROM session_checkpoints
   WHERE conversation_id = $1
     AND id NOT IN (
       SELECT id FROM session_checkpoints
       WHERE conversation_id = $2
       ORDER BY created_at DESC
       LIMIT $3
     )
   RETURNING id
   ```
   Parameters: `[conversationId, conversationId, retainCount]`
   Return `rows.length`.

Export `CheckpointStore` type and `createCheckpointStore` factory.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): implement CheckpointStore PostgreSQL adapter`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: CheckpointStore integration tests

**Verifies:** session-checkpointing.AC4.1, AC4.2, AC4.3, AC4.4, AC5.2

**Files:**
- Test: `src/persistence/checkpoint-store.test.ts` (integration)

**Implementation:**

Create `src/persistence/checkpoint-store.test.ts` with integration tests against a real PostgreSQL database. Follow the same test setup pattern as existing persistence tests (connect, run migrations, clean up).

Setup: Use the test database (same approach as other integration tests in `src/persistence/`). Before each test, DELETE FROM `session_checkpoints` to ensure clean state. Use `serializeCheckpoint()` from Phase 1 to create test checkpoint objects.

Test cases:

1. **Save and load round-trip:** Create a checkpoint via `serializeCheckpoint()`, save it, load it by ID. Assert all fields match the original.

2. **Load nonexistent returns null:** Call `load()` with a random UUID. Assert result is `null`.

3. **loadLatest returns most recent:** Save 3 checkpoints for the same owner (with staggered `createdAt` values — set manually or rely on insertion order with small delays). Call `loadLatest(owner)`. Assert the returned checkpoint is the one with the latest `createdAt`.

4. **loadLatest with no checkpoints returns null:** Call `loadLatest()` for a nonexistent owner. Assert result is `null`.

5. **Prune deletes oldest beyond retention (AC4.1, AC4.3):** Save 5 checkpoints for the same conversation. Call `prune(conversationId, 3)`. Assert return value is `2` (deleted 2). Call `load()` for each of the 5 IDs. Assert the 2 oldest return `null` and the 3 newest return valid checkpoints.

6. **Prune with fewer than retention is no-op (AC4.4):** Save 2 checkpoints. Call `prune(conversationId, 5)`. Assert return value is `0`. Both checkpoints still loadable.

7. **Prune scoped to conversation:** Save 3 checkpoints for conversation A, 3 for conversation B. Prune conversation A with retention 1. Assert only conversation A's oldest 2 are deleted; all of conversation B's checkpoints remain.

For creating test checkpoints with controlled timestamps, build a helper that calls `serializeCheckpoint()` and then overwrites `createdAt` with a specific ISO string before saving. This requires either mutating the object (since it comes back from serialization as a plain object) or creating the checkpoint object directly.

**Verification:**
Run: `bun test src/persistence/checkpoint-store.test.ts`
Expected: All tests pass (requires running PostgreSQL with migrations applied)

**Commit:** `test(checkpoint): add CheckpointStore integration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Barrel export

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/persistence/index.ts` (barrel file does not exist yet)

**Implementation:**

Create `src/persistence/index.ts` with re-exports of the existing persistence public API plus the new checkpoint store:

```typescript
// Re-export existing persistence public API
export type { PersistenceProvider, QueryFunction } from './types.js';
export { createPersistenceProvider } from './provider.js';

// Checkpoint store
export type { CheckpointStore } from './checkpoint-store.js';
export { createCheckpointStore } from './checkpoint-store.js';
```

Note: Verify the exact existing export names by checking `src/persistence/` source files at implementation time. The re-exports above are representative — include whatever the rest of the codebase currently imports from individual persistence files.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): export CheckpointStore from persistence barrel`
<!-- END_TASK_4 -->
