# Dynamic Sleep Cycle Implementation Plan — Phase 2

**Goal:** Implement the activity manager with state transitions, event queueing, and timezone-aware schedule logic.

**Architecture:** Port/adapter pattern following `src/scheduler/`: domain types in `types.ts`, pure schedule helpers in `schedule.ts` (Functional Core), PostgreSQL adapter in `postgres-activity-manager.ts` (Imperative Shell), barrel export in `index.ts`. Factory function `createActivityManager(persistence, config, owner)` returns the `ActivityManager` interface.

**Tech Stack:** TypeScript 5.7+, Croner 10.0.1, PostgreSQL 17, Zod

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC1: Activity mode transitions on schedule
- **sleep-cycle.AC1.1 Success:** Agent transitions to sleeping mode when `sleep_schedule` cron fires
- **sleep-cycle.AC1.2 Success:** Agent transitions to active mode when `wake_schedule` cron fires
- **sleep-cycle.AC1.3 Edge:** Cold start during sleep window reconciles to sleeping mode from cron expressions
- **sleep-cycle.AC1.4 Edge:** Cold start during active window reconciles to active mode

### sleep-cycle.AC2: Event queueing during sleep
- **sleep-cycle.AC2.1 Success:** Non-sleep scheduler tasks are written to `event_queue` during sleep mode
- **sleep-cycle.AC2.3 Success:** Events dispatch normally during active mode (no queueing)
- **sleep-cycle.AC2.4 Edge:** Queue handles events from multiple sources without ordering conflicts

### sleep-cycle.AC4: Soft bypass for high-priority events
- **sleep-cycle.AC4.1 Success:** High-priority events are flagged in the queue

### sleep-cycle.AC7: Startup reconciliation
- **sleep-cycle.AC7.1 Success:** Restart mid-sleep resumes sleeping mode without re-registering transition tasks
- **sleep-cycle.AC7.2 Success:** Restart mid-active resumes active mode
- **sleep-cycle.AC7.3 Edge:** First-ever startup with no DB state initialises from cron expressions

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create activity domain types

**Files:**
- Create: `src/activity/types.ts`

**Implementation:**

Create the domain types file following the pattern in `src/scheduler/types.ts`. Annotate with `// pattern: Functional Core`.

Define these types:

```typescript
// pattern: Functional Core

export type ActivityMode = 'active' | 'sleeping';

export type ActivityState = {
  readonly mode: ActivityMode;
  readonly transitionedAt: Date;
  readonly nextTransitionAt: Date | null;
  readonly queuedEventCount: number;
  readonly flaggedEventCount: number;
};

export type QueuedEvent = {
  readonly id: string;
  readonly source: string;
  readonly payload: unknown;
  readonly priority: 'normal' | 'high';
  readonly enqueuedAt: Date;
  readonly flagged: boolean;
};

export type NewQueuedEvent = {
  readonly source: string;
  readonly payload: unknown;
  readonly priority: 'normal' | 'high';
  readonly flagged: boolean;
};

export interface ActivityManager {
  getState(): Promise<ActivityState>;
  isActive(): Promise<boolean>;
  transitionTo(mode: ActivityMode): Promise<void>;
  queueEvent(event: NewQueuedEvent): Promise<void>;
  flagEvent(eventId: string): Promise<void>;
  drainQueue(): AsyncGenerator<QueuedEvent>;
  getFlaggedEvents(): Promise<ReadonlyArray<QueuedEvent>>;
}

export type ActivityStateRow = {
  readonly owner: string;
  readonly mode: string;
  readonly transitioned_at: Date;
  readonly next_transition_at: Date | null;
  readonly updated_at: Date;
};

export type EventQueueRow = {
  readonly id: string;
  readonly owner: string;
  readonly source: string;
  readonly payload: unknown;
  readonly priority: string;
  readonly flagged: boolean;
  readonly enqueued_at: Date;
  readonly processed_at: Date | null;
};
```

`NewQueuedEvent` omits `id` and `enqueuedAt` because those are generated server-side. `ActivityStateRow` and `EventQueueRow` are the database row types (snake_case, matching the SQL schema from Phase 1).

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add activity manager domain types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create pure schedule helpers

**Files:**
- Create: `src/activity/schedule.ts`

**Implementation:**

Create pure functions for timezone-aware cron schedule computation. Annotate with `// pattern: Functional Core`. These functions have zero side effects — they take inputs and return computed values.

Uses `Cron` from `croner` (already installed, v10.0.1). Key Croner API:
- `new Cron(expression, { timezone }).nextRun()` — next fire time as `Date`
- `new Cron(expression, { timezone }).previousRun()` — most recent fire time as `Date`

