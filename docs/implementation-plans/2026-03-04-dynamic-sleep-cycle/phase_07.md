# Dynamic Sleep Cycle Implementation Plan — Phase 7

**Goal:** Wire all activity components together in `src/index.ts` with startup reconciliation.

**Architecture:** Conditional composition — when `config.activity?.enabled`, create the activity manager, register transition and sleep tasks, wrap scheduler and Bluesky handlers with activity-aware dispatch, register the context provider, and set up the wake handler. When disabled or absent, no activity components are created, preserving existing behaviour exactly.

**Tech Stack:** TypeScript 5.7+, Croner 10.0.1

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC1: Activity mode transitions on schedule
- **sleep-cycle.AC1.3 Edge:** Cold start during sleep window reconciles to sleeping mode from cron expressions
- **sleep-cycle.AC1.4 Edge:** Cold start during active window reconciles to active mode

### sleep-cycle.AC7: Startup reconciliation
- **sleep-cycle.AC7.1 Success:** Restart mid-sleep resumes sleeping mode without re-registering transition tasks
- **sleep-cycle.AC7.2 Success:** Restart mid-active resumes active mode
- **sleep-cycle.AC7.3 Edge:** First-ever startup with no DB state initialises from cron expressions

### sleep-cycle.AC8: Opt-in and backward compatibility
- **sleep-cycle.AC8.1 Success:** Absent `[activity]` config results in no activity manager, no context injection, normal scheduler dispatch
- **sleep-cycle.AC8.2 Success:** `enabled = false` has same effect as absent config
- **sleep-cycle.AC8.3 Success:** Existing scheduled tasks (prediction review) continue to work when activity is disabled

---

<!-- START_TASK_1 -->
### Task 1: Wire activity manager and startup reconciliation in composition root

**Verifies:** sleep-cycle.AC1.3, sleep-cycle.AC1.4, sleep-cycle.AC7.1, sleep-cycle.AC7.2, sleep-cycle.AC7.3, sleep-cycle.AC8.1, sleep-cycle.AC8.2

**Files:**
- Modify: `src/index.ts` (two insertion points: before agent creation, and between handler registration and scheduler start)

**Implementation:**

**CRITICAL ORDERING:** The composition root in `src/index.ts` creates agents at line 650 using `[...contextProviders, ...]` — a spread copy. Any context providers pushed AFTER this line are silently lost. The activity wiring must therefore be split into two sections:

**Section A** — Before agent creation (insert before line 650, after `contextProviders` array is defined at line 382 and before `createAgent()` at line 624):

**Section B** — Between handler registration and scheduler start (insert between lines 781 and 801, replacing the existing `onDue` registrations when activity is enabled).

Add imports at the top of `src/index.ts`:
```typescript
import {
  createActivityManager,
  createActivityContextProvider,
  createActivityDispatch,
  createBlueskyInterceptor,
  createWakeHandler,
  currentMode,
  sleepTaskCron,
  isSleepTask,
  queuedEventToExternal,
  buildCompactionEvent,
  buildPredictionReviewEvent,
  buildPatternAnalysisEvent,
} from './activity/index.ts';
import type { ActivityManager, ScheduleConfig } from './activity/index.ts';
```

**Section A** — Insert BEFORE agent creation (before `const agent = createAgent({` at line 624). This ensures the context provider is in the `contextProviders` array before the spread copy:

```typescript
// --- Activity Manager (opt-in) ---
let activityManager: ActivityManager | null = null;
let activityScheduleConfig: ScheduleConfig | null = null;

if (config.activity?.enabled) {
  const activityConfig = config.activity;

  // Guard: narrow optional fields to non-null (Zod superRefine guarantees presence when enabled)
  if (!activityConfig.timezone || !activityConfig.sleep_schedule || !activityConfig.wake_schedule) {
    throw new Error('activity config validation failed: missing required fields despite enabled=true');
  }

  activityScheduleConfig = {
    sleepSchedule: activityConfig.sleep_schedule,
    wakeSchedule: activityConfig.wake_schedule,
    timezone: activityConfig.timezone,
  };

  // 1. Create activity manager
  activityManager = createActivityManager(persistence, activityScheduleConfig, AGENT_OWNER);

  // 2. Startup reconciliation: compute current mode from cron expressions
  const expectedMode = currentMode(activityScheduleConfig);
  await activityManager.transitionTo(expectedMode);
  const state = await activityManager.getState();
  console.log(`activity manager started (mode: ${state.mode}, next transition: ${state.nextTransitionAt?.toISOString() ?? 'unknown'})`);

  // 3. Register context provider BEFORE agent creation
  const activityContextProvider = createActivityContextProvider(activityManager);
  contextProviders.push(activityContextProvider);
}
```

