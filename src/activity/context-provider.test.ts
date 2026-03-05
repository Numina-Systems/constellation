/**
 * Tests for the activity context provider.
 * Verifies cached async refresh pattern, system prompt injection for active/sleep modes,
 * circadian guidance, and flagged event handling.
 */

import { describe, it, expect } from 'bun:test';
import { createActivityContextProvider } from './context-provider.ts';
import type { ActivityManager, ActivityState, QueuedEvent } from './types.ts';

/**
 * Mock ActivityManager with configurable state for testing
 */
function createMockActivityManager(overrides: {
  mode?: 'active' | 'sleeping';
  nextTransitionAt?: Date | null;
  queuedEventCount?: number;
  flaggedEventCount?: number;
  flaggedEvents?: ReadonlyArray<QueuedEvent>;
}): ActivityManager {
  const mode = overrides.mode ?? 'active';
  const nextTransitionAt =
    overrides.nextTransitionAt === undefined ? new Date(Date.now() + 3600000) : overrides.nextTransitionAt;
  const queuedEventCount = overrides.queuedEventCount ?? 0;
  const flaggedEventCount = overrides.flaggedEventCount ?? 0;
  const flaggedEventsArray = overrides.flaggedEvents ?? [];

  const state: ActivityState = {
    mode,
    transitionedAt: new Date(),
    nextTransitionAt,
    queuedEventCount,
    flaggedEventCount,
  };

  return {
    async getState() {
      return state;
    },
    async getFlaggedEvents() {
      return flaggedEventsArray;
    },
    async isActive() {
      return mode === 'active';
    },
    async transitionTo() {
      // no-op for testing
    },
    async queueEvent() {
      // no-op for testing
    },
    async flagEvent() {
      // no-op for testing
    },
    async *drainQueue() {
      // no-op for testing
    },
  };
}

