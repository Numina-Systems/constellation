# Scheduler

Last verified: 2026-03-03

## Purpose
Implements the `Scheduler` extension interface with PostgreSQL-backed cron scheduling. Polls for due tasks on a 60-second interval and dispatches them via a registered handler.

## Contracts
- **Exposes**: `PostgresScheduler` (Scheduler + start/stop lifecycle), `createPostgresScheduler(persistence, owner)`
- **Guarantees**:
  - Tasks are polled every 60 seconds when started
  - Cron expressions are validated on schedule; invalid expressions throw
  - After a task fires, `next_run_at` is advanced to the next occurrence (or task is cancelled if no future occurrence exists)
  - Per-task errors are caught and logged; one failing task does not block others
- **Expects**: `PersistenceProvider` with migration 004 applied (`scheduled_tasks` table). Owner string for multi-agent isolation.

## Dependencies
- **Uses**: `src/persistence/` (query interface), `src/extensions/scheduler.ts` (Scheduler, ScheduledTask port interfaces), `croner` (cron parsing)
- **Used by**: `src/index.ts` (composition root wires onDue handler; dispatches to `buildReviewEvent` or `buildAgentScheduledEvent` based on task name, both enriched with recent operation traces)
- **Boundary**: The scheduler dispatches tasks but does not process them. Event handling is the caller's responsibility.

## Key Decisions
- Polling over pg_notify: Simpler, no persistent connection requirement. 60-second granularity is sufficient for cron tasks
- Owner-scoped: Each scheduler instance only sees tasks for its owner

## Invariants
- `next_run_at` is always set when a task is active (not cancelled)
- Cancelled tasks are never polled or dispatched
- `last_run_at` updates atomically with `next_run_at` advancement

## Key Files
- `types.ts` -- Re-exports Scheduler/ScheduledTask from extensions, defines SchedulerRow
- `postgres-scheduler.ts` -- PostgresScheduler implementation with start/stop lifecycle
- `index.ts` -- Barrel exports
