/**
 * Tests for the default scheduled-task registration extracted from main().
 * Verifies idempotency per task name, cron computation, gating conditions,
 * and the pre-start versus post-start task sets.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { registerPreStartSystemTasks, registerPostStartSystemTasks } from './task-registration.ts';
import type { PreStartTaskRegistrationDeps } from './task-registration.ts';
import { buildImpulseCron, buildIntrospectionCron } from '@/subconscious';
import { sleepTaskCron } from '@/activity/index.ts';
import type { ScheduleConfig } from '@/activity/index.ts';
import type { PersistenceProvider, QueryFunction } from '@/persistence/types';
import type { Scheduler, ScheduledTask } from '@/scheduler';

const originalLog = console.log;
let quietLog: ReturnType<typeof mock>;

beforeEach(() => {
  quietLog = mock((_msg?: unknown) => {});
  console.log = quietLog;
});

afterEach(() => {
  console.log = originalLog;
});

function createMockPersistence(existingTaskNames: ReadonlyArray<string> = []) {
  const queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    queries.push({ sql, params: params ?? [] });
    const name = params?.[1];
    if (typeof name === 'string' && existingTaskNames.includes(name)) {
      // Test double: synthesize an existing row for the queried task name.
      return [{ id: `existing-${name}` }] as unknown as Array<T>;
    }
    return [];
  };
  const persistence: PersistenceProvider = {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    runMigrations: mock(async () => {}),
    query,
    withTransaction: async <T>(fn: (q: QueryFunction) => Promise<T>): Promise<T> => fn(query),
  };
  return { persistence, queries };
}

function createMockScheduler() {
  const scheduled: Array<ScheduledTask> = [];
  const scheduler: Scheduler = {
    schedule: mock(async (task: ScheduledTask) => {
      scheduled.push(task);
      return { id: task.id, nextRunAt: new Date() };
    }),
    cancel: mock(async () => {}),
    onDue: () => {},
  };
  return { scheduler, scheduled };
}

const activitySchedule: ScheduleConfig = {
  sleepSchedule: '0 22 * * *',
  wakeSchedule: '0 6 * * *',
  timezone: 'America/New_York',
};

describe('registerPreStartSystemTasks', () => {
  it('schedules the hourly review job when absent', async () => {
    const { persistence, queries } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();
    const deps: PreStartTaskRegistrationDeps = {
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      hasImpulse: false,
      hasIntrospection: false,
    };

    await registerPreStartSystemTasks(deps);

    expect(scheduled).toEqual([
      expect.objectContaining({
        name: 'review-predictions',
        schedule: '0 * * * *',
        payload: { type: 'prediction-review' },
      }),
    ]);
    expect(queries[0]!.params).toEqual(['system', 'review-predictions']);
    expect(quietLog).toHaveBeenCalledWith('review job scheduled (hourly)');
  });

  it('does not reschedule an existing review job', async () => {
    const { persistence } = createMockPersistence(['review-predictions']);
    const { scheduler, scheduled } = createMockScheduler();

    await registerPreStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      hasImpulse: false,
      hasIntrospection: false,
    });

    expect(scheduled).toEqual([]);
    expect(quietLog).toHaveBeenCalledWith('review job already scheduled');
  });

  it('registers impulse and introspection with computed crons when configured', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPreStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      hasImpulse: true,
      hasIntrospection: true,
      impulseIntervalMinutes: 45,
      introspectionOffsetMinutes: 7,
    });

    expect(scheduled.map((task) => task.name)).toEqual([
      'review-predictions',
      'subconscious-impulse',
      'subconscious-introspection',
    ]);
    expect(scheduled[1]!.schedule).toBe(buildImpulseCron(45));
    expect(scheduled[1]!.payload).toEqual({ taskType: 'impulse' });
    expect(scheduled[2]!.schedule).toBe(buildIntrospectionCron(45, 7));
    expect(scheduled[2]!.payload).toEqual({ taskType: 'introspection' });
  });

  it('skips impulse and introspection when gating or interval is absent', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPreStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      hasImpulse: true,
      hasIntrospection: false,
      // impulseIntervalMinutes omitted
    });

    expect(scheduled.map((task) => task.name)).toEqual(['review-predictions']);
  });
});

describe('registerPostStartSystemTasks', () => {
  it('registers archivist tasks before the five activity tasks, with computed crons', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPostStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      archivistEnabled: true,
      activityScheduleConfig: activitySchedule,
    });

    expect(scheduled.map((task) => task.name)).toEqual([
      'archivist-incremental',
      'sleep-archivist',
      'transition-to-sleep',
      'transition-to-wake',
      'sleep-compaction',
      'sleep-prediction-review',
      'sleep-pattern-analysis',
    ]);
    expect(scheduled[0]!.schedule).toBe('0 */3 * * *');
    expect(scheduled[1]!.schedule).toBe(sleepTaskCron('0 22 * * *', 3, 'America/New_York'));
    expect(scheduled.find((task) => task.name === 'sleep-compaction')!.schedule)
      .toBe(sleepTaskCron('0 22 * * *', 2, 'America/New_York'));
    expect(scheduled.find((task) => task.name === 'sleep-prediction-review')!.schedule)
      .toBe(sleepTaskCron('0 22 * * *', 4, 'America/New_York'));
    expect(scheduled.find((task) => task.name === 'sleep-pattern-analysis')!.schedule)
      .toBe(sleepTaskCron('0 22 * * *', 6, 'America/New_York'));
    expect(scheduled.find((task) => task.name === 'transition-to-sleep')!.payload)
      .toEqual({ type: 'activity', sleepTask: true });
    expect(quietLog).toHaveBeenCalledWith('[activity] all activity tasks registered');
  });

  it('honors incremental cron and sleep offset overrides', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPostStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      archivistEnabled: true,
      incrementalCron: '15 */2 * * *',
      sleepOffsetHours: 5,
      activityScheduleConfig: activitySchedule,
    });

    expect(scheduled[0]!.schedule).toBe('15 */2 * * *');
    expect(scheduled[1]!.schedule).toBe(sleepTaskCron('0 22 * * *', 5, 'America/New_York'));
  });

  it('skips archivist tasks when the archivist is disabled but still registers activity tasks', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPostStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      archivistEnabled: false,
      activityScheduleConfig: activitySchedule,
    });

    expect(scheduled.map((task) => task.name)).toEqual([
      'transition-to-sleep',
      'transition-to-wake',
      'sleep-compaction',
      'sleep-prediction-review',
      'sleep-pattern-analysis',
    ]);
  });

  it('skips sleep-archivist and activity tasks when the activity config is null', async () => {
    const { persistence } = createMockPersistence();
    const { scheduler, scheduled } = createMockScheduler();

    await registerPostStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      archivistEnabled: true,
      activityScheduleConfig: null,
    });

    expect(scheduled.map((task) => task.name)).toEqual(['archivist-incremental']);
  });

  it('does not reschedule existing tasks and logs nothing for already-registered activity tasks', async () => {
    const { persistence } = createMockPersistence(['transition-to-sleep', 'archivist-incremental']);
    const { scheduler, scheduled } = createMockScheduler();

    await registerPostStartSystemTasks({
      persistence,
      systemScheduler: scheduler,
      owner: 'system',
      archivistEnabled: true,
      activityScheduleConfig: activitySchedule,
    });

    expect(scheduled.map((task) => task.name)).not.toContain('transition-to-sleep');
    expect(scheduled.map((task) => task.name)).not.toContain('archivist-incremental');
    expect(quietLog).toHaveBeenCalledWith('archivist incremental task already scheduled');
    for (const call of quietLog.mock.calls) {
      expect(String(call[0])).not.toContain('registered task: transition-to-sleep');
    }
  });
});
