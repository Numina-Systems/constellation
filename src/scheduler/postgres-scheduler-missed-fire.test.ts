import {describe, expect, it} from 'bun:test';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {SchedulerRow} from './types.ts';
import {createPostgresScheduler} from './postgres-scheduler.ts';

function dueRow(id: string): SchedulerRow {
  return {
    id,
    owner: 'test-owner',
    name: id,
    schedule: '* * * * *',
    payload: {},
    next_run_at: new Date(0),
    last_run_at: null,
    cancelled: false,
    created_at: new Date(0),
  };
}

function createPersistence(rows: ReadonlyArray<SchedulerRow>, updates: Array<string>): PersistenceProvider {
  return {
    query: async <T extends Record<string, unknown>>(sql: string): Promise<Array<T>> => {
      if (sql.includes('SELECT * FROM scheduled_tasks')) return [...rows] as unknown as Array<T>;
      if (sql.includes('UPDATE scheduled_tasks')) updates.push(sql);
      return [];
    },
  } as unknown as PersistenceProvider;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1000 && !predicate(); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

describe('PostgreSQL scheduler missed-fire safety', () => {
  it('leaves a failed task due so a later poll can retry it', async () => {
    const updates: Array<string> = [];
    let calls = 0;
    const scheduler = createPostgresScheduler(createPersistence([dueRow('failed-task')], updates), 'test-owner', {pollIntervalMs: 10});
    scheduler.onDue(() => { calls += 1; throw new Error('handler failed'); });
    scheduler.start();
    try {
      await waitFor(() => calls >= 2);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(updates).toHaveLength(0);
    } finally {
      scheduler.stop();
    }
  });

  it('does not update run state while its handler is still pending', async () => {
    const updates: Array<string> = [];
    const resolver: {resolve: (() => void) | null} = {resolve: null};
    let calls = 0;
    const handlerPending = new Promise<void>((resolve) => { resolver.resolve = resolve; });
    const scheduler = createPostgresScheduler(createPersistence([dueRow('slow-task')], updates), 'test-owner', {pollIntervalMs: 10});
    scheduler.onDue(() => { calls += 1; return handlerPending; });
    scheduler.start();
    try {
      await waitFor(() => calls === 1);
      expect(updates).toHaveLength(0);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(calls).toBe(1);
      expect(updates).toHaveLength(0);
      // Stop polling before resolving so no later tick can re-dispatch the
      // still-due mock row; the in-flight tick must still finish its update.
      scheduler.stop();
      resolver.resolve?.();
      await waitFor(() => updates.length === 1);
      expect(updates).toHaveLength(1);
      expect(updates[0]).toContain('last_run_at = NOW()');
    } finally {
      resolver.resolve?.();
      scheduler.stop();
    }
  });

  it('continues processing later tasks after a task handler rejects', async () => {
    const updates: Array<string> = [];
    const seen: Array<string> = [];
    const originalWarn = console.warn;
    console.warn = () => undefined;
    const scheduler = createPostgresScheduler(createPersistence([dueRow('bad-task'), dueRow('good-task')], updates), 'test-owner');
    scheduler.onDue((task) => {
      seen.push(task.id);
      if (task.id === 'bad-task') throw new Error('expected failure');
    });
    scheduler.start();
    try {
      await waitFor(() => updates.length >= 1);
      expect(seen.slice(0, 2)).toEqual(['bad-task', 'good-task']);
      expect(updates.length).toBeGreaterThanOrEqual(1);
    } finally {
      scheduler.stop();
      console.warn = originalWarn;
    }
  });

  it('delays the first poll by pollOffsetMs without a database', async () => {
    const updates: Array<string> = [];
    let selects = 0;
    const base = createPersistence([], updates);
    const persistence = {
      ...base,
      query: async <T extends Record<string, unknown>>(sql: string): Promise<Array<T>> => {
        if (sql.includes('SELECT * FROM scheduled_tasks')) selects += 1;
        return [];
      },
    } as PersistenceProvider;
    const scheduler = createPostgresScheduler(persistence, 'test-owner', {pollOffsetMs: 40});
    scheduler.start();
    try {
      expect(selects).toBe(0);
      await waitFor(() => selects > 0);
      expect(selects).toBeGreaterThan(0);
    } finally {
      scheduler.stop();
    }
  });
});
