# Dynamic Sleep Cycle Implementation Plan — Phase 4

**Goal:** Gate scheduler dispatch on activity state and register sleep/wake transition tasks.

**Architecture:** The activity dispatch gate wraps the existing `onDue` handlers in `src/index.ts`. When sleeping, non-sleep tasks are queued via `activityManager.queueEvent()` instead of being pushed to the `schedulerEventQueue`. Sleep-specific tasks (compaction, prediction review, pattern analysis) and transition tasks bypass the gate. New tasks are registered on startup via `systemScheduler.schedule()`.

**Tech Stack:** TypeScript 5.7+, Croner 10.0.1

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC1: Activity mode transitions on schedule
- **sleep-cycle.AC1.1 Success:** Agent transitions to sleeping mode when `sleep_schedule` cron fires
- **sleep-cycle.AC1.2 Success:** Agent transitions to active mode when `wake_schedule` cron fires

### sleep-cycle.AC2: Event queueing during sleep
- **sleep-cycle.AC2.1 Success:** Non-sleep scheduler tasks are written to `event_queue` during sleep mode
- **sleep-cycle.AC2.3 Success:** Events dispatch normally during active mode (no queueing)

### sleep-cycle.AC3: Sleep tasks run during sleep window
- **sleep-cycle.AC3.1 Success:** Compaction task fires at ~2h offset from sleep start
- **sleep-cycle.AC3.2 Success:** Prediction review task fires at ~4h offset from sleep start
- **sleep-cycle.AC3.3 Success:** Pattern analysis task fires at ~6h offset from sleep start
- **sleep-cycle.AC3.4 Success:** Sleep tasks dispatch even while activity state is sleeping
- **sleep-cycle.AC3.5 Edge:** Sleep tasks include flagged event summary in their context

### sleep-cycle.AC8: Opt-in and backward compatibility
- **sleep-cycle.AC8.3 Success:** Existing scheduled tasks (prediction review) continue to work when activity is disabled

---

<!-- START_TASK_1 -->
### Task 1: Create sleep task offset computation helper

**Verifies:** sleep-cycle.AC3.1, sleep-cycle.AC3.2, sleep-cycle.AC3.3

**Files:**
- Modify: `src/activity/schedule.ts` (add function)

**Implementation:**

Add a pure function to compute sleep task cron expressions from the sleep schedule with hour offsets. The approach: take the sleep schedule's next fire time, add the offset hours, then create a new daily cron expression from the resulting time.

```typescript
/**
 * Compute a cron expression that fires at a fixed offset after the sleep schedule.
 * E.g., if sleep is "0 22 * * *" (10 PM) and offset is 2, returns "0 0 * * *" (midnight).
 */
export function sleepTaskCron(sleepSchedule: string, offsetHours: number, timezone: string): string {
  const nextSleep = new Cron(sleepSchedule, { timezone }).nextRun();
  if (nextSleep === null) {
    throw new Error(`No future occurrence for sleep schedule: ${sleepSchedule}`);
  }

  const offsetMs = offsetHours * 3600_000;
  const taskTime = new Date(nextSleep.getTime() + offsetMs);

  // Extract hour and minute in the given timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(taskTime);

  const hour = parts.find(p => p.type === 'hour')?.value ?? '0';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '0';

  return `${minute} ${hour} * * *`;
}
```

Also add the list of sleep task names as a constant:

```typescript
export const SLEEP_TASK_NAMES = [
  'sleep-compaction',
  'sleep-prediction-review',
  'sleep-pattern-analysis',
] as const;

export const TRANSITION_TASK_NAMES = [
  'transition-to-sleep',
  'transition-to-wake',
] as const;

export function isSleepTask(taskName: string): boolean {
  return (SLEEP_TASK_NAMES as ReadonlyArray<string>).includes(taskName);
}

export function isTransitionTask(taskName: string): boolean {
  return (TRANSITION_TASK_NAMES as ReadonlyArray<string>).includes(taskName);
}
```

Update the barrel export in `src/activity/index.ts` to include the new exports.

**Testing:**
Tests for `sleepTaskCron`:
- Input `"0 22 * * *"` with offset 2 in `"America/Toronto"` → produces cron for midnight
- Input `"0 22 * * *"` with offset 4 → produces cron for 2 AM
- Input `"0 22 * * *"` with offset 6 → produces cron for 4 AM

Tests for `isSleepTask` and `isTransitionTask`:
- Returns true for each known sleep/transition task name
- Returns false for unrelated names like `'review-predictions'`

Add to existing `src/activity/schedule.test.ts`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/activity/schedule.test.ts`
Expected: All tests pass

**Commit:** `feat(activity): add sleep task offset computation and task name helpers`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create activity-aware dispatch wrapper

**Verifies:** sleep-cycle.AC2.1, sleep-cycle.AC2.3, sleep-cycle.AC3.4, sleep-cycle.AC3.5, sleep-cycle.AC8.3

**Files:**
- Create: `src/activity/dispatch.ts`

**Implementation:**

Create a dispatch wrapper that wraps an existing `onDue` handler with activity-aware logic. Annotate with `// pattern: Imperative Shell`.

