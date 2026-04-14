# Subconscious Implementation Plan — Phase 1: Interest Registry

**Goal:** PostgreSQL-backed interest and curiosity tracking with port/adapter boundary, following the PredictionStore pattern from `src/reflexion/`.

**Architecture:** Domain types in `src/subconscious/types.ts`, PostgreSQL adapter in `src/subconscious/persistence.ts`, migration in `src/persistence/migrations/009_subconscious_schema.sql`, factory function returning port interface. Raw SQL via `PersistenceProvider.query()`.

**Tech Stack:** TypeScript (Bun), PostgreSQL 17, bun:test

**Scope:** 7 phases from original design (phase 1 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC3: Interest registry tracks what the agent cares about
- **subconscious.AC3.1 Success:** Interests can be created with name, description, source, and engagement score
- **subconscious.AC3.2 Success:** Curiosity threads can be created, explored, resolved, or parked within an interest
- **subconscious.AC3.3 Success:** Engagement scores decay over time with configurable half-life
- **subconscious.AC3.4 Success:** Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached
- **subconscious.AC3.5 Failure:** Duplicate curiosity threads (same question within same interest) are detected and the existing thread is resumed instead

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Domain types for the interest registry

**Verifies:** None (types only — TypeScript compiler verifies)

**Files:**
- Create: `src/subconscious/types.ts`

**Implementation:**

Create the domain types file with pattern annotation `// pattern: Functional Core`.

Define the following types:

**`InterestSource`** — string literal union: `'emergent' | 'seeded' | 'external'`

**`InterestStatus`** — string literal union: `'active' | 'dormant' | 'abandoned'`

**`CuriosityStatus`** — string literal union: `'open' | 'exploring' | 'resolved' | 'parked'`

**`Interest`** — readonly type with fields:
- `id: string`
- `owner: string`
- `name: string`
- `description: string`
- `source: InterestSource`
- `engagementScore: number`
- `status: InterestStatus`
- `lastEngagedAt: Date`
- `createdAt: Date`

**`CuriosityThread`** — readonly type with fields:
- `id: string`
- `interestId: string`
- `owner: string`
- `question: string`
- `status: CuriosityStatus`
- `resolution: string | null`
- `createdAt: Date`
- `updatedAt: Date`

**`ExplorationLogEntry`** — readonly type with fields:
- `id: string`
- `owner: string`
- `interestId: string | null`
- `curiosityThreadId: string | null`
- `action: string`
- `toolsUsed: ReadonlyArray<string>`
- `outcome: string`
- `createdAt: Date`

**`InterestRegistryConfig`** — type with fields:
- `readonly engagementHalfLifeDays: number`
- `readonly maxActiveInterests: number`

**`InterestRegistry`** — port interface type with methods:

```typescript
type InterestRegistry = {
  // Interest CRUD
  createInterest(interest: Omit<Interest, 'id' | 'createdAt' | 'lastEngagedAt'>): Promise<Interest>;
  getInterest(id: string): Promise<Interest | null>;
  updateInterest(id: string, updates: Partial<Pick<Interest, 'name' | 'description' | 'engagementScore' | 'status'>>): Promise<Interest | null>;
  listInterests(owner: string, filters?: { status?: InterestStatus; source?: InterestSource; minScore?: number }): Promise<ReadonlyArray<Interest>>;

  // Curiosity thread CRUD
  createCuriosityThread(thread: Omit<CuriosityThread, 'id' | 'createdAt' | 'updatedAt'>): Promise<CuriosityThread>;
  getCuriosityThread(id: string): Promise<CuriosityThread | null>;
  updateCuriosityThread(id: string, updates: Partial<Pick<CuriosityThread, 'status' | 'resolution'>>): Promise<CuriosityThread | null>;
  listCuriosityThreads(interestId: string, filters?: { status?: CuriosityStatus }): Promise<ReadonlyArray<CuriosityThread>>;
  findDuplicateCuriosityThread(interestId: string, question: string): Promise<CuriosityThread | null>;

  // Exploration log
  logExploration(entry: Omit<ExplorationLogEntry, 'id' | 'createdAt'>): Promise<ExplorationLogEntry>;
  listExplorationLog(owner: string, limit?: number): Promise<ReadonlyArray<ExplorationLogEntry>>;

  // Engagement decay
  applyEngagementDecay(owner: string, halfLifeDays: number): Promise<number>;

  // Cap enforcement
  enforceActiveInterestCap(owner: string, maxActive: number): Promise<ReadonlyArray<Interest>>;

  // Engagement bump
  bumpEngagement(interestId: string, amount: number): Promise<Interest | null>;
};
```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add interest registry domain types`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Barrel export for subconscious module

**Verifies:** None (module structure only)

**Files:**
- Create: `src/subconscious/index.ts`

**Implementation:**

Create barrel export file with pattern annotation `// pattern: Functional Core (barrel export)`.

Export all types from `./types.ts`:
- `InterestSource`, `InterestStatus`, `CuriosityStatus`
- `Interest`, `CuriosityThread`, `ExplorationLogEntry`
- `InterestRegistryConfig`, `InterestRegistry`

Export `createInterestRegistry` from `./persistence.ts` (this file doesn't exist yet — the export will be added, but the build will fail until Task 4 creates it. Add it as a comment for now: `// export { createInterestRegistry } from './persistence.ts';` — uncomment in Task 4).

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add barrel export`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Database migration for interest registry tables

**Verifies:** None (infrastructure — verified operationally)

**Files:**
- Create: `src/persistence/migrations/009_subconscious_schema.sql`

**Implementation:**

Follow the conventions from `004_reflexion_schema.sql`:
- TEXT for IDs (UUIDs stored as text)
- TIMESTAMPTZ with DEFAULT NOW()
- CHECK constraints for enums (not PostgreSQL ENUM)
- JSONB for flexible arrays
- Indexes on owner, status, foreign keys

Create three tables:

**`interests` table:**
```sql
CREATE TABLE IF NOT EXISTS interests (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'emergent' CHECK (source IN ('emergent', 'seeded', 'external')),
    engagement_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'abandoned')),
    last_engaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interests_owner ON interests (owner);
CREATE INDEX IF NOT EXISTS idx_interests_owner_status ON interests (owner, status);
CREATE INDEX IF NOT EXISTS idx_interests_engagement_score ON interests (engagement_score);
```

**`curiosity_threads` table:**
```sql
CREATE TABLE IF NOT EXISTS curiosity_threads (
    id TEXT PRIMARY KEY,
    interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'exploring', 'resolved', 'parked')),
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curiosity_threads_interest_id ON curiosity_threads (interest_id);
CREATE INDEX IF NOT EXISTS idx_curiosity_threads_owner ON curiosity_threads (owner);
CREATE INDEX IF NOT EXISTS idx_curiosity_threads_status ON curiosity_threads (status);
```

**`exploration_log` table:**
```sql
CREATE TABLE IF NOT EXISTS exploration_log (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    interest_id TEXT REFERENCES interests(id) ON DELETE SET NULL,
    curiosity_thread_id TEXT REFERENCES curiosity_threads(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    tools_used JSONB NOT NULL DEFAULT '[]',
    outcome TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exploration_log_owner ON exploration_log (owner);
CREATE INDEX IF NOT EXISTS idx_exploration_log_created_at ON exploration_log (created_at);
```

**Step 1:** Create the migration file with the SQL above.

**Step 2:** Verify by running migrations:
Run: `bun run migrate`
Expected: Migration 009 applies without errors

**Step 3:** Verify tables exist:
Run: `echo "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('interests', 'curiosity_threads', 'exploration_log');" | docker exec -i $(docker ps -q -f name=postgres) psql -U constellation -d constellation`
Expected: All three tables listed

**Commit:** `feat(subconscious): add interest registry schema migration`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: PostgreSQL adapter for interest registry

**Verifies:** None directly (tested in Task 5)

**Files:**
- Create: `src/subconscious/persistence.ts`
- Modify: `src/subconscious/index.ts` (uncomment the `createInterestRegistry` export)

**Implementation:**

Create `src/subconscious/persistence.ts` with pattern annotation `// pattern: Imperative Shell`.

Follow the exact structure of `src/reflexion/prediction-store.ts`:
- Import `randomUUID` from `node:crypto`
- Import `PersistenceProvider` from `../persistence/types.ts`
- Import domain types from `./types.ts`
- Define row types (`InterestRow`, `CuriosityThreadRow`, `ExplorationLogRow`) mapping snake_case DB columns to their types
- Define parse functions (`parseInterest`, `parseCuriosityThread`, `parseExplorationLogEntry`) converting rows to domain types
- Export factory function `createInterestRegistry(persistence: PersistenceProvider): InterestRegistry`

**Row types:**

`InterestRow`:
- `id: string`, `owner: string`, `name: string`, `description: string`
- `source: string`, `engagement_score: number`, `status: string`
- `last_engaged_at: string`, `created_at: string`

`CuriosityThreadRow`:
- `id: string`, `interest_id: string`, `owner: string`, `question: string`
- `status: string`, `resolution: string | null`
- `created_at: string`, `updated_at: string`

`ExplorationLogRow`:
- `id: string`, `owner: string`, `interest_id: string | null`, `curiosity_thread_id: string | null`
- `action: string`, `tools_used: ReadonlyArray<string>`, `outcome: string`
- `created_at: string`

**Method implementations (all use `persistence.query<RowType>()` with parameterized SQL):**

`createInterest`: INSERT with `randomUUID()`, RETURNING *. Set `last_engaged_at` to NOW() via DEFAULT.

`getInterest`: SELECT * WHERE id = $1. Return `null` if no rows.

`updateInterest`: Build dynamic SET clause from non-undefined fields in `updates`. Also set `last_engaged_at = NOW()` on every update. RETURNING *. Return `null` if no rows.

`listInterests`: SELECT * WHERE owner = $1, with optional AND clauses for status, source, minScore. ORDER BY engagement_score DESC.

`createCuriosityThread`: INSERT with `randomUUID()`, RETURNING *.

`getCuriosityThread`: SELECT * WHERE id = $1. Return `null` if no rows.

`updateCuriosityThread`: Build dynamic SET clause, always update `updated_at = NOW()`. RETURNING *. Return `null` if no rows.

`listCuriosityThreads`: SELECT * WHERE interest_id = $1, with optional AND for status. ORDER BY created_at DESC.

`findDuplicateCuriosityThread`: SELECT * WHERE interest_id = $1 AND LOWER(question) = LOWER($2) AND status != 'resolved'. Return first row or `null`. This enables AC3.5 (duplicate detection — matches on case-insensitive question text within the same interest, excluding resolved threads).

`logExploration`: INSERT with `randomUUID()`, tools_used as JSONB. RETURNING *.

`listExplorationLog`: SELECT * WHERE owner = $1 ORDER BY created_at DESC LIMIT $2 (default 20).

`applyEngagementDecay`: Use the half-life formula. For each active interest owned by the given owner, compute the new score as `engagement_score * pow(0.5, EXTRACT(EPOCH FROM (NOW() - last_engaged_at)) / (half_life_days * 86400))`. Use a single UPDATE statement:
```sql
UPDATE interests
SET engagement_score = engagement_score * pow(0.5, EXTRACT(EPOCH FROM (NOW() - last_engaged_at)) / ($1 * 86400))
WHERE owner = $2 AND status = 'active'
RETURNING id
```
Return the count of updated rows.

`enforceActiveInterestCap`: Query active interests for the owner ordered by `engagement_score ASC`. If count > `maxActive`, update the excess (lowest-scoring) to `status = 'dormant'`. Return the list of interests that were made dormant.

```sql
-- Step 1: count active
SELECT COUNT(*) as count FROM interests WHERE owner = $1 AND status = 'active'

-- Step 2: if count > maxActive, dormant-ify the lowest
UPDATE interests
SET status = 'dormant'
WHERE id IN (
  SELECT id FROM interests
  WHERE owner = $1 AND status = 'active'
  ORDER BY engagement_score ASC
  LIMIT $2
)
RETURNING *
```
Where $2 = count - maxActive.

`bumpEngagement`: Update engagement_score by adding `amount`, and set `last_engaged_at = NOW()`. RETURNING *.

**After creating persistence.ts**, update `src/subconscious/index.ts`:
- Uncomment the `createInterestRegistry` export line
- Add it as: `export { createInterestRegistry } from './persistence.ts';`

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add PostgreSQL interest registry adapter`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Interest registry tests — CRUD and state transitions

**Verifies:** subconscious.AC3.1, subconscious.AC3.2

**Files:**
- Create: `src/subconscious/persistence.test.ts`

**Implementation:**

Follow the exact test structure from `src/reflexion/prediction-store.test.ts`:
- Import `describe, it, expect, beforeAll, afterEach, afterAll` from `bun:test`
- Import `createPostgresProvider` from `../persistence/postgres.ts`
- Import `createInterestRegistry` from `./persistence.ts`
- Use `DB_CONNECTION_STRING = 'postgresql://constellation:constellation@localhost:5432/constellation'`
- Use random `TEST_OWNER` pattern: `'test-user-' + Math.random().toString(36).substring(7)`
- `beforeAll`: connect, runMigrations, cleanup
- `afterEach`: cleanup (TRUNCATE exploration_log, curiosity_threads, interests CASCADE — in that order due to FKs)
- `afterAll`: disconnect

**Testing:**

Tests must verify AC cases:

**subconscious.AC3.1:** Interests can be created with name, description, source, and engagement score
- `describe('subconscious.AC3.1: Create interest with all fields')` — create an interest, verify all fields are returned correctly including id, createdAt, lastEngagedAt. Verify default engagement_score of 1.0. Verify getInterest retrieves it. Verify listInterests returns it filtered by owner. Test all three source values ('emergent', 'seeded', 'external').

**subconscious.AC3.2:** Curiosity threads can be created, explored, resolved, or parked within an interest
- `describe('subconscious.AC3.2: Curiosity thread state transitions')` — create an interest, then create a curiosity thread within it. Verify thread fields. Update status through transitions: open → exploring → resolved (with resolution text). Create another thread and transition: open → parked. Verify listCuriosityThreads returns threads filtered by status. Verify getCuriosityThread retrieves by id.

Also test:
- `updateInterest` — update name, description, status. Verify lastEngagedAt updates.
- `logExploration` and `listExplorationLog` — create entries, verify ordering and limit.
- `bumpEngagement` — create interest, bump score, verify new score and lastEngagedAt.
- Owner isolation — interests from owner A are not visible to owner B via listInterests.

**Verification:**
Run: `bun test src/subconscious/persistence.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add interest registry CRUD and state transition tests`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Interest registry tests — decay, cap enforcement, duplicate detection

**Verifies:** subconscious.AC3.3, subconscious.AC3.4, subconscious.AC3.5

**Files:**
- Modify: `src/subconscious/persistence.test.ts` (add new describe blocks)

**Testing:**

**subconscious.AC3.3:** Engagement scores decay over time with configurable half-life
- `describe('subconscious.AC3.3: Engagement score decay')` — Create interests with known engagement scores. Manually backdate `last_engaged_at` using `persistence.query('UPDATE interests SET last_engaged_at = $1 WHERE id = $2', ...)` (same pattern as prediction-store.test.ts backdating created_at). Apply decay with a specific half-life. Verify scores decreased proportionally to time since last engagement. An interest engaged recently should barely decay; one engaged long ago should decay significantly.

**subconscious.AC3.4:** Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached
- `describe('subconscious.AC3.4: Active interest cap enforcement')` — Create multiple active interests with varying engagement scores (e.g., 5 interests with scores 1.0, 2.0, 3.0, 4.0, 5.0). Call `enforceActiveInterestCap(owner, 3)`. Verify the two lowest-scoring interests (1.0 and 2.0) are now dormant. Verify the three highest remain active. Call again with same cap — verify no additional changes (idempotent when already at cap).

**subconscious.AC3.5:** Duplicate curiosity threads (same question within same interest) are detected and the existing thread is resumed instead
- `describe('subconscious.AC3.5: Duplicate curiosity thread detection')` — Create an interest. Create a curiosity thread with question "How does X work?". Call `findDuplicateCuriosityThread` with the same question — verify it returns the existing thread. Test case-insensitivity: call with "how does x work?" — should still find the duplicate. Test that a resolved thread is NOT returned as a duplicate (create thread, resolve it, search again — should return null). Test that a thread with a different question returns null.

**Verification:**
Run: `bun test src/subconscious/persistence.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add decay, cap enforcement, and duplicate detection tests`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->
