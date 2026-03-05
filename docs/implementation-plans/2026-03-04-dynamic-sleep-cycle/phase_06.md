# Dynamic Sleep Cycle Implementation Plan — Phase 6

**Goal:** Route Bluesky events through the activity manager during sleep mode.

**Architecture:** The interception point is the `blueskySource.onMessage()` handler in `src/index.ts:701-710`. When activity is enabled and the agent is sleeping, Bluesky events are routed to `activityManager.queueEvent()` instead of the Bluesky event queue. High-priority flagging is configurable (e.g., events from `schedule_dids` could be flagged). The modification is in the composition root handler only — the BlueskyDataSource module itself is unchanged.

**Tech Stack:** TypeScript 5.7+

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC2: Event queueing during sleep
- **sleep-cycle.AC2.2 Success:** Bluesky events are written to `event_queue` during sleep mode

### sleep-cycle.AC4: Soft bypass for high-priority events
- **sleep-cycle.AC4.1 Success:** High-priority events are flagged in the queue

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create Bluesky event interceptor for activity routing

**Files:**
- Create: `src/activity/bluesky-interceptor.ts`

**Implementation:**

Annotate with `// pattern: Imperative Shell`.

Create a wrapper function that intercepts Bluesky `IncomingMessage` events and routes them based on activity state. This is a standalone function (not modifying the Bluesky module), called from the composition root in Phase 7.

```typescript
// pattern: Imperative Shell

import type { ActivityManager, NewQueuedEvent } from './types.ts';

type IncomingMessageLike = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type BlueskyInterceptorOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (message: IncomingMessageLike) => void;
  readonly highPriorityDids?: ReadonlyArray<string>;
};

export function createBlueskyInterceptor(
  options: Readonly<BlueskyInterceptorOptions>,
): (message: IncomingMessageLike) => void {
  const { activityManager, originalHandler, highPriorityDids = [] } = options;
  const highPrioritySet = new Set(highPriorityDids);

  return (message: IncomingMessageLike) => {
    (async () => {
      const isActive = await activityManager.isActive();

      if (isActive) {
        originalHandler(message);
        return;
      }

      // Sleeping: queue the event
      const authorDid = message.metadata['authorDid'] as string | undefined;
      const isHighPriority = authorDid !== undefined && highPrioritySet.has(authorDid);

      const event: NewQueuedEvent = {
        source: `bluesky:${message.source}`,
        payload: {
          content: message.content,
          metadata: message.metadata,
          originalTimestamp: message.timestamp.toISOString(),
        },
        priority: isHighPriority ? 'high' : 'normal',
        flagged: isHighPriority,
      };

      await activityManager.queueEvent(event);
      console.log(`[activity] queued bluesky event during sleep (priority: ${event.priority})`);
    })().catch((error) => {
      console.error('[activity] bluesky interceptor error, falling through to original handler:', error);
      originalHandler(message);
    });
  };
}
```

The `highPriorityDids` list can be sourced from `config.bluesky.schedule_dids` in the composition root — these are DIDs with special access (scheduling authority), making them reasonable candidates for high-priority flagging during sleep.

Export from barrel (`src/activity/index.ts`):
```typescript
export { createBlueskyInterceptor } from './bluesky-interceptor.ts';
export type { BlueskyInterceptorOptions } from './bluesky-interceptor.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add Bluesky event interceptor for sleep routing`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Bluesky interceptor tests

**Verifies:** sleep-cycle.AC2.2, sleep-cycle.AC4.1

**Files:**
- Create: `src/activity/bluesky-interceptor.test.ts`

**Testing:**

Use mock `ActivityManager` and mock original handler. No database or Bluesky connection needed.

Tests must verify each AC listed above:

- sleep-cycle.AC2.2: Set mock `isActive()` to return false (sleeping). Call interceptor with a Bluesky message. Verify `queueEvent()` is called with correct source, payload, and priority. Verify original handler is NOT called.
- sleep-cycle.AC4.1: Set mock `isActive()` to return false. Call interceptor with a message where `metadata.authorDid` is in `highPriorityDids`. Verify `queueEvent()` is called with `priority: 'high'` and `flagged: true`.

Additional tests:
- When active: original handler IS called, `queueEvent()` is NOT called
- When sleeping with non-priority DID: `queueEvent()` called with `priority: 'normal'` and `flagged: false`
- Error in `isActive()`: falls through to original handler (error recovery)
- Message without `authorDid` metadata: treated as normal priority

**Verification:**
Run: `bun test src/activity/bluesky-interceptor.test.ts`
Expected: All tests pass

**Commit:** `test(activity): add Bluesky interceptor tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