**Section B** — Replace the existing `onDue` registrations (lines 744-781) with activity-aware versions when enabled. Extract the original handler logic into named functions to avoid duplication:

```typescript
// --- Scheduler onDue handlers ---
// Extract handler logic into named functions for reuse
function handleSystemSchedulerTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
  (async () => {
    try {
      const expiredCount = await predictionStore.expireStalePredictions(
        AGENT_OWNER,
        new Date(Date.now() - 24 * 3600_000),
      );
      if (expiredCount > 0) {
        console.log(`review job: expired ${expiredCount} stale predictions`);
      }
    } catch (error) {
      console.warn('review job: failed to expire stale predictions', error);
    }

    const reviewEvent = buildReviewEvent(task);
    schedulerEventQueue.push(reviewEvent);
    processSchedulerEvent().catch((error) => {
      console.error('scheduler event processing error:', error);
    });
  })();
}

function handleAgentSchedulerTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
  (async () => {
    try {
      const event = buildAgentScheduledEvent(task);
      schedulerEventQueue.push(event);
      processSchedulerEvent().catch((error) => {
        console.error('agent scheduler event processing error:', error);
      });
    } catch (error) {
      console.error('agent scheduler onDue error:', error);
    }
  })();
}

if (activityManager) {
  // Capture narrowed reference for use in closures (avoids activityManager! assertions)
  const am = activityManager;

  // Sleep task handler: routes sleep tasks to the correct event builder with flagged events
  function handleSleepTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
    (async () => {
      const flaggedEvents = await am.getFlaggedEvents();
      let event;

      switch (task.name) {
        case 'sleep-compaction':
          event = buildCompactionEvent(flaggedEvents);
          break;
        case 'sleep-prediction-review':
          event = buildPredictionReviewEvent(flaggedEvents);
          break;
        case 'sleep-pattern-analysis':
          event = buildPatternAnalysisEvent(flaggedEvents);
          break;
        default:
          console.warn(`[activity] unknown sleep task: ${task.name}`);
          return;
      }

      schedulerEventQueue.push(event);
      processSchedulerEvent().catch((error) => {
        console.error(`sleep task event processing error (${task.name}):`, error);
      });
    })().catch((error) => {
      console.error(`[activity] sleep task error (${task.name}):`, error);
    });
  }

  // Activity-aware system handler: routes sleep tasks to handleSleepTask,
  // all other tasks to the original handler
  function handleSystemSchedulerTaskWithActivity(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
    if (isSleepTask(task.name)) {
      handleSleepTask(task);
    } else {
      handleSystemSchedulerTask(task);
    }
  }

  // Activity-aware dispatch: wraps original handlers
  const wakeHandler = createWakeHandler({
    activityManager: am,
    onEvent: async (event) => {
      const externalEvent = queuedEventToExternal(event);
      schedulerEventQueue.push(externalEvent);
      processSchedulerEvent().catch((error) => {
        console.error('wake drain event processing error:', error);
      });
    },
    trickleDelayMs: 5000,
  });

  const handleTransition = (task: { name: string }): void => {
    (async () => {
      if (task.name === 'transition-to-sleep') {
        await am.transitionTo('sleeping');
        console.log('[activity] transitioned to sleeping mode');
      } else if (task.name === 'transition-to-wake') {
        await wakeHandler();
      }
    })().catch((error) => {
      console.error('[activity] transition error:', error);
    });
  };

  // Register activity-aware handlers BEFORE scheduler.start()
  systemScheduler.onDue(createActivityDispatch({
    activityManager: am,
    originalHandler: handleSystemSchedulerTaskWithActivity,
    onTransition: handleTransition,
  }));

  agentScheduler.onDue(createActivityDispatch({
    activityManager: am,
    originalHandler: handleAgentSchedulerTask,
    onTransition: handleTransition,
  }));
} else {
  // No activity: register original handlers directly
  systemScheduler.onDue(handleSystemSchedulerTask);
  agentScheduler.onDue(handleAgentSchedulerTask);
}
```

**Note on sleep task routing:** `createActivityDispatch` (Phase 4) passes sleep tasks through to `originalHandler` (bypassing the activity gate). The `originalHandler` for the system scheduler is `handleSystemSchedulerTaskWithActivity`, which checks `isSleepTask(task.name)` and routes to `handleSleepTask` — which fetches flagged events and calls the correct builder (`buildCompactionEvent`, `buildPredictionReviewEvent`, `buildPatternAnalysisEvent`). Non-sleep system tasks fall through to `handleSystemSchedulerTask` (the original prediction review logic). Also import `isSleepTask` from the activity barrel — already included in the imports at the top of this task.

Then AFTER scheduler start (after line 804), register activity tasks:

