/**
 * Tests for the generic activity interceptor.
 * Verifies that the interceptor accepts a generic highPriorityFilter predicate
 * and that bluesky DID matching works through the predicate (efficient-agent-loop.AC3).
 */

import { describe, it, expect } from 'bun:test';
import { createActivityInterceptor } from './activity-interceptor.ts';
import type { ActivityManager, NewQueuedEvent } from './types.ts';
import type { IncomingMessage } from '../extensions/data-source.ts';

/**
 * Mock ActivityManager with configurable state and event tracking
 */
function createMockActivityManager(overrides: {
  isActive?: boolean;
}): ActivityManager & {
  recordedEvents: Array<NewQueuedEvent>;
} {
  const isActiveValue = overrides.isActive ?? true;
  const recordedEvents: Array<NewQueuedEvent> = [];

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

describe('createActivityInterceptor (efficient-agent-loop.AC3)', () => {
  describe('when active', () => {
    it('should call original handler and NOT queue event', async () => {
      const mockManager = createMockActivityManager({ isActive: true });
      let handlerCalled = false;

      const handler = createActivityInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          handlerCalled = true;
        },
        sourcePrefix: 'test-source',
      });

      const message: IncomingMessage = {
        source: 'feed',
        content: 'test content',
        metadata: { testKey: 'testValue' },
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
    describe('efficient-agent-loop.AC3.1: generic highPriorityFilter', () => {
      it('should accept filter returning true → high priority, flagged', async () => {
        const mockManager = createMockActivityManager({ isActive: false });

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'generic',
          highPriorityFilter: () => true,
        });

        const message: IncomingMessage = {
          source: 'notifications',
          content: 'high priority event',
          metadata: { priority: 'high' },
          timestamp: new Date('2026-03-04T11:30:00Z'),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.source).toBe('generic:notifications');
        expect(queued.priority).toBe('high');
        expect(queued.flagged).toBe(true);
      });

      it('should accept filter returning false → normal priority, not flagged', async () => {
        const mockManager = createMockActivityManager({ isActive: false });

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'generic',
          highPriorityFilter: () => false,
        });

        const message: IncomingMessage = {
          source: 'feed',
          content: 'normal event',
          metadata: {},
          timestamp: new Date(),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.priority).toBe('normal');
        expect(queued.flagged).toBe(false);
      });

      it('should handle no filter provided → normal priority, not flagged', async () => {
        const mockManager = createMockActivityManager({ isActive: false });

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'generic',
          // highPriorityFilter explicitly omitted
        });

        const message: IncomingMessage = {
          source: 'feed',
          content: 'event without filter',
          metadata: { someData: 'value' },
          timestamp: new Date(),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.priority).toBe('normal');
        expect(queued.flagged).toBe(false);
      });

      it('should work with custom non-DID filter (source-based)', async () => {
        const mockManager = createMockActivityManager({ isActive: false });

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'multi-source',
          highPriorityFilter: (message) => message.source === 'urgent',
        });

        const urgentMessage: IncomingMessage = {
          source: 'urgent',
          content: 'urgent event',
          metadata: {},
          timestamp: new Date(),
        };

        const normalMessage: IncomingMessage = {
          source: 'normal',
          content: 'normal event',
          metadata: {},
          timestamp: new Date(),
        };

        handler(urgentMessage);
        handler(normalMessage);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(2);

        const urgentQueued = mockManager.recordedEvents.at(0);
        expect(urgentQueued).toBeDefined();
        if (urgentQueued) {
          expect(urgentQueued.priority).toBe('high');
          expect(urgentQueued.flagged).toBe(true);
        }

        const normalQueued = mockManager.recordedEvents.at(1);
        expect(normalQueued).toBeDefined();
        if (normalQueued) {
          expect(normalQueued.priority).toBe('normal');
          expect(normalQueued.flagged).toBe(false);
        }
      });
    });

    describe('efficient-agent-loop.AC3.2: bluesky DID filter preserved', () => {
      it('should flag high-priority DID through generic predicate', async () => {
        const mockManager = createMockActivityManager({ isActive: false });
        const highPriorityDids = new Set(['did:plc:scheduler001', 'did:plc:scheduler002']);

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'bluesky',
          highPriorityFilter: (message) => {
            const authorDid = message.metadata['authorDid'] as string | undefined;
            return authorDid !== undefined && highPriorityDids.has(authorDid);
          },
        });

        const message: IncomingMessage = {
          source: 'notification',
          content: 'high priority event from scheduler',
          metadata: { authorDid: 'did:plc:scheduler001' },
          timestamp: new Date('2026-03-04T11:30:00Z'),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.source).toBe('bluesky:notification');
        expect(queued.priority).toBe('high');
        expect(queued.flagged).toBe(true);
      });

      it('should not flag non-matching DID through generic predicate', async () => {
        const mockManager = createMockActivityManager({ isActive: false });
        const highPriorityDids = new Set(['did:plc:scheduler001']);

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'bluesky',
          highPriorityFilter: (message) => {
            const authorDid = message.metadata['authorDid'] as string | undefined;
            return authorDid !== undefined && highPriorityDids.has(authorDid);
          },
        });

        const message: IncomingMessage = {
          source: 'feed',
          content: 'event from regular user',
          metadata: { authorDid: 'did:plc:regular_user' },
          timestamp: new Date(),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.priority).toBe('normal');
        expect(queued.flagged).toBe(false);
      });

      it('should treat missing authorDid as normal priority', async () => {
        const mockManager = createMockActivityManager({ isActive: false });
        const highPriorityDids = new Set(['did:plc:scheduler001']);

        const handler = createActivityInterceptor({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          sourcePrefix: 'bluesky',
          highPriorityFilter: (message) => {
            const authorDid = message.metadata['authorDid'] as string | undefined;
            return authorDid !== undefined && highPriorityDids.has(authorDid);
          },
        });

        const message: IncomingMessage = {
          source: 'feed',
          content: 'event without authorDid',
          metadata: {},
          timestamp: new Date(),
        };

        handler(message);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockManager.recordedEvents).toHaveLength(1);
        const queued = mockManager.recordedEvents.at(0);
        expect(queued).toBeDefined();
        if (!queued) return;
        expect(queued.priority).toBe('normal');
        expect(queued.flagged).toBe(false);
      });
    });

    it('should use sourcePrefix in event source field', async () => {
      const mockManager = createMockActivityManager({ isActive: false });

      const handler = createActivityInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        sourcePrefix: 'discord',
      });

      const message: IncomingMessage = {
        source: 'general-channel',
        content: 'discord message',
        metadata: {},
        timestamp: new Date(),
      };

      handler(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);
      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;
      expect(queued.source).toBe('discord:general-channel');
    });

    it('should preserve payload structure (content, metadata, originalTimestamp)', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      const testTimestamp = new Date('2026-03-04T10:00:00Z');

      const handler = createActivityInterceptor({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        sourcePrefix: 'test',
      });

      const message: IncomingMessage = {
        source: 'feed',
        content: 'test content with special chars: 你好',
        metadata: { authorId: '123', tags: ['tag1', 'tag2'], nested: { key: 'value' } },
        timestamp: testTimestamp,
      };

      handler(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockManager.recordedEvents).toHaveLength(1);
      const queued = mockManager.recordedEvents.at(0);
      expect(queued).toBeDefined();
      if (!queued) return;

      expect(queued.payload).toHaveProperty('content', 'test content with special chars: 你好');
      expect(queued.payload).toHaveProperty('metadata', { authorId: '123', tags: ['tag1', 'tag2'], nested: { key: 'value' } });

      const payload = queued.payload as Record<string, unknown>;
      expect(typeof payload['originalTimestamp']).toBe('string');
      expect((payload['originalTimestamp'] as string).startsWith('2026-03-04T10:00:00')).toBe(true);
    });
  });

  describe('error handling', () => {
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

      const handler = createActivityInterceptor({
        activityManager: errorManager,
        originalHandler: () => {
          handlerCalled = true;
        },
        sourcePrefix: 'test',
      });

      const message: IncomingMessage = {
        source: 'feed',
        content: 'test',
        metadata: {},
        timestamp: new Date(),
      };

      handler(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(true);
    });

    it('should fall back to original handler when queueEvent fails', async () => {
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
          return false;
        },
        async transitionTo() {
          // no-op
        },
        async queueEvent() {
          throw new Error('Queue error');
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

      const handler = createActivityInterceptor({
        activityManager: errorManager,
        originalHandler: () => {
          handlerCalled = true;
        },
        sourcePrefix: 'test',
      });

      const message: IncomingMessage = {
        source: 'feed',
        content: 'test',
        metadata: {},
        timestamp: new Date(),
      };

      handler(message);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(true);
    });
  });
});
