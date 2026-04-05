# Activity

Last verified: 2026-03-07

## Purpose
Implements a circadian sleep/wake cycle for the agent. During sleep, external events are queued instead of dispatched, and the agent runs reflective tasks (compaction, prediction review, pattern analysis). On wake, queued events trickle-drain back into the agent loop.

## Contracts
- **Exposes**: `ActivityManager` port interface (`getState`, `isActive`, `transitionTo`, `queueEvent`, `flagEvent`, `drainQueue`, `getFlaggedEvents`), `createActivityManager(persistence, scheduleConfig, owner)`, `createActivityContextProvider(activityManager)`, `createActivityDispatch(options)`, `createActivityInterceptor(options)`, `createWakeHandler(options)`, schedule utilities (`currentMode`, `nextTransitionTime`, `validateCron`, `sleepTaskCron`, `isSleepTask`, `isTransitionTask`), sleep event builders (`buildCompactionEvent`, `buildPredictionReviewEvent`, `buildPatternAnalysisEvent`), `queuedEventToExternal`
- **Guarantees**: `drainQueue` yields events in priority order (high first, then FIFO). Transition tasks and sleep tasks always execute regardless of mode. Non-activity tasks are queued during sleep, dispatched during active. Activity interceptor wraps event handlers transparently and flags events matching a configurable `highPriorityFilter` predicate (generic event filter, not Bluesky-specific). Context provider caches state with 60s TTL. Dispatch falls through to original handler on error (never loses events).
- **Expects**: `PersistenceProvider` with migration 006 applied. Valid cron expressions in `ScheduleConfig`. Owner string for isolation.

## Dependencies
- **Uses**: `src/persistence/` (PersistenceProvider), `src/agent/types.ts` (ContextProvider), `croner` (cron parsing)
- **Used by**: `src/index.ts` (composition root wiring)
- **Boundary**: Activity module does not import from agent loop, scheduler, or extensions directly. Integration happens in the composition root.

## Key Decisions
- Cron-based mode derivation: `currentMode` compares last sleep/wake cron fires to determine state, so startup always reconciles to the correct mode
- Queue-and-drain over drop: Events during sleep are preserved, not discarded, and replayed on wake with trickle delay
- Owner isolation: All state and events are scoped by owner string, matching the scheduler's isolation pattern
- Interceptor/dispatch pattern: Wraps existing handlers transparently rather than requiring handler rewrites

## Invariants
- `activity_state` has exactly one row per owner (PRIMARY KEY constraint)
- `event_queue` priority is always `normal` or `high` (CHECK constraint)
- `activity_state` mode is always `active` or `sleeping` (CHECK constraint)
- Sleep tasks (`sleep-compaction`, `sleep-prediction-review`, `sleep-pattern-analysis`) always execute, even during sleep
- Transition tasks (`transition-to-sleep`, `transition-to-wake`) always execute, never queued
- Single daemon process per owner -- drainQueue and dispatch assume no concurrent consumers

## Key Files
- `types.ts` -- Domain types and `ActivityManager` port interface
- `postgres-activity-manager.ts` -- PostgreSQL adapter for ActivityManager
- `schedule.ts` -- Cron-based mode computation and schedule utilities (Functional Core)
- `dispatch.ts` -- Activity-aware task dispatch wrapper
- `context-provider.ts` -- Cached context provider for agent system prompt
- `wake.ts` -- Wake transition handler with trickle drain
- `activity-interceptor.ts` -- Generic activity-aware event handler wrapper with configurable priority filtering (used by DataSource registry)
- `sleep-events.ts` -- Sleep task event builders (Functional Core)
- `event-converter.ts` -- QueuedEvent to external event format (Functional Core)
