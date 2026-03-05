/**
 * Tests for the Bluesky event interceptor.
 * Verifies that Bluesky messages are routed correctly based on activity state,
 * with support for high-priority flagging based on author DID.
 */

import { describe, it, expect } from 'bun:test';
import { createBlueskyInterceptor } from './bluesky-interceptor.ts';
import type { ActivityManager, NewQueuedEvent } from './types.ts';

/**
 * Mock ActivityManager with configurable state and event tracking
 */
function createMockActivityManager(overrides: {
  isActive?: boolean;
}): ActivityManager & {
  recordedEvents: NewQueuedEvent[];
} {
  const isActiveValue = overrides.isActive ?? true;
  const recordedEvents: NewQueuedEvent[] = [];

  return {
    recordedEvents,
    async getState() {
      return {
        mode: isActiveValue ? 'active' : 'sleeping',
        transitionedAt: new Date(),
        nextTransitionAt: new Date(Date.now() + 3600000),
        queuedEventCount: recordedEvents.length,
        flaggedEventCount: recordedEvents.filter((e) => e.flagged).length,
      };
    },
    async isActive() {
      return isActiveValue;
    },
    async transitionTo() {
      // no-op for testing
    },
    async queueEvent(event: NewQueuedEvent) {
      recordedEvents.push(event);
    },
    async flagEvent() {
      // no-op for testing
    },
    async *drainQueue() {
      // no-op for testing
    },
    async getFlaggedEvents() {
      return [];
    },
  };
}

describe('createBlueskyInterceptor', () => {
  describe('when active', () => {
    it('should call original handler and NOT queue event', async () => {
      const mockManager = createMockActivityManager({ isActive: true });
      let handlerCalled = false;

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          handlerCalled = true;
        },
      });

      const message = {
        source: 'feed',
        content: 'test content',
        metadata: { authorDid: 'did:plc:test' },
        timestamp: new Date(),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(true);
      expect(mockManager.recordedEvents).toHaveLength(0);
    });
  });

  describe('when sleeping', () => {
    it('should queue event and NOT call original handler (AC2.2)', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let handlerCalled = false;

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          handlerCalled = true;
        },
      });

      const message = {
        source: 'feed',
        content: 'test content',
        metadata: { authorDid: 'did:plc:user123' },
        timestamp: new Date('2026-03-04T10:00:00Z'),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(false);
      expect(mockManager.recordedEvents).toHaveLength(1);

      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.source).toBe('bluesky:feed');
      expect(queued.priority).toBe('normal');
      expect(queued.flagged).toBe(false);
      expect(queued.payload).toHaveProperty('content', 'test content');
      expect(queued.payload).toHaveProperty('metadata', { authorDid: 'did:plc:user123' });
      const payload = queued.payload as Record<string, unknown>;
      expect(typeof payload['originalTimestamp']).toBe('string');
      expect((payload['originalTimestamp'] as string).startsWith('2026-03-04T10:00:00')).toBe(true);
    });

    it('should flag high-priority events with priority DID (AC4.1)', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let handlerCalled = false;

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          handlerCalled = true;
        },
        highPriorityDids: ['did:plc:scheduler001', 'did:plc:scheduler002'],
      });

      const message = {
        source: 'notification',
        content: 'high priority event',
        metadata: { authorDid: 'did:plc:scheduler001' },
        timestamp: new Date('2026-03-04T11:30:00Z'),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(false);
      expect(mockManager.recordedEvents).toHaveLength(1);

      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.source).toBe('bluesky:notification');
      expect(queued.priority).toBe('high');
      expect(queued.flagged).toBe(true);
    });

    it('should treat messages without authorDid as normal priority', async () => {
      const mockManager = createMockActivityManager({ isActive: false });

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        highPriorityDids: ['did:plc:scheduler001'],
      });

      const message = {
        source: 'feed',
        content: 'content without author',
        metadata: {},
        timestamp: new Date(),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);

      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.priority).toBe('normal');
      expect(queued.flagged).toBe(false);
    });

    it('should queue normal priority for non-priority DIDs', async () => {
      const mockManager = createMockActivityManager({ isActive: false });

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        highPriorityDids: ['did:plc:scheduler001'],
      });

      const message = {
        source: 'feed',
        content: 'regular user event',
        metadata: { authorDid: 'did:plc:regular_user' },
        timestamp: new Date(),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);

      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.priority).toBe('normal');
      expect(queued.flagged).toBe(false);
    });

    it('should handle empty highPriorityDids list', async () => {
      const mockManager = createMockActivityManager({ isActive: false });

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        highPriorityDids: [],
      });

      const message = {
        source: 'feed',
        content: 'event with priority DID',
        metadata: { authorDid: 'did:plc:scheduler001' },
        timestamp: new Date(),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);

      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.priority).toBe('normal');
      expect(queued.flagged).toBe(false);
    });

    it('should fall back to original handler on error', async () => {
      let handlerCalled = false;
      const errorManager: ActivityManager = {
        async getState() {
          return {
            mode: 'sleeping',
            transitionedAt: new Date(),
            nextTransitionAt: null,
            queuedEventCount: 0,
            flaggedEventCount: 0,
          };
        },
        async isActive() {
          throw new Error('Activity manager error');
        },
        async transitionTo() {
          // no-op
        },
        async queueEvent() {
          // no-op
        },
        async flagEvent() {
          // no-op
        },
        async *drainQueue() {
          // no-op
        },
        async getFlaggedEvents() {
          return [];
        },
      };

      const handler = createBlueskyInterceptor({
        activityManager: errorManager,
        originalHandler: () => {
          handlerCalled = true;
        },
      });

      const message = {
        source: 'feed',
        content: 'test content',
        metadata: { authorDid: 'did:plc:user' },
        timestamp: new Date(),
      };

      handler(message);

      // Give async handler time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(true);
    });
  });

  describe('options validation', () => {
    it('should use empty array as default for highPriorityDids', async () => {
      const mockManager = createMockActivityManager({ isActive: false });

      const handler = createBlueskyInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        // highPriorityDids not provided
      });

      const message = {
        source: 'feed',
        content: 'test',
        metadata: { authorDid: 'did:plc:any' },
        timestamp: new Date(),
      };

      handler(message);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);
      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.flagged).toBe(false);
    });
  });
});
