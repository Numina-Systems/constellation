# Orchestration

Last verified: 2026-09-28

## Purpose
Runtime orchestration between the composition root and the domain modules: serialized event-queue draining, scheduler onDue handlers (review, agent-scheduled, sleep tasks, subconscious impulse/introspection, archivist), sleep/wake transitions, and idempotent registration of the default scheduled tasks. Extracted from `src/index.ts` (issue #50) so this behavior is unit-testable with injected dependencies.

## Contracts
- **Exposes**: `EventDrain` port with `createEventDrain`/`processEventQueue` (bounded queue + single-flight drain), `buildReviewEvent`/`buildAgentScheduledEvent` (trace-enriched scheduled events), handler factories `createSystemTaskHandler`, `createAgentTaskHandler`, `createSleepTaskHandler`, `createPostImpulseHousekeeping`, `createActivityAwareSystemHandler`, `createTransitionHandler`, the `registerSchedulerHandlers` wiring function, default-task registrars `registerPreStartSystemTasks`/`registerPostStartSystemTasks`, and `SUPPRESS_DURING_SLEEP`
- **Guarantees**:
  - At most one drain loop runs per queue; concurrent `drain()` calls coalesce and the in-flight flag resets in a finally block
  - Per-event errors are logged and never abort a drain; handlers are fire-and-forget (`void`) and never throw into the scheduler tick — every handler IIFE has a `.catch`
  - Activity-aware routing order is fixed: sleep task → subconscious-impulse → subconscious-introspection → archivist-incremental → fallback to the system handler
  - Task registration is idempotent per owner+name and preserves the exact pre-start (review, impulse, introspection) versus post-start (archivist before activity) split
- **Expects**: Fully constructed dependencies from the composition root (agents, `TraceStore`, `PredictionStore`, `InterestRegistry`, assemblers, continuation budget/judge, `ActivityManager`, schedulers, `PersistenceProvider`). Optional deps mirror the opt-in configurations and may be absent; factories validate required fields at the boundary.

## Dependencies
- **Uses**: `src/activity/` (dispatch, wake handler, sleep-event builders, schedule utilities), `src/subconscious/` (assemblers, continuation budget/judge/loop, crons), `src/reflexion/` (TraceStore, PredictionStore, review gate), `src/archivist/` (ArchivistPipeline), `src/scheduler/` (Scheduler port), `src/persistence/` (PersistenceProvider for registration queries), `src/extensions/bluesky/` (EventQueue), `src/scheduled-context.ts` (formatTraceSummary)
- **Used by**: `src/index.ts` (composition root — constructs every dependency, calls `registerSchedulerHandlers` and the two registrars)
- **Boundary**: This module is the integration layer the scheduler, activity, and subconscious domains are wired into. It may import those domains; none of them import it. `src/index.ts` is the only importer.

## Key Decisions
- One `SchedulerHandlerDeps` type mirrors the closures these handlers previously captured in `main()`, so the extraction stayed verbatim; each factory validates its own required subset at the boundary
- `ensureScheduledTask` replaced five verbatim copies of the query-or-schedule pattern (rule of three); call sites keep their exact log lines
- Registration asymmetry is intentional: only the system scheduler's activity dispatch suppresses `SUPPRESS_DURING_SLEEP` tasks during sleep; the agent scheduler's dispatch queues them for the wake drain
- The system handler's IIFE `.catch` (`system scheduler onDue error:`) is the only behavior change of the extraction — previously a trace-query or processEvent failure surfaced an unhandled rejection, which Bun treats as fatal

## Invariants
- Handler registration completes before `scheduler.start()`; activity and archivist tasks register after start, archivist before activity
- `SUPPRESS_DURING_SLEEP` is exactly `review-predictions`, `subconscious-impulse`, `subconscious-introspection`
- `continuationBudget.resetEvent()` runs before each review/impulse round and `resetCycle()` on wake; wake trickle delay (5000 ms) and queue capacities (50 external, 10 scheduler) are set by the composition root
- Routing order, log-line formats, task crons, and payloads match the pre-extraction composition root; the unit tests pin them

## Key Files
- `types.ts` -- EventDrain, SchedulerTask/handler types, handler deps types
- `event-drain.ts` -- processEventQueue + createEventDrain (single-flight)
- `scheduled-event-builders.ts` -- buildReviewEvent, buildAgentScheduledEvent
- `scheduler-handlers.ts` -- onDue handler factories, transitions, registration wiring, SUPPRESS_DURING_SLEEP
- `task-registration.ts` -- ensureScheduledTask + pre/post-start default task registrars
- `index.ts` -- Barrel exports
