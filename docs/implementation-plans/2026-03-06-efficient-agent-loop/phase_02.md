# Efficient Agent Loop Implementation Plan — Phase 2: Generalise Activity Interceptor

**Goal:** Make the bluesky-specific activity interceptor source-agnostic so any DataSource can use it with its own high-priority filter predicate.

**Architecture:** Rename `createBlueskyInterceptor` to `createActivityInterceptor` in a new file. Replace the `highPriorityDids` DID list parameter with a generic `highPriorityFilter` predicate `(message: IncomingMessage) => boolean`. Replace the locally-defined `IncomingMessageLike` with the canonical `IncomingMessage` from `src/extensions/data-source.ts`. Bluesky-specific DID matching becomes a filter predicate passed by the caller at the composition root. Deprecate the old `createBlueskyInterceptor` re-export.

**Tech Stack:** Bun (TypeScript)

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-03-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### efficient-agent-loop.AC3: Generalised activity interceptor
- **efficient-agent-loop.AC3.1 Success:** Activity interceptor accepts a generic `highPriorityFilter` predicate instead of a bluesky-specific DID list
- **efficient-agent-loop.AC3.2 Success:** Bluesky high-priority DID matching works through the generic predicate (existing behaviour preserved)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `createActivityInterceptor` factory

**Verifies:** efficient-agent-loop.AC3.1

**Files:**
- Create: `src/activity/activity-interceptor.ts`

**Implementation:**

Create a generalised interceptor that accepts a `highPriorityFilter` predicate instead of a DID list. This is a near-direct refactor of `bluesky-interceptor.ts` with two changes: (1) use `IncomingMessage` from extensions instead of local `IncomingMessageLike`, and (2) replace `highPriorityDids` with `highPriorityFilter`.

```typescript
// pattern: Imperative Shell

import type { IncomingMessage } from '../extensions/data-source.ts';
import type { ActivityManager, NewQueuedEvent } from './types.ts';

export type ActivityInterceptorOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (message: IncomingMessage) => void;
  readonly sourcePrefix: string;
  readonly highPriorityFilter?: (message: IncomingMessage) => boolean;
};

export function createActivityInterceptor(
  options: Readonly<ActivityInterceptorOptions>,
): (message: IncomingMessage) => void {
  const { activityManager, originalHandler, sourcePrefix, highPriorityFilter } = options;

  return (message: IncomingMessage) => {
    (async () => {
      const isActive = await activityManager.isActive();

      if (isActive) {
        originalHandler(message);
        return;
      }

      const isHighPriority = highPriorityFilter !== undefined && highPriorityFilter(message);

      const event: NewQueuedEvent = {
        source: `${sourcePrefix}:${message.source}`,
        payload: {
          content: message.content,
          metadata: message.metadata,
          originalTimestamp: message.timestamp.toISOString(),
        },
        priority: isHighPriority ? 'high' : 'normal',
        flagged: isHighPriority,
      };

      await activityManager.queueEvent(event);
      console.log(`[activity] queued ${sourcePrefix} event during sleep (priority: ${event.priority})`);
    })().catch((error) => {
      console.error(`[activity] ${sourcePrefix} interceptor error, falling through to original handler:`, error);
      originalHandler(message);
    });
  };
}
```

Key design decisions:
- `sourcePrefix` replaces the hardcoded `'bluesky'` in the event source field. Each DataSource passes its own prefix (e.g., `'bluesky'`, `'discord'`).
- `highPriorityFilter` is optional — when omitted, all events are normal priority (same as passing empty `highPriorityDids` before).
- `IncomingMessage` from extensions is the canonical type. It's structurally identical to the old `IncomingMessageLike` so all existing callers work without changes.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Also update `src/activity/index.ts` — add these lines to the barrel file (keep old `createBlueskyInterceptor` export for now, removed in Phase 4):

```typescript
export { createActivityInterceptor } from './activity-interceptor.ts';
export type { ActivityInterceptorOptions } from './activity-interceptor.ts';
```

**Commit:** `feat(activity): create generic activity interceptor with highPriorityFilter predicate`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update composition root to use generic interceptor

**Verifies:** efficient-agent-loop.AC3.2

