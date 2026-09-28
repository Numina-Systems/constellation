import {describe, expect, it} from 'bun:test';
import type {Pool} from 'pg';
import {PersistenceError} from '@/errors/index.js';
import {createPostgresProvider} from './postgres.ts';

// Minimal fake pool exercises the adapter boundary without opening a database.
function fakePool(query: (sql: string) => Promise<never>): Pool {
  return {
    query: async (sql: string) => query(sql),
    connect: async () => { throw new Error('unexpected connect'); },
    end: async () => undefined,
  } as unknown as Pool;
}

describe('PostgreSQL typed failures', () => {
  it('wraps driver query failures with sanitized query context and preserves the cause', async () => {
    const driverError = new Error('driver rejected query');
    const persistence = createPostgresProvider(
      {url: 'postgres://unit-test.invalid'},
      {poolFactory: () => fakePool(async () => { throw driverError; })},
    );

    await expect(
      persistence.query('SELECT secret FROM accounts WHERE token = $1', ['secret-value']),
    ).rejects.toMatchObject({
      code: 'QUERY_FAILED',
      subsystem: 'persistence',
      context: {query: 'SELECT secret FROM accounts WHERE token = $1'},
      cause: driverError,
    });
    await expect(
      persistence.query('SELECT secret FROM accounts WHERE token = $1', ['secret-value']),
    ).rejects.toBeInstanceOf(PersistenceError);
  });
});
