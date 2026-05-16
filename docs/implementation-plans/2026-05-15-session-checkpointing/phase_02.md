# Session Checkpointing Implementation Plan — Phase 2

**Goal:** Create the `session_checkpoints` table and implement the PostgreSQL adapter for checkpoint CRUD and pruning.

**Architecture:** Append-only migration for the table schema, plus an Imperative Shell adapter implementing `CheckpointStore` via the existing `PersistenceProvider` query interface. Save and prune run atomically. Follows the `createPredictionStore(persistence)` factory pattern from `src/reflexion/prediction-store.ts`.

**Tech Stack:** Bun (TypeScript), PostgreSQL

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-05-16

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

**Verifies:** session-checkpointing.AC5.1, session-checkpointing.AC5.2

**Files:**
- Create: `src/persistence/migrations/010_session_checkpoints.sql`

**Implementation:**

Create `src/persistence/migrations/010_session_checkpoints.sql`. Follow the existing migration conventions from `009_subconscious_schema.sql`:
- `CREATE TABLE IF NOT EXISTS` for idempotency
- `TEXT PRIMARY KEY` for IDs (application-generated UUIDs stored as text, matching all other tables in the project)
- `TIMESTAMPTZ NOT NULL DEFAULT NOW()` for timestamps
- `CREATE INDEX IF NOT EXISTS` for query optimization

```sql
CREATE TABLE IF NOT EXISTS session_checkpoints (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('explicit', 'pre_compaction', 'shutdown', 'interval')),
    checkpoint_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_conversation_id
    ON session_checkpoints (conversation_id);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner
    ON session_checkpoints (owner);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner_created_at
    ON session_checkpoints (owner, created_at DESC);
```

The CHECK constraint on `trigger` matches the `CheckpointTrigger` type from Phase 1. The composite index on `(owner, created_at DESC)` supports `loadLatest` efficiently. The `conversation_id` index supports `prune` queries.

**Note:** Verify migration number at implementation time against the latest `src/persistence/migrations/` directory. If `010` is taken, use the next available number.

**Verification:**
Run: `bun run build`
Expected: Type-check passes (migrations are just SQL, build verifies no TypeScript regressions)

**Commit:** `feat(persistence): add session_checkpoints table migration`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: CheckpointStore implementation

**Verifies:** session-checkpointing.AC4.1, session-checkpointing.AC4.3, session-checkpointing.AC5.2

**Files:**
- Create: `src/persistence/checkpoint-store.ts`

**Implementation:**

Create `src/persistence/checkpoint-store.ts` with pattern annotation `// pattern: Imperative Shell`.

Import types from the persistence module and the checkpoint module:
```typescript
import type { PersistenceProvider } from './types.ts';
import type { SessionCheckpoint } from '@/agent/checkpoint-types.ts';
import { deserializeCheckpoint } from '@/agent/checkpoint-serializer.ts';
```

Define the `CheckpointStore` type:
```typescript
type CheckpointStore = {
  save(checkpoint: SessionCheckpoint): Promise<void>;
  load(id: string): Promise<SessionCheckpoint | null>;
  loadLatest(owner: string): Promise<SessionCheckpoint | null>;
  prune(conversationId: string, retainCount: number): Promise<number>;
};
```

Implement `createCheckpointStore(persistence: PersistenceProvider): CheckpointStore` following the factory pattern from `src/reflexion/prediction-store.ts:62-180`:

1. **`save(checkpoint)`** — INSERT into `session_checkpoints`:
   ```sql
   INSERT INTO session_checkpoints (id, conversation_id, owner, trigger, checkpoint_data, created_at)
   VALUES ($1, $2, $3, $4, $5, $6)
   ```
   Parameters: `[checkpoint.id, checkpoint.conversationId, checkpoint.owner, checkpoint.trigger, JSON.stringify(checkpoint), checkpoint.createdAt]`

   The entire `SessionCheckpoint` is stored as JSONB in `checkpoint_data`. The top-level columns are denormalized for querying and indexing.

