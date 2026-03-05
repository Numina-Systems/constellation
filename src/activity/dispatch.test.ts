/**
 * Tests for the activity-aware dispatch wrapper.
 * Verifies that scheduler tasks are routed correctly based on activity state
 * and task type (sleep, transition, or regular).
 */

import { describe, it, expect } from 'bun:test';
import { createActivityDispatch } from './dispatch.ts';
import type { ActivityManager, ActivityState, NewQueuedEvent } from './types.ts';
import type { ScheduledTaskLike } from './dispatch.ts';

/**
 * Mock ActivityManager with configurable state for testing
 */
function createMockActivityManager(overrides: {
  isActive?: boolean;
  queuedEvents?: Array<{ source: string; payload: unknown }>;
}): ActivityManager & {
  recordedQueue: Array<{ source: string; payload: unknown }>;
} {
  const isActiveValue = overrides.isActive ?? true;
  const recordedQueue: Array<{ source: string; payload: unknown }> = [];

  const state: ActivityState = {
    mode: isActiveValue ? 'active' : 'sleeping',
    transitionedAt: new Date(),
    nextTransitionAt: new Date(Date.now() + 3600000),
    queuedEventCount: 0,
    flaggedEventCount: 0,
  };

  return {
    recordedQueue,
    async getState() {
      return state;
    },
    async isActive() {
      return isActiveValue;
    },
    async transitionTo() {
      // no-op for testing
    },
    async queueEvent(event) {
      recordedQueue.push({
        source: event.source,
        payload: event.payload,
      });
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

describe('createActivityDispatch', () => {
  // dispatch() fires an async IIFE internally; 50ms is ample for mock operations to settle
  describe('when active', () => {
    it('should call originalHandler for regular tasks', async () => {
      const mockManager = createMockActivityManager({ isActive: true });
      let originalHandlerCalled = false;
      let transitionHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          transitionHandlerCalled = true;
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-regular-task',
        schedule: '0 22 * * *',
        payload: { test: 'data' },
      };

      dispatch(task);

      // Give async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(true);
      expect(transitionHandlerCalled).toBe(false);
      expect(mockManager.recordedQueue.length).toBe(0);
    });

    it('should call originalHandler for sleep tasks (even when active)', async () => {
      const mockManager = createMockActivityManager({ isActive: true });
      let originalHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'sleep-compaction',
        schedule: '0 0 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(true);
      expect(mockManager.recordedQueue.length).toBe(0);
    });

    it('should not call onTransition for regular tasks', async () => {
      const mockManager = createMockActivityManager({ isActive: true });
      let transitionHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        onTransition: () => {
          transitionHandlerCalled = true;
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-task',
        schedule: '0 22 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(transitionHandlerCalled).toBe(false);
    });
  });

  describe('when sleeping', () => {
    it('should queue normal tasks instead of dispatching', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let originalHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-regular-task',
        schedule: '0 22 * * *',
        payload: { test: 'data' },
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(false);
      expect(mockManager.recordedQueue.length).toBe(1);
      expect(mockManager.recordedQueue[0]!.source).toBe('scheduler:some-regular-task');
      expect(mockManager.recordedQueue[0]!.payload).toEqual({ test: 'data' });
    });

    it('should still execute sleep tasks even during sleep', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let originalHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'sleep-prediction-review',
        schedule: '0 2 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(true);
      expect(mockManager.recordedQueue.length).toBe(0);
    });

    it('should call onTransition for transition tasks', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let originalHandlerCalled = false;
      let transitionHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          transitionHandlerCalled = true;
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'transition-to-wake',
        schedule: '0 6 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(transitionHandlerCalled).toBe(true);
      expect(originalHandlerCalled).toBe(false);
      expect(mockManager.recordedQueue.length).toBe(0);
    });

    it('should not queue when task is transition-to-sleep', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let transitionHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        onTransition: () => {
          transitionHandlerCalled = true;
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'transition-to-sleep',
        schedule: '0 22 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(transitionHandlerCalled).toBe(true);
      expect(mockManager.recordedQueue.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should fall through to originalHandler when isActive() throws', async () => {
      const mockManager = {
        async isActive() {
          throw new Error('Connection failed');
        },
        async getState() {
          return {
            mode: 'active' as const,
            transitionedAt: new Date(),
            nextTransitionAt: null,
            queuedEventCount: 0,
            flaggedEventCount: 0,
          };
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
      } as ActivityManager;

      let originalHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-task',
        schedule: '0 22 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(true);
    });

    it('should fall through to originalHandler when queueEvent() throws', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      mockManager.queueEvent = async () => {
        throw new Error('Queue is unavailable');
      };

      let originalHandlerCalled = false;

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          originalHandlerCalled = true;
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-regular-task',
        schedule: '0 22 * * *',
        payload: {},
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(originalHandlerCalled).toBe(true);
    });
  });

  describe('task priority and queueing', () => {
    it('should queue with normal priority for non-flagged events', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let queuedEvent: NewQueuedEvent | undefined;

      mockManager.queueEvent = async (event) => {
        queuedEvent = event;
      };

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        onTransition: () => {
          // no-op
        },
      });

      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-task',
        schedule: '0 22 * * *',
        payload: { important: true },
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(queuedEvent).toBeDefined();
      expect(queuedEvent!.priority).toBe('normal');
      expect(queuedEvent!.flagged).toBe(false);
    });

    it('should preserve task payload when queueing', async () => {
      const mockManager = createMockActivityManager({ isActive: false });
      let queuedEvent: NewQueuedEvent | undefined;

      mockManager.queueEvent = async (event) => {
        queuedEvent = event;
      };

      const dispatch = createActivityDispatch({
        activityManager: mockManager,
        originalHandler: () => {
          // no-op
        },
        onTransition: () => {
          // no-op
        },
      });

      const originalPayload = { userId: '123', action: 'process' };
      const task: ScheduledTaskLike = {
        id: 'task-1',
        name: 'some-task',
        schedule: '0 22 * * *',
        payload: originalPayload,
      };

      dispatch(task);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(queuedEvent).toBeDefined();
      expect(queuedEvent!.payload).toEqual(originalPayload);
    });
  });

  describe('all sleep task names', () => {
    const sleepTaskNames = ['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis'];

    for (const taskName of sleepTaskNames) {
      it(`should dispatch ${taskName} even while sleeping`, async () => {
        const mockManager = createMockActivityManager({ isActive: false });
        let originalHandlerCalled = false;

        const dispatch = createActivityDispatch({
          activityManager: mockManager,
          originalHandler: () => {
            originalHandlerCalled = true;
          },
          onTransition: () => {
            // no-op
          },
        });

        const task: ScheduledTaskLike = {
          id: 'task-1',
          name: taskName,
          schedule: '0 2 * * *',
          payload: {},
        };

        dispatch(task);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(originalHandlerCalled).toBe(true);
        expect(mockManager.recordedQueue.length).toBe(0);
      });
    }
  });

  describe('all transition task names', () => {
    const transitionTaskNames = ['transition-to-sleep', 'transition-to-wake'];

    for (const taskName of transitionTaskNames) {
      it(`should call onTransition for ${taskName}`, async () => {
        const mockManager = createMockActivityManager({ isActive: false });
        let transitionHandlerCalled = false;
        let transitionTaskName = '';

        const dispatch = createActivityDispatch({
          activityManager: mockManager,
          originalHandler: () => {
            // no-op
          },
          onTransition: (task) => {
            transitionHandlerCalled = true;
            transitionTaskName = task.name;
          },
        });

        const task: ScheduledTaskLike = {
          id: 'task-1',
          name: taskName,
          schedule: '0 6 * * *',
          payload: {},
        };

        dispatch(task);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(transitionHandlerCalled).toBe(true);
        expect(transitionTaskName).toBe(taskName);
      });
    }
  });
});
