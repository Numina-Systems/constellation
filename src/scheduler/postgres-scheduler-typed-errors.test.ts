import {describe, expect, it} from 'bun:test';
import {createPostgresScheduler} from './postgres-scheduler.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import {ConstellationError} from '@/errors/index.js';

const unusedPersistence = {
  query: async () => [],
} as unknown as PersistenceProvider;

describe('PostgreSQL scheduler typed errors', () => {
  it('rejects an invalid cron expression with a typed scheduler error', async () => {
    const scheduler = createPostgresScheduler(unusedPersistence, 'test-owner');

    await expect(scheduler.schedule({id: 'ignored', name: 'invalid', schedule: 'not cron', payload: {}}))
      .rejects.toBeInstanceOf(ConstellationError);
    await expect(scheduler.schedule({id: 'ignored', name: 'invalid', schedule: 'not cron', payload: {}}))
      .rejects.toMatchObject({
        code: 'INVALID_CRON_EXPRESSION',
        subsystem: 'scheduler',
        context: {schedule: 'not cron'},
        suggestion: 'provide a valid cron expression',
      });
  });
});