```typescript
// pattern: Functional Core

import { Cron } from 'croner';
import type { ActivityMode } from './types.ts';

export type ScheduleConfig = {
  readonly sleepSchedule: string;
  readonly wakeSchedule: string;
  readonly timezone: string;
};

/**
 * Determine the current activity mode based on which cron expression
 * fired most recently. If sleep fired after wake, we're sleeping.
 * If wake fired after sleep (or both are null), we're active.
 */
export function currentMode(config: Readonly<ScheduleConfig>): ActivityMode {
  const lastSleep = new Cron(config.sleepSchedule, { timezone: config.timezone }).previousRun();
  const lastWake = new Cron(config.wakeSchedule, { timezone: config.timezone }).previousRun();

  if (lastSleep === null) return 'active';
  if (lastWake === null) return 'sleeping';

  return lastSleep > lastWake ? 'sleeping' : 'active';
}

/**
 * Compute the next transition time: if currently sleeping, next wake time;
 * if currently active, next sleep time.
 */
export function nextTransitionTime(
  mode: ActivityMode,
  config: Readonly<ScheduleConfig>,
): Date | null {
  const schedule = mode === 'active' ? config.sleepSchedule : config.wakeSchedule;
  return new Cron(schedule, { timezone: config.timezone }).nextRun();
}

/**
 * Validate a cron expression. Returns null if valid, error message if invalid.
 */
export function validateCron(expression: string): string | null {
  try {
    new Cron(expression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression';
  }
}
```

**Testing:**
Tests for the pure schedule helpers verify:
- sleep-cycle.AC1.3: `currentMode()` returns `'sleeping'` when sleep cron fired more recently than wake
- sleep-cycle.AC1.4: `currentMode()` returns `'active'` when wake cron fired more recently than sleep
- `nextTransitionTime()` returns next wake time when sleeping, next sleep time when active
- `validateCron()` returns null for valid expressions, error message for invalid ones

Test file: `src/activity/schedule.test.ts`

Use deterministic cron patterns where the result is predictable (e.g., `0 22 * * *` for 10 PM sleep, `0 6 * * *` for 6 AM wake). The test can rely on the fact that at any given time, one of these will have fired more recently than the other.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/activity/schedule.test.ts`
Expected: All tests pass

**Commit:** `feat(activity): add pure schedule helpers with cron computation`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Create PostgreSQL activity manager adapter

**Files:**
- Create: `src/activity/postgres-activity-manager.ts`

**Implementation:**

Create the PostgreSQL adapter following `src/scheduler/postgres-scheduler.ts` pattern:
- Factory function `createActivityManager(persistence, config, owner)` returns `ActivityManager`
- The `config` parameter is `ScheduleConfig` (from `./schedule.ts`) — NOT `ActivityConfig` from the config schema. This avoids non-null assertions since `ScheduleConfig` has all fields required. The caller (composition root, Phase 7) creates the `ScheduleConfig` from the validated config.
- Close over dependencies in closure
- All queries parameterized with `$1, $2` placeholders
- All queries filter by `owner` for isolation
- Use `persistence.query<ActivityStateRow>()` and `persistence.query<EventQueueRow>()` for typed results
- Use `persistence.withTransaction()` for multi-step operations
- Annotate with `// pattern: Imperative Shell`

Import types from:
- `../persistence/types.ts` — `PersistenceProvider`
- `./types.ts` — `ActivityManager`, `ActivityState`, `QueuedEvent`, `NewQueuedEvent`, `ActivityStateRow`, `EventQueueRow`
- `./schedule.ts` — `currentMode`, `nextTransitionTime`, `ScheduleConfig`

Import `randomUUID` from `node:crypto` (same as postgres-scheduler.ts:4).

**Key implementation details:**

`getState()`:
1. Query `activity_state` for current owner
2. If no row exists, compute initial mode via `currentMode()`, insert row, return computed state
3. Count unprocessed events and flagged events from `event_queue`
4. Return `ActivityState` with mapped fields

`isActive()`:
1. Call `getState()`, return `state.mode === 'active'`

`transitionTo(mode)`:
1. Compute `nextTransitionAt` via `nextTransitionTime(mode, config)`
2. Upsert `activity_state`: `INSERT ... ON CONFLICT (owner) DO UPDATE SET mode = $2, transitioned_at = NOW(), next_transition_at = $3, updated_at = NOW()`

`queueEvent(event)`:
1. Generate UUID via `randomUUID()`
2. Insert into `event_queue` with owner, source, payload (as JSONB), priority, flagged