**Files:**
- Modify: `src/index.ts:799-812` (bluesky interceptor wiring)

**Implementation:**

Replace the `createBlueskyInterceptor` call with `createActivityInterceptor`, passing a DID-based filter predicate that preserves identical behaviour.

Replace the current block at lines 799-812:

```typescript
      // --- Activity-aware Bluesky handler (after Bluesky setup) ---
      if (activityManager && blueskySource) {
        const highPriorityDids = new Set(config.bluesky.schedule_dids);

        blueskySource.onMessage(createActivityInterceptor({
          activityManager,
          originalHandler: (message) => {
            eventQueue.push(message);
            processNextEvent().catch((error) => {
              console.error('bluesky event processing error:', error);
            });
          },
          sourcePrefix: 'bluesky',
          highPriorityFilter: highPriorityDids.size > 0
            ? (message) => {
                const authorDid = message.metadata['authorDid'] as string | undefined;
                return authorDid !== undefined && highPriorityDids.has(authorDid);
              }
            : undefined,
        }));
        console.log('[activity] bluesky handler wrapped with activity interceptor');
      }
```

Update imports at top of `src/index.ts`: replace `createBlueskyInterceptor` with `createActivityInterceptor`.

Key details:
- DID matching logic moves from inside the interceptor to the caller (composition root), wrapped as a `highPriorityFilter` predicate.
- When `schedule_dids` is empty, `highPriorityFilter` is `undefined` (matching previous behaviour where empty `highPriorityDids` meant no flagging).
- The `Set` is created once at wiring time, not per-message — same performance characteristics as before.
- **`onMessage` is a setter, not an additive listener** — per `bluesky/source.ts:183-184`, calling `onMessage` replaces the previous handler (last-writer-wins). The unconditional handler registered at lines 788-797 is dead code when `activityManager` exists because this `createActivityInterceptor` call at lines 799-812 overwrites it. Both handlers (lines 788-797 and 799-812) are removed entirely in Phase 4, Task 1 when the registry takes over all DataSource wiring.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `refactor(index): wire bluesky through generic activity interceptor`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for generic activity interceptor

**Verifies:** efficient-agent-loop.AC3.1, efficient-agent-loop.AC3.2

**Files:**
- Create: `src/activity/activity-interceptor.test.ts`

**Testing:**

Tests must verify each AC listed above:

- **efficient-agent-loop.AC3.1:** Interceptor accepts a generic `highPriorityFilter` predicate. Test with various filter functions (DID-based, source-based, always-true, always-false) to prove it's not bluesky-specific.
- **efficient-agent-loop.AC3.2:** Bluesky DID matching works through the generic predicate. Create a DID-based filter matching the composition root pattern and verify high-priority events are correctly flagged.

Test structure mirrors the existing `bluesky-interceptor.test.ts` patterns:

```
describe('createActivityInterceptor (efficient-agent-loop.AC3)', () => {
  describe('when active', () => {
    // calls originalHandler directly, does not queue
  });

  describe('when sleeping', () => {
    describe('efficient-agent-loop.AC3.1: generic highPriorityFilter', () => {
      // filter returning true → high priority, flagged
      // filter returning false → normal priority, not flagged
      // no filter provided → normal priority, not flagged
      // custom non-DID filter (e.g., source-based) works
    });

    describe('efficient-agent-loop.AC3.2: bluesky DID filter preserved', () => {
      // DID-based filter matching schedule_dids → high priority
      // DID-based filter with non-matching DID → normal priority
      // DID-based filter with missing authorDid → normal priority
    });

    // sourcePrefix is used in event source
    // payload structure preserved (content, metadata, originalTimestamp)
  });

  describe('error handling', () => {
    // falls back to originalHandler on error
  });
});
```

Use the same mock patterns as `bluesky-interceptor.test.ts`:
- `createMockActivityManager` with configurable `isActive` and `recordedEvents` array
- `IncomingMessage` test data with varying metadata
- 50ms async waits for the inner async IIFE to complete

**Verification:**

Run: `bun test src/activity/activity-interceptor.test.ts`
Expected: All tests pass

**Commit:** `test(activity): add tests for generic activity interceptor (AC3.1, AC3.2)`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
