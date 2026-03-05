# Dynamic Sleep Cycle — Test Requirements

Maps every acceptance criterion from the [design plan](../../design-plans/2026-03-04-dynamic-sleep-cycle.md) to either an automated test or a documented human verification approach. Rationalized against implementation decisions made across Phases 1-7.

---

## Automated Tests

| AC ID | Description | Test Type | Test File | Notes |
|-------|-------------|-----------|-----------|-------|
| sleep-cycle.AC1.1 | Agent transitions to sleeping mode when `sleep_schedule` cron fires | Integration | `src/activity/postgres-activity-manager.test.ts` | Call `transitionTo('sleeping')`, assert `getState().mode === 'sleeping'`. The actual cron firing is the scheduler's responsibility; the activity manager's contract is tested in isolation. |
| sleep-cycle.AC1.2 | Agent transitions to active mode when `wake_schedule` cron fires | Integration | `src/activity/postgres-activity-manager.test.ts` | Call `transitionTo('active')`, assert `getState().mode === 'active'`. Same rationale as AC1.1. |
| sleep-cycle.AC1.3 | Cold start during sleep window reconciles to sleeping mode from cron expressions | Unit | `src/activity/schedule.test.ts` | Pure function `currentMode()` tested with cron pairs where sleep fired more recently than wake. No DB needed. |
| sleep-cycle.AC1.4 | Cold start during active window reconciles to active mode | Unit | `src/activity/schedule.test.ts` | Pure function `currentMode()` tested with cron pairs where wake fired more recently than sleep. |
| sleep-cycle.AC1.5 | Invalid cron expression in config rejected at startup with clear error | Unit | `src/config/schema.test.ts` | Zod `superRefine` validates cron via `new Cron(expression)`. Tests cover: invalid `sleep_schedule`, invalid `wake_schedule`, missing required fields when `enabled: true`. Error messages assert clarity. |
| sleep-cycle.AC2.1 | Non-sleep scheduler tasks are written to `event_queue` during sleep mode | Unit | `src/activity/dispatch.test.ts` | Mock `ActivityManager` with `isActive()` returning false. Assert `queueEvent()` called, original handler NOT called. |
| sleep-cycle.AC2.2 | Bluesky events are written to `event_queue` during sleep mode | Unit | `src/activity/bluesky-interceptor.test.ts` | Mock `ActivityManager` with `isActive()` returning false. Assert `queueEvent()` called with `source: 'bluesky:...'`, original handler NOT called. |
| sleep-cycle.AC2.3 | Events dispatch normally during active mode (no queueing) | Unit | `src/activity/dispatch.test.ts` | Mock `isActive()` returning true. Assert original handler IS called, `queueEvent()` NOT called. Also tested in `src/activity/bluesky-interceptor.test.ts` for the Bluesky path. |
| sleep-cycle.AC2.4 | Queue handles events from multiple sources without ordering conflicts | Integration | `src/activity/postgres-activity-manager.test.ts` | Queue events from `'scheduler'`, `'bluesky'`, `'manual'` sources. Drain all. Assert all returned in correct priority-then-FIFO order regardless of source. |
| sleep-cycle.AC3.1 | Compaction task fires at ~2h offset from sleep start | Unit | `src/activity/schedule.test.ts` | `sleepTaskCron("0 22 * * *", 2, "America/Toronto")` produces cron for midnight. Deterministic input/output on pure function. |
| sleep-cycle.AC3.2 | Prediction review task fires at ~4h offset from sleep start | Unit | `src/activity/schedule.test.ts` | `sleepTaskCron("0 22 * * *", 4, "America/Toronto")` produces cron for 2 AM. |
| sleep-cycle.AC3.3 | Pattern analysis task fires at ~6h offset from sleep start | Unit | `src/activity/schedule.test.ts` | `sleepTaskCron("0 22 * * *", 6, "America/Toronto")` produces cron for 4 AM. |
| sleep-cycle.AC3.4 | Sleep tasks dispatch even while activity state is sleeping | Unit | `src/activity/dispatch.test.ts` | Mock `isActive()` returning false, task name in `SLEEP_TASK_NAMES`. Assert original handler IS called (bypasses gate). |
| sleep-cycle.AC3.5 | Sleep tasks include flagged event summary in their context | Unit | `src/activity/sleep-events.test.ts` | Pass flagged `QueuedEvent` array to each builder (`buildCompactionEvent`, `buildPredictionReviewEvent`, `buildPatternAnalysisEvent`). Assert output content contains `[Flagged Events]` section with source and timestamp per event. Also assert absent when array is empty. |
| sleep-cycle.AC4.1 | High-priority events are flagged in the queue | Integration | `src/activity/postgres-activity-manager.test.ts` | Queue event with `flagged: true`, call `getFlaggedEvents()`, assert it appears. Queue with `flagged: false`, assert it does not. Also: call `flagEvent(id)` on a normal event, assert it then appears in `getFlaggedEvents()`. Bluesky path tested in `src/activity/bluesky-interceptor.test.ts` (high-priority DID triggers `flagged: true`). |
| sleep-cycle.AC4.2 | Flagged event count and summaries appear in context provider output during sleep tasks | Unit | `src/activity/context-provider.test.ts` | Mock `ActivityManager` in sleeping mode with flagged events. Assert provider output contains `[Flagged Events]` section with correct count, source, and timestamp per event. |
| sleep-cycle.AC4.3 | Flagged events are not auto-processed; agent sees them and decides | Unit | `src/activity/context-provider.test.ts` | Assert that the context provider output presents flagged events as informational text (source + timestamp), NOT as dispatched events. The context provider only reads `getFlaggedEvents()` — it never calls `drainQueue()` or processes them. Test verifies the output is descriptive, not actionable dispatch. Combined with AC3.5 tests in `src/activity/sleep-events.test.ts` which verify the same informational-only pattern in sleep task event builders. |
| sleep-cycle.AC4.4 | Zero flagged events produces clean context output (no empty section) | Unit | `src/activity/context-provider.test.ts` | Mock sleeping mode with zero flagged events. Assert output does NOT contain `[Flagged Events]` string. |
| sleep-cycle.AC5.1 | Wake transition processes due scheduled tasks before queued events | Unit | `src/activity/wake.test.ts` | Assert `transitionTo('active')` is called before any `onEvent` callback. Design note: scheduler polling handles due tasks independently; the wake handler's contract is state transition first, then queue drain. |
| sleep-cycle.AC5.2 | Queued events drain in priority order (high first, then normal, FIFO within) | Integration | `src/activity/postgres-activity-manager.test.ts` | Queue mixed-priority events, call `drainQueue()`, assert yield order: high-priority FIFO first, then normal-priority FIFO. The wake handler in `src/activity/wake.test.ts` verifies it preserves the generator's ordering via `onEvent` call sequence. |
| sleep-cycle.AC5.3 | Events trickle with delay between items (no burst) | Unit | `src/activity/wake.test.ts` | Set `trickleDelayMs` > 0, queue multiple events. Verify elapsed time between `onEvent` calls meets the delay threshold. Implementation plan suggests fake timers or wall-clock with generous margins. |
| sleep-cycle.AC5.4 | Empty queue on wake produces no errors and no unnecessary processing | Unit | `src/activity/wake.test.ts` | Mock `drainQueue()` yields nothing. Assert handler completes without error, `onEvent` never called, `transitionTo('active')` still called. |
| sleep-cycle.AC6.1 | Active mode injects status line with next sleep time | Unit | `src/activity/context-provider.test.ts` | Mock active mode. Assert output contains `[Activity] Status: active` and next sleep time ISO string. |
| sleep-cycle.AC6.2 | Sleep mode injects contemplative tone guidance, time, next wake, and queue stats | Unit | `src/activity/context-provider.test.ts` | Mock sleeping mode with queue counts. Assert output contains `[Activity] Status: sleeping`, `[Circadian Guidance]`, next wake time, queued/flagged counts. |
| sleep-cycle.AC6.3 | Sleep mode includes flagged event source and timestamp summaries | Unit | `src/activity/context-provider.test.ts` | Mock sleeping mode with flagged events. Assert output contains each event's source and `enqueuedAt` ISO string. Same data path as AC4.2. |
| sleep-cycle.AC6.4 | Context provider returns `undefined` when activity feature is disabled | Unit | `src/activity/context-provider.test.ts` | Create provider, verify first call returns `undefined` (cache empty before async refresh). The real guarantee is in the composition root: `createActivityContextProvider` is never called when `config.activity?.enabled` is falsy — no provider is pushed to `contextProviders`. Phase 7 Task 1 establishes this conditional. |
| sleep-cycle.AC7.1 | Restart mid-sleep resumes sleeping mode without re-registering transition tasks | Integration | `src/activity/postgres-activity-manager.test.ts` | Insert a sleeping state row directly, create a fresh `ActivityManager`, call `getState()`, assert sleeping mode without re-inserting. Phase 7 composition root checks for existing scheduled tasks before registering (SELECT before INSERT). |
| sleep-cycle.AC7.2 | Restart mid-active resumes active mode | Integration | `src/activity/postgres-activity-manager.test.ts` | Insert an active state row directly, create a fresh `ActivityManager`, assert active mode. |
| sleep-cycle.AC7.3 | First-ever startup with no DB state initialises from cron expressions | Integration | `src/activity/postgres-activity-manager.test.ts` | No state row exists. Create `ActivityManager`, call `getState()`. Assert mode is computed via `currentMode()` and row is inserted. |
| sleep-cycle.AC8.1 | Absent `[activity]` config results in no activity manager, no context injection, normal scheduler dispatch | Unit | `src/config/schema.test.ts` | Parse config with no `activity` field. Assert `result.activity` is `undefined`. Backward compatibility verified by full existing test suite passing unchanged. |
| sleep-cycle.AC8.2 | `enabled = false` has same effect as absent config | Unit | `src/config/schema.test.ts` | Parse config with `activity: { enabled: false }`. Assert it parses without error and `result.activity.enabled` is `false`. Composition root conditional (`config.activity?.enabled`) treats this identically to absent. |
| sleep-cycle.AC8.3 | Existing scheduled tasks (prediction review) continue to work when activity is disabled | Integration | Existing test suite (no new file) | When activity is disabled, the composition root registers original `onDue` handlers directly (unchanged code path). Verified by running `bun test` — all existing scheduler and prediction review tests pass. Phase 7 Task 4 is the explicit verification checkpoint. |

