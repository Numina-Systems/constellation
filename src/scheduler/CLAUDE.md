# Scheduler

Last verified: 2026-09-28

## Purpose
Implements the `Scheduler` extension interface with PostgreSQL-backed cron scheduling. Polls for due tasks on a 60-second interval and dispatches them via a registered handler.

## Contracts
- **Exposes**: `PostgresScheduler` (Scheduler + start/stop lifecycle), `createPostgresScheduler(persistence, owner, options?)` with `PostgresSchedulerOptions` (`pollOffsetMs`, default 0; `pollIntervalMs`, default 60000)
- **Guarantees**:
  - Tasks are polled every 60 seconds by default when started; the first poll can be delayed via `pollOffsetMs` and the cadence via `pollIntervalMs`
  - `schedule()` returns `{ id, nextRunAt }` for caller confirmation
  - Cron expressions are validated on schedule; invalid expressions (or ones with no future occurrence) throw typed `ConstellationError` with code `INVALID_CRON_EXPRESSION` (subsystem `scheduler`)
  - The registered handler is awaited before `last_run_at`/`next_run_at` advance (or the task is cancelled if no future occurrence exists), so a crash mid-handler leaves the task eligible to re-fire. An in-flight guard skips a task still executing from a previous poll, preventing duplicate execution on overlapping ticks
  - Per-task errors are caught and logged (typed-error aware: code, subsystem, context) and never kill the tick; one failing task does not block others
- **Expects**: `PersistenceProvider` with migrations 004+005 applied (`scheduled_tasks` table with owner isolation). Owner string for multi-agent isolation.

## Dependencies
- **Uses**: `src/persistence/` (query interface), `src/extensions/scheduler.ts` (Scheduler, ScheduledTask port interfaces), `croner` (cron parsing)
- **Used by**: `src/index.ts` (composition root constructs dual instances: agent-owned + system-owned), `src/orchestration/` (onDue handlers dispatch to `buildReviewEvent` or `buildAgentScheduledEvent` based on task name, both enriched with recent operation traces; default task registration), `src/tool/builtin/scheduling.ts` (agent scheduling tools)
- **Boundary**: The scheduler dispatches tasks but does not process them. Event handling is the caller's responsibility.

## Key Decisions
- Polling over pg_notify: Simpler, no persistent connection requirement. 60-second granularity is sufficient for cron tasks
- Owner-scoped: Each scheduler instance only sees tasks for its owner. Composition root runs two instances (`agent` + `system`) for isolation -- agent scheduling tools cannot see or modify system jobs. The composition root staggers their first polls via `pollOffsetMs` (0 ms agent, 15000 ms system) so their ticks do not collide

## Invariants
- `next_run_at` is always set when a task is active (not cancelled)
- Cancelled tasks are never polled or dispatched
- `last_run_at` updates atomically with `next_run_at` advancement

## Key Files
- `types.ts` -- Re-exports Scheduler/ScheduledTask from extensions, defines SchedulerRow
- `postgres-scheduler.ts` -- PostgresScheduler implementation with start/stop lifecycle
- `index.ts` -- Barrel exports