```typescript
// --- Activity task registration (after schedulers started) ---
if (activityManager && activityScheduleConfig) {
  const { sleepSchedule, wakeSchedule, timezone } = activityScheduleConfig;

  const activityTasks = [
    { name: 'transition-to-sleep', schedule: sleepSchedule },
    { name: 'transition-to-wake', schedule: wakeSchedule },
    { name: 'sleep-compaction', schedule: sleepTaskCron(sleepSchedule, 2, timezone) },
    { name: 'sleep-prediction-review', schedule: sleepTaskCron(sleepSchedule, 4, timezone) },
    { name: 'sleep-pattern-analysis', schedule: sleepTaskCron(sleepSchedule, 6, timezone) },
  ];

  for (const task of activityTasks) {
    const existing = await persistence.query<{ id: string }>(
      `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
      ['system', task.name],
    );
    if (existing.length === 0) {
      await systemScheduler.schedule({
        id: crypto.randomUUID(),
        name: task.name,
        schedule: task.schedule,
        payload: { type: 'activity', sleepTask: true },
      });
      console.log(`[activity] registered task: ${task.name} (${task.schedule})`);
    }
  }

  console.log('[activity] all activity tasks registered');
}
```

**Key design decisions:**
- Activity manager and context provider are created BEFORE agent creation to ensure the spread copy in `createAgent()` includes the activity context provider
- Handler logic is extracted into named functions (`handleSystemSchedulerTask`, `handleAgentSchedulerTask`) — no duplication between activity-enabled and disabled code paths
- Activity-aware handlers are registered BEFORE `scheduler.start()` — no race window where tasks could fire with the wrong handler
- When activity is disabled, the same named functions are registered directly — identical behaviour to the original code
- The factory accepts `ScheduleConfig` (from Phase 2) directly — no non-null assertions on `ActivityConfig` fields

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat: wire activity manager in composition root with startup reconciliation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire Bluesky interceptor in composition root

**Verifies:** sleep-cycle.AC2.2

**Files:**
- Modify: `src/index.ts` (add Bluesky interceptor wrapping after Bluesky setup, inside the `activityManager` check)

**Implementation:**

After the Bluesky agent creation and `onMessage` registration (around line 710), add the activity-aware interceptor. This re-registers the onMessage handler with the interceptor wrapper when activity is enabled:

```typescript
// --- Activity-aware Bluesky handler (after Bluesky setup) ---
if (activityManager && blueskySource) {
  blueskySource.onMessage(createBlueskyInterceptor({
    activityManager,
    originalHandler: (message) => {
      eventQueue.push(message);
      processNextEvent().catch((error) => {
        console.error('bluesky event processing error:', error);
      });
    },
    highPriorityDids: config.bluesky.schedule_dids,
  }));
  console.log('[activity] bluesky handler wrapped with activity interceptor');
}
```

This overwrites the handler registered earlier, replacing it with the activity-aware interceptor. When active, the interceptor calls through to the original logic. When sleeping, it routes events to `activityManager.queueEvent()`. The `activityManager` variable is already set from Section A of Task 1.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat: wire Bluesky interceptor for activity-aware event routing`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update graceful shutdown for activity manager

**Verifies:** None (infrastructure — cleanup)

**Files:**
- Modify: `src/index.ts` (add activity logging to shutdown sequence)

**Implementation:**

The `activityManager` variable is available in the composition root scope (set in Section A of Task 1). Add activity state logging to the shutdown sequence (inside `createShutdownHandler` or in the SIGINT/SIGTERM handler). The activity manager has no lifecycle methods (no start/stop) — the scheduler handles stopping the polling that triggers activity tasks.

Add to the shutdown sequence:

```typescript
if (activityManager) {
  const finalState = await activityManager.getState();
  console.log(`[activity] shutdown state: ${finalState.mode}, queued: ${finalState.queuedEventCount}`);
}
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat: add activity state logging to graceful shutdown`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Composition root integration tests

**Verifies:** sleep-cycle.AC8.1, sleep-cycle.AC8.2, sleep-cycle.AC8.3

**Files:**
- This is verified by existing tests and build check

**Testing:**
These ACs are primarily verified by:
- sleep-cycle.AC8.1: No `[activity]` section in config → the conditional block is skipped entirely, all existing behaviour unchanged. Verified by running the existing test suite with no config changes.
- sleep-cycle.AC8.2: `enabled: false` → `config.activity?.enabled` is falsy, block skipped. Verified by config schema tests (Phase 1).
- sleep-cycle.AC8.3: When activity is disabled, scheduler handlers remain as they were. Verified by running existing scheduler-related tests.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing tests pass (backward compatibility)

**Commit:** No new commit — this is a verification checkpoint ensuring backward compatibility.
<!-- END_TASK_4 -->