---

## Human Verification

| AC ID | Description | Justification | Verification Approach |
|-------|-------------|---------------|----------------------|
| sleep-cycle.AC5.1 | Wake transition processes due scheduled tasks before queued events | The "scheduled tasks first" guarantee depends on the scheduler's independent 60-second polling tick processing due tasks before/concurrently with the wake handler's queue drain. This is an emergent timing property of two independent async processes — not a strict ordering contract that can be unit-tested deterministically. | Manual verification: configure a sleep/wake cycle, let tasks accumulate during sleep alongside queued events. On wake, observe logs to confirm scheduler tick processes due tasks (e.g., `review-predictions`) and wake handler drains queue events. Verify no interleaving issues. Check timestamps in logs to confirm scheduling tasks appear before queued event drains. |
| sleep-cycle.AC8.1 | Full end-to-end: absent config preserves all existing behaviour | The automated test covers config parsing (unit). The full guarantee — that no activity manager is created, no context is injected, and scheduler dispatch is unchanged — spans the entire composition root. This is partially tested by the existing suite passing, but an explicit manual smoke test confirms no regressions in the integrated system. | Manual verification: start the daemon with no `[activity]` section in `config.toml`. Verify REPL works, scheduled tasks fire, Bluesky events process, context providers produce expected output with no activity-related content. Confirm no `[activity]` log lines appear. |
| sleep-cycle.AC8.3 | Existing scheduled tasks continue to work when activity is disabled | Same as AC8.1 — the automated test suite covers individual components, but the integrated end-to-end flow (scheduler fires task, handler processes it, agent responds) requires a running daemon to fully verify. | Manual verification: start daemon without `[activity]` config. Verify `review-predictions` task fires on its cron schedule and produces the expected prediction review event. Check logs for normal scheduler operation. |

