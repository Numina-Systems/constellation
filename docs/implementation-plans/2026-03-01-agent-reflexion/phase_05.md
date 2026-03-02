# Agent Reflexion Implementation Plan

**Goal:** Implement a PostgreSQL-backed scheduler with cron-based task scheduling, cancellation, and missed-tick recovery.

**Architecture:** Factory function `createPostgresScheduler` implementing the existing `Scheduler` interface from `src/extensions/scheduler.ts`. 60-second `setInterval` tick loop, croner for cron parsing, `next_run_at` DB column for due detection, `last_run_at` for missed-tick recovery.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), PostgreSQL 17, croner, bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC4: Scheduler
- **agent-reflexion.AC4.1 Success:** Tasks can be scheduled with a cron expression and persist across restarts
- **agent-reflexion.AC4.2 Success:** Scheduler fires `onDue` handler when a task's `next_run_at` passes
- **agent-reflexion.AC4.3 Success:** `next_run_at` is recomputed from the cron expression after each execution
- **agent-reflexion.AC4.4 Success:** Tasks can be cancelled by ID
- **agent-reflexion.AC4.5 Edge:** Missed ticks (e.g., daemon was down) are detected and fired on next startup based on `last_run_at`

---

## Phase 5: Scheduler Implementation

**Goal:** Concrete DB-backed scheduler implementing the existing `Scheduler` extension interface with cron-based due detection and missed-tick recovery.

**Patterns to follow:** `src/memory/postgres-store.ts` — factory function returning interface, `randomUUID()` for IDs, row parser converting snake_case DB columns to camelCase, `RETURNING *` pattern. Lifecycle pattern from `src/extensions/bluesky/source.ts` — `start()` and `stop()` methods for interval management.

**CLAUDE.md files to read before implementation:**
- `src/persistence/CLAUDE.md` — PersistenceProvider contracts and query patterns
- `src/extensions/CLAUDE.md` — Extension interface contracts (Scheduler)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Implement PostgreSQL scheduler adapter

**Verifies:** agent-reflexion.AC4.1, agent-reflexion.AC4.2, agent-reflexion.AC4.3, agent-reflexion.AC4.4, agent-reflexion.AC4.5

**Files:**
- Create: `src/scheduler/postgres-scheduler.ts`

**Implementation:**

Create `createPostgresScheduler(persistence, owner)` returning an extended `Scheduler` interface with `start()` and `stop()` lifecycle methods. The file must be `// pattern: Imperative Shell` (database I/O + timer side effects).

Install dependency: `bun add croner`

Factory signature:

```typescript
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { Scheduler, ScheduledTask } from './types.ts';
import type { SchedulerRow } from './types.ts';

type PostgresScheduler = Scheduler & {
  start(): void;
  stop(): void;
};

export function createPostgresScheduler(
  persistence: PersistenceProvider,
  owner: string,
): PostgresScheduler
```

Row parser:

```typescript
function parseScheduledTask(row: SchedulerRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    payload: row.payload,
  };
}
```

**`schedule` method (AC4.1):**
- Generates UUID via `randomUUID()`
- Computes `next_run_at` from the cron expression using `new Cron(task.schedule).nextRun()` — returns a `Date | null`. If null (invalid or no future occurrence), throw an error.
- INSERTs into `scheduled_tasks` with owner, name, schedule, payload, next_run_at
- Uses `RETURNING *` pattern but return value is not needed (interface returns `Promise<void>`)

**`cancel` method (AC4.4):**
- UPDATE `scheduled_tasks` SET `cancelled = TRUE` WHERE `id = $1` AND `owner = $2`
- Return void (interface contract). If no rows affected, silently succeed (idempotent).

**`onDue` method (AC4.2):**
- Stores the handler function in a closure variable. Only one handler is supported (last-writer-wins per the interface contract).

