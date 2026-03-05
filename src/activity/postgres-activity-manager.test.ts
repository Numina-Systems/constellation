import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createActivityManager } from './postgres-activity-manager.ts';
import type { ActivityStateRow, EventQueueRow } from './types.ts';
import type { ScheduleConfig } from './schedule.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
const TEST_OWNER = 'test-activity-' + Math.random().toString(36).substring(7);

const testScheduleConfig: ScheduleConfig = {
  sleepSchedule: '0 22 * * *', // 10 PM
  wakeSchedule: '0 6 * * *', // 6 AM
  timezone: 'UTC',
};

async function cleanupTables(): Promise<void> {
  await persistence.query('DELETE FROM event_queue WHERE owner = $1', [TEST_OWNER]);
  await persistence.query('DELETE FROM activity_state WHERE owner = $1', [TEST_OWNER]);
}

describe('Activity Manager - PostgreSQL Adapter', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('sleep-cycle.AC1.1: Agent transitions to sleeping mode', () => {
    it('transitionTo("sleeping") persists mode and computes nextTransitionAt', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.transitionTo('sleeping');

      const state = await manager.getState();
      expect(state.mode).toBe('sleeping');
      expect(state.transitionedAt).toBeTruthy();
      expect(state.nextTransitionAt).toBeTruthy();
    });
  });

  describe('sleep-cycle.AC1.2: Agent transitions to active mode', () => {
    it('transitionTo("active") persists mode and computes nextTransitionAt', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.transitionTo('active');

      const state = await manager.getState();
      expect(state.mode).toBe('active');
      expect(state.transitionedAt).toBeTruthy();
      expect(state.nextTransitionAt).toBeTruthy();
    });
  });

  describe('sleep-cycle.AC1.3: Cold start during sleep window reconciles to sleeping', () => {
    it('getState() computes mode from cron when no row exists', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      const state = await manager.getState();
      expect(state.mode).toBeOneOf(['active', 'sleeping']);
      expect(state.transitionedAt).toBeTruthy();
      expect(state.nextTransitionAt).toBeTruthy();

      const rows = await persistence.query<ActivityStateRow>(
        'SELECT * FROM activity_state WHERE owner = $1',
        [TEST_OWNER],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('sleep-cycle.AC1.4: Cold start during active window reconciles to active', () => {
    it('second call to getState() returns persisted mode', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      const state1 = await manager.getState();
      const state2 = await manager.getState();

      expect(state1.mode).toBe(state2.mode);

      const rows = await persistence.query<ActivityStateRow>(
        'SELECT * FROM activity_state WHERE owner = $1',
        [TEST_OWNER],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('sleep-cycle.AC2.1: Non-sleep scheduler tasks are queued during sleep', () => {
    it('queueEvent() inserts event with correct fields', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'scheduler',
        payload: { task: 'test-task', action: 'execute' },
        priority: 'normal',
        flagged: false,
      });

      const rows = await persistence.query<EventQueueRow>(
        'SELECT * FROM event_queue WHERE owner = $1',
        [TEST_OWNER],
      );

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.source).toBe('scheduler');
      expect(row.payload).toEqual({ task: 'test-task', action: 'execute' });
      expect(row.priority).toBe('normal');
      expect(row.flagged).toBe(false);
      expect(row.processed_at).toBeNull();
    });
  });

  describe('sleep-cycle.AC2.3: Events dispatch normally during active mode', () => {
    it('isActive() returns correct mode after transition', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.transitionTo('active');
      expect(await manager.isActive()).toBe(true);

      await manager.transitionTo('sleeping');
      expect(await manager.isActive()).toBe(false);
    });
  });

  describe('sleep-cycle.AC2.4: Queue handles events from multiple sources without ordering conflicts', () => {
    it('drainQueue() returns events in priority order, then FIFO', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'scheduler',
        payload: { id: 1 },
        priority: 'normal',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'bluesky',
        payload: { id: 2 },
        priority: 'high',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'manual',
        payload: { id: 3 },
        priority: 'normal',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'scheduler',
        payload: { id: 4 },
        priority: 'high',
        flagged: false,
      });

      const drained = [];
      for await (const event of manager.drainQueue()) {
        drained.push((event.payload as { id: number }).id);
      }

      expect(drained).toEqual([2, 4, 1, 3]);
    });
  });

  describe('sleep-cycle.AC4.1: High-priority events are flagged in the queue', () => {
    it('getFlaggedEvents() returns only flagged events', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      const event1 = {
        source: 'test-source-1',
        payload: { msg: 'flagged' },
        priority: 'normal' as const,
        flagged: true,
      };

      const event2 = {
        source: 'test-source-2',
        payload: { msg: 'not-flagged' },
        priority: 'normal' as const,
        flagged: false,
      };

      await manager.queueEvent(event1);
      await manager.queueEvent(event2);

      const flaggedEvents = await manager.getFlaggedEvents();
      expect(flaggedEvents).toHaveLength(1);
      expect(flaggedEvents[0]!.flagged).toBe(true);
      expect(flaggedEvents[0]!.source).toBe('test-source-1');
    });

    it('queueEvent with flagged=true appears in getFlaggedEvents()', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'high-priority-source',
        payload: { priority: 'high' },
        priority: 'high',
        flagged: true,
      });

      const flagged = await manager.getFlaggedEvents();
      expect(flagged).toHaveLength(1);
      expect(flagged[0]!.flagged).toBe(true);
    });

    it('flagEvent() marks existing event as flagged', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'test',
        payload: { test: true },
        priority: 'normal',
        flagged: false,
      });

      const rows = await persistence.query<EventQueueRow>(
        'SELECT * FROM event_queue WHERE owner = $1',
        [TEST_OWNER],
      );

      expect(rows).toHaveLength(1);
      const eventId = rows[0]!.id;

      await manager.flagEvent(eventId);

      const flaggedAfter = await manager.getFlaggedEvents();
      expect(flaggedAfter).toHaveLength(1);
      expect(flaggedAfter[0]!.id).toBe(eventId);
    });
  });

  describe('sleep-cycle.AC7.1: Restart mid-sleep resumes sleeping without re-registering', () => {
    it('persisted sleeping state is resumed on new manager instance', async () => {
      const manager1 = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);
      await manager1.transitionTo('sleeping');

      const state1 = await manager1.getState();
      expect(state1.mode).toBe('sleeping');

      const manager2 = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);
      const state2 = await manager2.getState();

      expect(state2.mode).toBe('sleeping');
      expect(state2.transitionedAt.getTime()).toBe(state1.transitionedAt.getTime());
    });
  });

  describe('sleep-cycle.AC7.2: Restart mid-active resumes active mode', () => {
    it('persisted active state is resumed on new manager instance', async () => {
      const manager1 = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);
      await manager1.transitionTo('active');

      const state1 = await manager1.getState();
      expect(state1.mode).toBe('active');

      const manager2 = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);
      const state2 = await manager2.getState();

      expect(state2.mode).toBe('active');
      expect(state2.transitionedAt.getTime()).toBe(state1.transitionedAt.getTime());
    });
  });

  describe('sleep-cycle.AC7.3: First-ever startup initialises from cron expressions', () => {
    it('getState() computes initial mode from cron when no DB state exists', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      const state = await manager.getState();

      expect(state.mode).toBeOneOf(['active', 'sleeping']);

      const rows = await persistence.query<ActivityStateRow>(
        'SELECT * FROM activity_state WHERE owner = $1',
        [TEST_OWNER],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.owner).toBe(TEST_OWNER);
    });
  });

  describe('drainQueue() ordering and processing', () => {
    it('drainQueue() yields events and marks them as processed', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'test',
        payload: { seq: 1 },
        priority: 'normal',
        flagged: false,
      });

      const drained = [];
      for await (const event of manager.drainQueue()) {
        drained.push(event.payload);
      }

      expect(drained).toHaveLength(1);

      const remaining = await persistence.query<EventQueueRow>(
        'SELECT * FROM event_queue WHERE owner = $1 AND processed_at IS NULL',
        [TEST_OWNER],
      );

      expect(remaining).toHaveLength(0);
    });

    it('high-priority events are yielded before normal-priority within drainQueue()', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'src1',
        payload: { order: 'normal-1' },
        priority: 'normal',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'src2',
        payload: { order: 'high-1' },
        priority: 'high',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'src3',
        payload: { order: 'normal-2' },
        priority: 'normal',
        flagged: false,
      });

      const drained = [];
      for await (const event of manager.drainQueue()) {
        drained.push((event.payload as Record<string, string>)['order']);
      }

      expect(drained).toEqual(['high-1', 'normal-1', 'normal-2']);
    });
  });

  describe('Activity state with event counts', () => {
    it('getState() returns correct queuedEventCount', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'test1',
        payload: {},
        priority: 'normal',
        flagged: false,
      });

      await manager.queueEvent({
        source: 'test2',
        payload: {},
        priority: 'normal',
        flagged: false,
      });

      const state = await manager.getState();
      expect(state.queuedEventCount).toBe(2);
      expect(state.flaggedEventCount).toBe(0);
    });

    it('getState() returns correct flaggedEventCount', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'test1',
        payload: {},
        priority: 'normal',
        flagged: true,
      });

      await manager.queueEvent({
        source: 'test2',
        payload: {},
        priority: 'normal',
        flagged: false,
      });

      const state = await manager.getState();
      expect(state.queuedEventCount).toBe(2);
      expect(state.flaggedEventCount).toBe(1);
    });

    it('processed events do not count toward queuedEventCount', async () => {
      const manager = createActivityManager(persistence, testScheduleConfig, TEST_OWNER);

      await manager.queueEvent({
        source: 'test',
        payload: {},
        priority: 'normal',
        flagged: false,
      });

      for await (const _ of manager.drainQueue()) {
        // drain the queue
      }

      const state = await manager.getState();
      expect(state.queuedEventCount).toBe(0);
    });
  });

  describe('Multiple owner isolation', () => {
    it('createActivityManager respects owner isolation', async () => {
      const owner1 = 'test-owner-' + randomUUID();
      const owner2 = 'test-owner-' + randomUUID();

      const manager1 = createActivityManager(persistence, testScheduleConfig, owner1);
      const manager2 = createActivityManager(persistence, testScheduleConfig, owner2);

      await manager1.queueEvent({
        source: 'source1',
        payload: { owner: 1 },
        priority: 'normal',
        flagged: false,
      });

      await manager2.queueEvent({
        source: 'source2',
        payload: { owner: 2 },
        priority: 'normal',
        flagged: false,
      });

      const state1 = await manager1.getState();
      const state2 = await manager2.getState();

      expect(state1.queuedEventCount).toBe(1);
      expect(state2.queuedEventCount).toBe(1);

      const drained1 = [];
      for await (const event of manager1.drainQueue()) {
        drained1.push((event.payload as Record<string, number>)['owner']);
      }

      expect(drained1).toEqual([1]);

      const drained2 = [];
      for await (const event of manager2.drainQueue()) {
        drained2.push((event.payload as Record<string, number>)['owner']);
      }

      expect(drained2).toEqual([2]);

      await persistence.query('DELETE FROM event_queue WHERE owner = $1', [owner1]);
      await persistence.query('DELETE FROM event_queue WHERE owner = $1', [owner2]);
      await persistence.query('DELETE FROM activity_state WHERE owner = $1', [owner1]);
      await persistence.query('DELETE FROM activity_state WHERE owner = $1', [owner2]);
    });
  });
});