```typescript
// pattern: Imperative Shell

import type { ActivityManager, NewQueuedEvent } from './types.ts';
import { isSleepTask, isTransitionTask } from './schedule.ts';

export type ScheduledTaskLike = {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
};

export type DispatchOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (task: ScheduledTaskLike) => void;
  readonly onTransition: (task: ScheduledTaskLike) => void;
};

export function createActivityDispatch(options: Readonly<DispatchOptions>): (task: ScheduledTaskLike) => void {
  const { activityManager, originalHandler, onTransition } = options;

  return (task: ScheduledTaskLike) => {
    (async () => {
      // Transition tasks always execute
      if (isTransitionTask(task.name)) {
        onTransition(task);
        return;
      }

      // Sleep tasks always execute (even during sleep)
      if (isSleepTask(task.name)) {
        originalHandler(task);
        return;
      }

      // Check activity state for everything else
      const isActive = await activityManager.isActive();

      if (isActive) {
        // Active mode: dispatch normally
        originalHandler(task);
      } else {
        // Sleeping: queue the event instead of dispatching
        const event: NewQueuedEvent = {
          source: `scheduler:${task.name}`,
          payload: task.payload,
          priority: 'normal',
          flagged: false,
        };
        await activityManager.queueEvent(event);
        console.log(`[activity] queued scheduler task "${task.name}" during sleep`);
      }
    })().catch((error) => {
      console.error(`[activity] dispatch error for task ${task.name}:`, error);
      // Fall through to original handler on error to avoid losing events
      originalHandler(task);
    });
  };
}
```

Export from barrel (`src/activity/index.ts`).

**Testing:**
Tests for `createActivityDispatch`:
- When active: original handler is called, activity manager `queueEvent` is NOT called
- When sleeping + normal task: `queueEvent` is called, original handler is NOT called
- When sleeping + sleep task (name in `SLEEP_TASK_NAMES`): original handler IS called
- When sleeping + transition task: `onTransition` IS called
- Error in `isActive()`: falls through to original handler

Test file: `src/activity/dispatch.test.ts`

Use mock `ActivityManager` (no DB needed) and mock handler functions to verify call patterns.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/activity/dispatch.test.ts`
Expected: All tests pass

**Commit:** `feat(activity): add activity-aware dispatch wrapper`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create sleep task event builders

**Verifies:** sleep-cycle.AC3.5

**Files:**
- Create: `src/activity/sleep-events.ts`

**Implementation:**

Create event builder functions for the three sleep tasks, following the pattern of `buildReviewEvent()` and `buildAgentScheduledEvent()` in `src/index.ts:106-168`. Annotate with `// pattern: Functional Core`.

Each builder returns an `ExternalEvent`-compatible object (`{ source, content, metadata, timestamp }`).

```typescript
// pattern: Functional Core

import type { QueuedEvent } from './types.ts';

type SleepTaskEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export function buildCompactionEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Context Compaction',
    '',
    'You are in sleep mode. Perform context compaction:',
    '- Use compact_context to consolidate recent conversation history',
    '- Archive important working memory to archival memory',
    '- Clean up temporary notes and observations',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'compaction', sleepTask: true },
    timestamp: new Date(),
  };
}

export function buildPredictionReviewEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Prediction Review',
    '',
    'You are in sleep mode. Review your predictions:',
    '- Use list_predictions to see pending predictions',
    '- Use self_introspect to review recent operation traces',
    '- Annotate each prediction with your assessment',
    '- Write a brief reflection to archival memory',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'prediction-review', sleepTask: true },
    timestamp: new Date(),
  };
}

export function buildPatternAnalysisEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Pattern Analysis',
    '',
    'You are in sleep mode. Analyze patterns from recent activity:',
    '- Use self_introspect to review your operation traces',
    '- Look for recurring patterns in your tool usage and responses',
    '- Identify areas where you could improve efficiency or accuracy',
    '- Write insights to archival memory for future reference',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'pattern-analysis', sleepTask: true },
    timestamp: new Date(),
  };
}

function appendFlaggedSummary(
  lines: Array<string>,
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): void {
  if (flaggedEvents.length === 0) return;

  lines.push('');
  lines.push(`[Flagged Events: ${flaggedEvents.length} high-priority items arrived during sleep]`);
  for (const event of flaggedEvents) {
    lines.push(`- [${event.source}] at ${event.enqueuedAt.toISOString()}`);
  }
  lines.push('Review these and decide if any require immediate action.');
}
```

Export from barrel (`src/activity/index.ts`).

**Testing:**
Tests for event builders:
- Each builder produces expected `source`, `metadata.taskType`, and content structure
- With zero flagged events: no `[Flagged Events]` section in content
- With flagged events: section appears with source and timestamp for each
- Content includes sleep task instructions

Test file: `src/activity/sleep-events.test.ts`

These are pure functions — unit tests with no mocks needed.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/activity/sleep-events.test.ts`
Expected: All tests pass

**Commit:** `feat(activity): add sleep task event builders with flagged event summaries`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify barrel exports and build

**Verifies:** None (verification checkpoint)

**Files:**
- Modify: `src/activity/index.ts` (ensure all new exports from Tasks 1-3 are included)

**Implementation:**

Update `src/activity/index.ts` to include all exports added in Tasks 1-3:

```typescript
export { createActivityDispatch } from './dispatch.ts';
export type { DispatchOptions, ScheduledTaskLike } from './dispatch.ts';
export { sleepTaskCron, isSleepTask, isTransitionTask, SLEEP_TASK_NAMES, TRANSITION_TASK_NAMES } from './schedule.ts';
export { buildCompactionEvent, buildPredictionReviewEvent, buildPatternAnalysisEvent } from './sleep-events.ts';
```

Run `bun run build` and `bun test` to verify the full module builds and all tests from Phases 1-4 pass.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `feat(activity): update barrel exports for dispatch, schedule helpers, and sleep events`
<!-- END_TASK_4 -->
