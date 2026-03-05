# Dynamic Sleep Cycle Implementation Plan — Phase 5

**Goal:** Implement the wake-up sequence that processes scheduled tasks first, then trickles queued events.

**Architecture:** A `createWakeHandler` function in `src/activity/wake.ts` encapsulates the wake-up logic: transition state to active, then drain the event queue with trickle spacing. The drain yields events from the `drainQueue()` async generator (high-priority first, normal second, FIFO within) and dispatches each as an `ExternalEvent` to the agent via a callback. A configurable delay between events prevents burst.

**Tech Stack:** TypeScript 5.7+

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC5: Wake-up queue drain
- **sleep-cycle.AC5.1 Success:** Wake transition processes due scheduled tasks before queued events
- **sleep-cycle.AC5.2 Success:** Queued events drain in priority order (high first, then normal, FIFO within)
- **sleep-cycle.AC5.3 Success:** Events trickle with delay between items (no burst)
- **sleep-cycle.AC5.4 Edge:** Empty queue on wake produces no errors and no unnecessary processing

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create wake handler

**Files:**
- Create: `src/activity/wake.ts`

**Implementation:**

Annotate with `// pattern: Imperative Shell`.

```typescript
// pattern: Imperative Shell

import type { ActivityManager, QueuedEvent } from './types.ts';

export type WakeHandlerOptions = {
  readonly activityManager: ActivityManager;
  readonly onEvent: (event: QueuedEvent) => Promise<void>;
  readonly trickleDelayMs: number;
};

export function createWakeHandler(options: Readonly<WakeHandlerOptions>): () => Promise<void> {
  const { activityManager, onEvent, trickleDelayMs } = options;

  return async (): Promise<void> => {
    // 1. Transition to active
    await activityManager.transitionTo('active');
    console.log('[activity] transitioned to active mode');

    // 2. Drain queued events with trickle delay
    // drainQueue() yields events in priority order (high first, then normal, FIFO within)
    let count = 0;
    for await (const event of activityManager.drainQueue()) {
      try {
        await onEvent(event);
        count++;
      } catch (error) {
        console.error(`[activity] error processing queued event ${event.id}:`, error);
      }

      // Trickle delay between events
      if (trickleDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, trickleDelayMs));
      }
    }

    if (count > 0) {
      console.log(`[activity] drained ${count} queued events`);
    }
  };
}
```

The `onEvent` callback is provided by the composition root (Phase 7) and converts `QueuedEvent` to `ExternalEvent` then pushes it through `agent.processEvent()`.

**Note on AC5.1 (scheduled tasks before queued events):** The scheduler's own polling tick runs independently and will process due scheduled tasks on its next 60-second tick. The wake handler is invoked by the transition task handler. Since the scheduler tick and wake drain happen asynchronously, the scheduler will naturally process its due tasks. The wake handler only drains the `event_queue` table. This separation ensures scheduled tasks and queued events are processed independently without race conditions.

Export from barrel (`src/activity/index.ts`):
```typescript
export { createWakeHandler } from './wake.ts';
export type { WakeHandlerOptions } from './wake.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add wake handler with trickle drain`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create queued event to external event converter

**Files:**
- Create: `src/activity/event-converter.ts`

**Implementation:**

Annotate with `// pattern: Functional Core`.

Pure function that converts a `QueuedEvent` from the event queue into the `ExternalEvent` format used by `agent.processEvent()`.

```typescript
// pattern: Functional Core

import type { QueuedEvent } from './types.ts';

type ExternalEventLike = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export function queuedEventToExternal(event: Readonly<QueuedEvent>): ExternalEventLike {
  const payload = event.payload as Record<string, unknown> | null;
  const content = typeof payload?.['prompt'] === 'string'
    ? payload['prompt'] as string
    : `Queued event from ${event.source} (enqueued at ${event.enqueuedAt.toISOString()})`;

  return {
    source: event.source,
    content,
    metadata: {
      queuedEventId: event.id,
      priority: event.priority,
      flagged: event.flagged,
      enqueuedAt: event.enqueuedAt.toISOString(),
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    },
    timestamp: event.enqueuedAt,
  };
}
```

Export from barrel.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add queued event to external event converter`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wake handler and event converter tests

**Verifies:** sleep-cycle.AC5.1, sleep-cycle.AC5.2, sleep-cycle.AC5.3, sleep-cycle.AC5.4

**Files:**
- Create: `src/activity/wake.test.ts`

**Testing:**

Use mock `ActivityManager` with controllable `drainQueue()` async generator and mock `onEvent` callback.

Tests must verify each AC listed above:

- sleep-cycle.AC5.1: Verify `transitionTo('active')` is called before any `onEvent` calls. (The design notes that scheduled tasks are handled by the scheduler's own polling; the wake handler's responsibility is transitioning state and draining the queue.)
- sleep-cycle.AC5.2: Set up mock `drainQueue()` to yield events in the expected order (high-priority first, then normal, FIFO within). Verify `onEvent` is called in that order. (Note: ordering is the responsibility of the `drainQueue()` implementation in Phase 2; the wake handler preserves that order.)
- sleep-cycle.AC5.3: Verify trickle delay occurs between events. Preferred approach: use `bun:test` fake timers (`jest.useFakeTimers()` / `jest.advanceTimersByTime()`) to avoid wall-clock flakiness. Set trickle delay to 1000ms, queue 3 events, advance timers by 1000ms between assertions to verify each event is dispatched after the delay. If fake timers are not available for async generators, fall back to wall-clock with generous margins: set delay to 50ms, queue 3 events, verify total time >= 80ms (allowing for timer imprecision).
- sleep-cycle.AC5.4: Set up mock `drainQueue()` to yield nothing (empty generator). Verify handler completes without error, `onEvent` never called, `transitionTo('active')` still called.

Also test `queuedEventToExternal`:
- Event with `payload.prompt` string: content is the prompt
- Event without prompt: content is fallback description with source and timestamp
- Metadata includes `queuedEventId`, `priority`, `flagged`

**Verification:**
Run: `bun test src/activity/wake.test.ts`
Expected: All tests pass

**Commit:** `test(activity): add wake handler and event converter tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