**`start` method (AC4.2, AC4.3, AC4.5):**
- On first call, immediately runs `tick()` (catches missed ticks from downtime — AC4.5)
- Sets up a 60-second `setInterval` calling `tick()`
- The `tick` function:
  1. SELECT all rows WHERE `owner = $1` AND `cancelled = FALSE` AND `next_run_at <= NOW()` ORDER BY `next_run_at ASC`
  2. For each due task:
     a. Invoke the `onDue` handler synchronously (handler is `(task: ScheduledTask) => void`)
     b. Compute the next run time: `new Cron(row.schedule).nextRun()` — the next occurrence after now
     c. UPDATE the row: SET `last_run_at = NOW()`, `next_run_at = $nextRun` WHERE `id = $1`
     d. If `nextRun` is null (cron has no future occurrence), set `cancelled = TRUE` as well
  3. All DB operations in tick should be wrapped in try/catch with `console.warn` on failure (don't crash the interval)

**`stop` method:**
- Calls `clearInterval` on the stored interval ID
- Sets interval ID to null

**Missed-tick recovery (AC4.5):**
- The first `tick()` call on `start()` picks up any tasks where `next_run_at <= NOW()` — these are tasks that were due while the daemon was down. The query naturally handles this since it selects all past-due tasks.

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(scheduler): implement PostgreSQL-backed scheduler with croner`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create barrel export

**Files:**
- Create: `src/scheduler/index.ts`

**Implementation:**

```typescript
// pattern: Functional Core (barrel export)

export type { Scheduler, ScheduledTask, SchedulerRow } from './types.ts';
export { createPostgresScheduler } from './postgres-scheduler.ts';
```

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(scheduler): add barrel export`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for PostgreSQL scheduler

**Verifies:** agent-reflexion.AC4.1, agent-reflexion.AC4.2, agent-reflexion.AC4.3, agent-reflexion.AC4.4, agent-reflexion.AC4.5

**Files:**
- Create: `src/scheduler/postgres-scheduler.test.ts`

**Testing:**

Integration tests requiring a running PostgreSQL instance, following the exact pattern from `src/memory/manager.test.ts`:
- Real PostgreSQL connection to `postgresql://constellation:constellation@localhost:5432/constellation`
- `beforeAll`: connect, run migrations, truncate
- `afterEach`: truncate `scheduled_tasks` table, call `scheduler.stop()` to clear any running intervals
- `afterAll`: disconnect
- Random `TEST_OWNER` per test run via `randomUUID()`

**Important:** Since the scheduler uses `setInterval` with 60-second ticks, tests should NOT rely on the interval. Instead, tests should:
1. Call `scheduler.schedule(task)` to insert the task
2. Directly verify DB state for persistence tests (AC4.1)
3. For due-detection tests (AC4.2, AC4.3), manually backdate `next_run_at` in the DB to the past, then call `scheduler.start()` which runs an immediate tick
4. Use a short wait (e.g., `await Bun.sleep(100)`) after `start()` to let the async tick complete
5. Stop the scheduler after each test to prevent leaked timers

Tests must verify:

- **agent-reflexion.AC4.1:** Schedule a task with a cron expression. Verify the `scheduled_tasks` row exists in the DB with correct owner, name, schedule, payload, and a computed `next_run_at` in the future. Stop and recreate the scheduler — verify the task is still there (persists across restarts).

- **agent-reflexion.AC4.2:** Schedule a task, manually UPDATE its `next_run_at` to the past. Register an `onDue` handler that captures invocations. Call `start()`. Verify the handler is called with the correct `ScheduledTask` shape (id, name, schedule, payload).

- **agent-reflexion.AC4.3:** After a due task fires (per AC4.2 test setup), verify the DB row's `next_run_at` has been recomputed to a future time (greater than the current time) and `last_run_at` is set.

- **agent-reflexion.AC4.4:** Schedule a task, then cancel it by ID. Verify the DB row has `cancelled = TRUE`. Backdate `next_run_at` to the past, register an `onDue` handler, call `start()`. Verify the handler is NOT called for the cancelled task.

- **agent-reflexion.AC4.5:** Schedule a task, manually UPDATE `next_run_at` to a time in the past and `last_run_at` to an even earlier time (simulating daemon downtime). Register an `onDue` handler. Call `start()` (which runs immediate tick). Verify the handler fires for the missed task, and `last_run_at` is updated.

**Verification:**

Run: `bun test src/scheduler/postgres-scheduler.test.ts`
Expected: All tests pass (requires running PostgreSQL)

Run: `bun run build`
Expected: No type errors

**Commit:** `test(scheduler): add PostgreSQL scheduler integration tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