describe('Activity context provider', () => {
  describe('AC6.1: Active mode status injection', () => {
    it('injects status line with next sleep time when active', async () => {
      const nextSleep = new Date('2026-03-04T12:00:00Z');
      const manager = createMockActivityManager({
        mode: 'active',
        nextTransitionAt: nextSleep,
      });

      const provider = createActivityContextProvider(manager);

      // First call returns undefined (cache not yet populated)
      const firstCall = provider();
      expect(firstCall).toBeUndefined();

      // Wait for async refresh
      await Bun.sleep(50);

      // Second call returns formatted context
      const secondCall = provider();
      expect(secondCall).toBeDefined();
      expect(secondCall).toContain('[Activity] Status: active');
      expect(secondCall).toContain('Next sleep: 2026-03-04T12:00:00.000Z');
    });
  });

  describe('AC6.2: Sleep mode status and circadian guidance', () => {
    it('injects contemplative tone guidance and queue stats in sleep mode', async () => {
      const nextWake = new Date('2026-03-04T08:00:00Z');
      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: nextWake,
        queuedEventCount: 5,
        flaggedEventCount: 2,
      });

      const provider = createActivityContextProvider(manager);

      // First call returns undefined
      const firstCall = provider();
      expect(firstCall).toBeUndefined();

      // Wait for async refresh
      await Bun.sleep(50);

      // Second call returns formatted context
      const secondCall = provider();
      expect(secondCall).toBeDefined();
      expect(secondCall).toContain('[Activity] Status: sleeping');
      expect(secondCall).toContain('Next wake: 2026-03-04T08:00:00.000Z');
      expect(secondCall).toContain('Queued events: 5');
      expect(secondCall).toContain('Flagged: 2');
      expect(secondCall).toContain('[Circadian Guidance]');
      expect(secondCall).toContain('You are in sleep mode');
      expect(secondCall).toContain('Review and consolidate memories');
      expect(secondCall).toContain('Evaluate pending predictions');
      expect(secondCall).toContain('Identify patterns across recent interactions');
      expect(secondCall).toContain('Prefer depth of thought over breadth of action');
    });
  });

  describe('AC6.3: Flagged event summaries in sleep mode', () => {
    it('includes flagged event source and timestamp summaries', async () => {
      const event1: QueuedEvent = {
        id: '1',
        source: 'bluesky',
        payload: {},
        priority: 'high',
        enqueuedAt: new Date('2026-03-04T03:15:00Z'),
        flagged: true,
      };

      const event2: QueuedEvent = {
        id: '2',
        source: 'email',
        payload: {},
        priority: 'high',
        enqueuedAt: new Date('2026-03-04T03:45:00Z'),
        flagged: true,
      };

      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: new Date(),
        flaggedEventCount: 2,
        flaggedEvents: [event1, event2],
      });

      const provider = createActivityContextProvider(manager);

      // First call returns undefined
      provider();
      await Bun.sleep(50);

      // Second call has the context
      const context = provider();
      expect(context).toBeDefined();
      expect(context).toContain('[Flagged Events]');
      expect(context).toContain('[bluesky] at 2026-03-04T03:15:00.000Z');
      expect(context).toContain('[email] at 2026-03-04T03:45:00.000Z');
      expect(context).toContain('These high-priority events arrived during sleep');
    });
  });

  describe('AC6.4: Provider disabled case', () => {
    it('returns undefined before first refresh completes (inert until async refresh)', async () => {
      const manager = createMockActivityManager({
        mode: 'active',
      });

      const provider = createActivityContextProvider(manager);

      // First call returns undefined — proves inert until async refresh
      const result = provider();
      expect(result).toBeUndefined();
    });
  });

  describe('AC4.2: Flagged event count in sleep context', () => {
    it('displays flagged event count and summaries in sleep context', async () => {
      const flaggedEvent: QueuedEvent = {
        id: 'evt-1',
        source: 'calendar',
        payload: { title: 'Important meeting' },
        priority: 'high',
        enqueuedAt: new Date('2026-03-04T05:30:00Z'),
        flagged: true,
      };

      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: new Date(),
        flaggedEventCount: 1,
        flaggedEvents: [flaggedEvent],
      });

      const provider = createActivityContextProvider(manager);
      provider(); // trigger refresh
      await Bun.sleep(50);

      const context = provider();
      expect(context).toContain('Flagged: 1');
      expect(context).toContain('[calendar] at 2026-03-04T05:30:00.000Z');
    });
  });

  describe('AC4.3: Flagged events are not auto-processed', () => {
    it('surfaces flagged events for agent review (informational only)', async () => {
      const flaggedEvent: QueuedEvent = {
        id: 'evt-2',
        source: 'notification-system',
        payload: { severity: 'high' },
        priority: 'high',
        enqueuedAt: new Date('2026-03-04T04:00:00Z'),
        flagged: true,
      };

      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: new Date(),
        flaggedEventCount: 1,
        flaggedEvents: [flaggedEvent],
      });

      const provider = createActivityContextProvider(manager);
      provider();
      await Bun.sleep(50);

      const context = provider();
      // Flagged events appear in context with source and timestamp
      expect(context).toContain('[notification-system]');
      expect(context).toContain('2026-03-04T04:00:00.000Z');
      // Context is informational — does not trigger auto-processing
      expect(context).toContain('Review and decide if action is needed');
    });
  });

  describe('AC4.4: Clean output with zero flagged events', () => {
    it('does not include flagged events section when count is zero', async () => {
      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: new Date(),
        queuedEventCount: 3,
        flaggedEventCount: 0,
        flaggedEvents: [],
      });

      const provider = createActivityContextProvider(manager);
      provider();
      await Bun.sleep(50);

      const context = provider();
      expect(context).toBeDefined();
      expect(context).toContain('[Activity] Status: sleeping');
      expect(context).toContain('[Circadian Guidance]');
      // No [Flagged Events] section when count is zero
      expect(context).not.toContain('[Flagged Events]');
    });
  });

  describe('Cache behaviour', () => {
    it('caches result for 60 seconds and returns stale cache on read path', async () => {
      const manager = createMockActivityManager({
        mode: 'active',
        nextTransitionAt: new Date('2026-03-04T12:00:00Z'),
      });

      const provider = createActivityContextProvider(manager);

      // First call triggers refresh
      provider();
      await Bun.sleep(50);

      const firstRead = provider();
      expect(firstRead).toBeDefined();

      // Immediate second call returns same cached result
      const secondRead = provider();
      expect(secondRead).toBe(firstRead);
    });

    it('returns cached value on successive reads without refresh', async () => {
      let callCount = 0;

      const manager: ActivityManager = {
        async getState() {
          callCount++;
          return {
            mode: 'active',
            transitionedAt: new Date(),
            nextTransitionAt: new Date(Date.now() + 3600000),
            queuedEventCount: callCount, // Changes with each call
            flaggedEventCount: 0,
          };
        },
        async getFlaggedEvents() {
          return [];
        },
        async isActive() {
          return true;
        },
        async transitionTo() {},
        async queueEvent() {},
        async flagEvent() {},
        async *drainQueue() {},
      };

      const provider = createActivityContextProvider(manager);

      // First read triggers refresh
      provider();
      await Bun.sleep(50);
      const initialCallCount = callCount;

      // Multiple reads within TTL return same cached value
      const firstRead = provider();
      const secondRead = provider();
      const thirdRead = provider();

      expect(firstRead).toBe(secondRead);
      expect(secondRead).toBe(thirdRead);
      // Manager.getState() only called once (during refresh)
      expect(callCount).toBe(initialCallCount);
    });
  });

  describe('Error handling', () => {
    it('logs warning and preserves cache on getState error', async () => {
      let errorLogged = false;
      const originalWarn = console.warn;
      try {
        console.warn = (msg: string) => {
          if (msg.includes('activity context provider')) {
            errorLogged = true;
          }
        };

        const manager: ActivityManager = {
          async getState() {
            throw new Error('Database connection failed');
          },
          async getFlaggedEvents() {
            return [];
          },
          async isActive() {
            return true;
          },
          async transitionTo() {},
          async queueEvent() {},
          async flagEvent() {},
          async *drainQueue() {},
        };

        const provider = createActivityContextProvider(manager);
        provider();
        await Bun.sleep(50);

        const result = provider();
        // Cache was not populated due to error
        expect(result).toBeUndefined();
        expect(errorLogged).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('Null nextTransitionAt', () => {
    it('displays "unknown" when nextTransitionAt is null in active mode', async () => {
      const manager = createMockActivityManager({
        mode: 'active',
        nextTransitionAt: null,
      });

      const provider = createActivityContextProvider(manager);
      provider();
      await Bun.sleep(50);

      const context = provider();
      expect(context).toContain('Next sleep: unknown');
    });

    it('displays "unknown" when nextTransitionAt is null in sleep mode', async () => {
      const manager = createMockActivityManager({
        mode: 'sleeping',
        nextTransitionAt: null,
      });

      const provider = createActivityContextProvider(manager);
      provider();
      await Bun.sleep(50);

      const context = provider();
      expect(context).toContain('Next wake: unknown');
    });
  });
});
