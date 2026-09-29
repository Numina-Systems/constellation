import {describe, expect, it} from 'bun:test';
import type {Pool} from 'pg';
import {PersistenceError} from '@/errors/index.js';
import {createPostgresProvider} from './postgres.ts';

// Minimal fake pool exercises the adapter boundary without opening a database.
function fakePool(query: (sql: string) => Promise<unknown>, clientQuery?: (sql: string) => Promise<unknown>): Pool {
  return {
    query: async (sql: string) => query(sql),
    connect: async () => ({
      query: async (sql: string) => clientQuery ? clientQuery(sql) : {rows: [], command: sql.trim().split(/\\s+/)[0]},
      release: () => {},
    }),
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

  it('wraps independent reconciliation query failures with sanitized SQL and cause', async () => {
    const commitError = new Error('commit acknowledgement lost');
    const independentError = new Error('reconciliation query failed');
    let clients = 0;
    const persistence = createPostgresProvider(
      {url: 'postgres://unit-test.invalid'},
      {
        poolFactory: () => ({
          query: async () => ({rows: []}),
          connect: async () => {
            clients += 1;
            const independent = clients > 1;
            return {
              query: async (sql: string) => {
                if (sql === 'COMMIT') throw commitError;
                if (independent) throw independentError;
                return {rows: [], command: sql.trim().split(/\\s+/)[0]};
              },
              release: () => {},
            };
          },
          end: async () => undefined,
        }) as unknown as Pool,
      },
    );
    let observedIndependentError: unknown;
    const outcome = await persistence.withTransactionOutcome!(async () => 'value', async (_outcome, queryIndependent) => {
      try {
        await queryIndependent('SELECT * FROM records WHERE token = $1', ['private-value']);
      } catch (error) {
        observedIndependentError = error;
      }
      return {truth: 'unknown' as const, error: new Error('reconciliation result unknown')};
    });
    expect(outcome.status).toBe('commit_unknown');
    expect(observedIndependentError).toBeInstanceOf(PersistenceError);
    expect(observedIndependentError).toMatchObject({context: {query: 'SELECT * FROM records WHERE token = $1'}, cause: independentError});
  });

  it('wraps transaction-control failures with sanitized SQL and cause', async () => {
    const beginError = new Error('begin failed');
    const persistence = createPostgresProvider(
      {url: 'postgres://unit-test.invalid'},
      {poolFactory: () => fakePool(async () => { throw new Error('unexpected pool query'); }, async (sql) => {
        if (sql === 'BEGIN') throw beginError;
        return {rows: [], command: sql.trim().split(/\\s+/)[0]};
      })},
    );
    await expect(persistence.withTransaction(async () => 'unused')).rejects.toMatchObject({
      code: 'QUERY_FAILED',
      context: {query: 'BEGIN'},
      cause: beginError,
    });
  });
});