---

## Test File Summary

| Test File | Type | Phase | ACs Covered |
|-----------|------|-------|-------------|
| `src/config/schema.test.ts` | Unit | 1 | AC1.5, AC8.1, AC8.2 |
| `src/activity/schedule.test.ts` | Unit | 2, 4 | AC1.3, AC1.4, AC3.1, AC3.2, AC3.3 |
| `src/activity/postgres-activity-manager.test.ts` | Integration | 2 | AC1.1, AC1.2, AC2.4, AC4.1, AC5.2, AC7.1, AC7.2, AC7.3 |
| `src/activity/context-provider.test.ts` | Unit | 3 | AC4.2, AC4.3, AC4.4, AC6.1, AC6.2, AC6.3, AC6.4 |
| `src/activity/dispatch.test.ts` | Unit | 4 | AC2.1, AC2.3, AC3.4 |
| `src/activity/sleep-events.test.ts` | Unit | 4 | AC3.5 |
| `src/activity/wake.test.ts` | Unit | 5 | AC5.1, AC5.2, AC5.3, AC5.4 |
| `src/activity/bluesky-interceptor.test.ts` | Unit | 6 | AC2.2, AC4.1 |
| Existing test suite (`bun test`) | Integration | 7 | AC8.3 |

---

## Design Decisions Affecting Test Strategy

1. **Functional Core / Imperative Shell split** enables unit-testing schedule logic (`currentMode`, `sleepTaskCron`, `nextTransitionTime`) and event builders without database or mock overhead. The pure functions in `src/activity/schedule.ts` and `src/activity/sleep-events.ts` are tested with direct input/output assertions.

2. **Port/adapter boundary** on `ActivityManager` interface means the context provider, dispatch wrapper, wake handler, and Bluesky interceptor can all be tested with mock implementations. Only `postgres-activity-manager.test.ts` requires a real PostgreSQL connection.

3. **Composition root wiring** (Phase 7) is not directly unit-tested because `src/index.ts` performs side-effectful startup. Backward compatibility (AC8.1, AC8.2, AC8.3) is verified by the existing test suite continuing to pass plus targeted manual smoke tests.

4. **AC5.1 dual verification**: The automated test in `wake.test.ts` verifies the wake handler's own contract (transition before drain). The scheduler-first guarantee is an emergent property of the composition root's async architecture, verified manually.

5. **AC6.4 composition root guarantee**: The context provider itself has no "disabled" mode — it always returns data when called. The disabled guarantee is enforced by the composition root never creating the provider when `config.activity?.enabled` is falsy. The unit test verifies initial `undefined` return (empty cache), and the composition root conditional is covered by AC8.1/AC8.2 config tests.