2. **`load(id)`** — SELECT by primary key:
   ```sql
   SELECT checkpoint_data FROM session_checkpoints WHERE id = $1
   ```
   Define a row type: `type CheckpointRow = { checkpoint_data: unknown }`. If no rows returned, return `null`. Otherwise, pass `rows[0]!.checkpoint_data` through `deserializeCheckpoint()` and return.

3. **`loadLatest(owner)`** — SELECT most recent by owner:
   ```sql
   SELECT checkpoint_data FROM session_checkpoints
   WHERE owner = $1
   ORDER BY created_at DESC
   LIMIT 1
   ```
   Same null/deserialize logic as `load`.

4. **`prune(conversationId, retainCount)`** — DELETE oldest beyond retention, return deleted count:
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
   Return `rows.length` (number of deleted rows).

Export `CheckpointStore` type and `createCheckpointStore` factory as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(persistence): implement CheckpointStore PostgreSQL adapter`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: CheckpointStore integration tests

**Verifies:** session-checkpointing.AC4.1, session-checkpointing.AC4.2, session-checkpointing.AC4.3, session-checkpointing.AC4.4, session-checkpointing.AC5.2

**Files:**
- Create: `src/persistence/checkpoint-store.test.ts`

**Testing:**

Create integration tests against a real PostgreSQL database. Follow the test setup pattern from `src/skill/postgres-store.test.ts:25-44`:

```typescript
import { createPostgresProvider } from '../persistence/postgres.ts';

const DB_CONNECTION_STRING = 'postgresql://constellation:constellation@localhost:5432/constellation';

beforeAll(async () => {
  persistence = createPostgresProvider({ url: DB_CONNECTION_STRING });
  await persistence.connect();
  await persistence.runMigrations();
  store = createCheckpointStore(persistence);
});

afterEach(async () => {
  await persistence.query('DELETE FROM session_checkpoints');
});

afterAll(async () => {
  await persistence.disconnect();
});
```

Use `serializeCheckpoint()` from Phase 1 to create test checkpoint objects. Create a helper to build test checkpoints with controlled timestamps and IDs.

Tests must verify:

- **session-checkpointing.AC5.2 (save and load round-trip):** Create a checkpoint via `serializeCheckpoint()`, save it, load it by ID. Assert all fields match the original (verify through `deserializeCheckpoint` which validates via Zod).

- **Load nonexistent returns null:** Call `load()` with a random UUID string. Assert result is `null`.

- **loadLatest returns most recent:** Save 3 checkpoints for the same owner with staggered `createdAt` values (e.g., subtract seconds from `new Date().toISOString()`). Call `loadLatest(owner)`. Assert the returned checkpoint's `id` matches the newest one.

- **loadLatest with no checkpoints returns null:** Call `loadLatest()` for a nonexistent owner. Assert result is `null`.

- **session-checkpointing.AC4.1 + AC4.3 (prune deletes oldest beyond retention):** Save 5 checkpoints for the same conversation with sequential timestamps. Call `prune(conversationId, 3)`. Assert return value is `2`. Call `load()` for each ID. Assert the 2 oldest return `null` and the 3 newest return valid checkpoints.

- **session-checkpointing.AC4.4 (prune with fewer than retention is no-op):** Save 2 checkpoints. Call `prune(conversationId, 5)`. Assert return value is `0`. Both checkpoints still loadable.

- **Prune scoped to conversation:** Save 3 checkpoints for conversation A, 3 for conversation B. Prune conversation A with retention 1. Assert only conversation A's oldest 2 are deleted; all of conversation B's checkpoints remain.

**Verification:**
Run: `bun test src/persistence/checkpoint-store.test.ts`
Expected: All tests pass (requires running PostgreSQL — `docker compose up -d`)

**Commit:** `test(persistence): add CheckpointStore integration tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