`flagEvent(eventId)`:
1. `UPDATE event_queue SET flagged = TRUE WHERE id = $1 AND owner = $2`

`drainQueue()`:
1. `async function*` generator
2. Loop: query for next unprocessed event ordered by priority DESC (high before normal), then `enqueued_at` ASC (FIFO within priority)
3. Mark as processed: `UPDATE event_queue SET processed_at = NOW() WHERE id = $1`
4. Yield the event
5. Break when no more unprocessed events

`getFlaggedEvents()`:
1. Query `event_queue` where `flagged = TRUE AND processed_at IS NULL AND owner = $1`
2. Return mapped array

The factory receives `ScheduleConfig` directly (all fields required, no optional properties). The composition root (Phase 7) creates the `ScheduleConfig` from the validated `ActivityConfig`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add PostgreSQL activity manager adapter`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create barrel export for activity module

**Files:**
- Create: `src/activity/index.ts`

**Implementation:**

Follow the pattern in `src/scheduler/index.ts`. Annotate with `// pattern: Functional Core (barrel export)`.

```typescript
// pattern: Functional Core (barrel export)

export type { ActivityManager, ActivityState, QueuedEvent, NewQueuedEvent, ActivityMode } from './types.ts';
export { createActivityManager } from './postgres-activity-manager.ts';
export { currentMode, nextTransitionTime, validateCron } from './schedule.ts';
export type { ScheduleConfig } from './schedule.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add barrel export for activity module`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Activity manager integration tests

**Verifies:** sleep-cycle.AC1.1, sleep-cycle.AC1.2, sleep-cycle.AC1.3, sleep-cycle.AC1.4, sleep-cycle.AC2.1, sleep-cycle.AC2.3, sleep-cycle.AC2.4, sleep-cycle.AC4.1, sleep-cycle.AC7.1, sleep-cycle.AC7.2, sleep-cycle.AC7.3

**Files:**
- Create: `src/activity/postgres-activity-manager.test.ts`

**Testing:**

This module does database I/O, so tests are integration tests against real PostgreSQL (following existing pattern in `src/memory/manager.test.ts` and `src/integration/mutations.test.ts`).

Connection string: `postgresql://constellation:constellation@localhost:5432/constellation`

Setup pattern:
```typescript
beforeAll(async () => {
  // Create PersistenceProvider, connect, run migrations
  // Create ActivityManager with test config and unique TEST_OWNER
});
afterEach(async () => {
  // TRUNCATE activity_state, event_queue WHERE owner = TEST_OWNER
});
afterAll(async () => {
  // Disconnect
});
```

Use a unique `TEST_OWNER` per test run: `'test-activity-' + Math.random().toString(36).substring(7)`

Tests must verify each AC listed above:

- sleep-cycle.AC1.1: Call `transitionTo('sleeping')`, then `getState()` returns `mode: 'sleeping'`
- sleep-cycle.AC1.2: Call `transitionTo('active')`, then `getState()` returns `mode: 'active'`
- sleep-cycle.AC1.3: Covered by schedule.test.ts (pure function `currentMode()`)
- sleep-cycle.AC1.4: Covered by schedule.test.ts (pure function `currentMode()`)
- sleep-cycle.AC2.1: Call `queueEvent()` with source and payload, then verify event exists in DB via `getFlaggedEvents()` or drain
- sleep-cycle.AC2.3: This is a behavioral contract verified at the scheduler integration level (Phase 4). Here we test that `isActive()` returns correct value after transitions.
- sleep-cycle.AC2.4: Queue events from multiple sources (`'scheduler'`, `'bluesky'`, `'manual'`), drain all, verify all returned in correct order
- sleep-cycle.AC4.1: Queue event with `flagged: true`, call `getFlaggedEvents()`, verify it appears. Queue event with `flagged: false`, verify it does not appear in flagged list.
- sleep-cycle.AC7.1: Insert a sleeping state row directly, create a new ActivityManager instance, call `getState()`, verify it returns sleeping without re-inserting
- sleep-cycle.AC7.2: Insert an active state row directly, create a new ActivityManager instance, verify active mode
- sleep-cycle.AC7.3: No state row exists, create ActivityManager, call `getState()` — should compute mode from cron and insert row

Also test `drainQueue()` ordering: queue events with mixed priorities, drain, verify high-priority events come before normal-priority, and FIFO within same priority.

Also test `flagEvent()`: queue a normal event, call `flagEvent(id)`, verify `getFlaggedEvents()` now includes it.

**Verification:**
Run: `bun test src/activity/postgres-activity-manager.test.ts`
Expected: All tests pass

**Commit:** `test(activity): add integration tests for activity manager`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
