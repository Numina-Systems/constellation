import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {createPostgresProvider} from './postgres.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import type {PersistenceProvider} from './types.ts';

let database: TestDatabase;
let provider: PersistenceProvider;

async function readMarker(): Promise<Array<{readonly value: string}>> {
  return provider.query<{value: string}>('SELECT value FROM phase0_ac21_markers ORDER BY value');
}

describe('Phase 0 AC.21 real PostgreSQL transaction boundary', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    provider = database.persistence;
    await provider.query('CREATE TABLE phase0_ac21_markers (value TEXT NOT NULL)');
  });

  afterAll(async () => {
    if (database) await teardownTestDatabase(database);
  });

  it('isolates provider-scoped transaction context', async () => {
    const other = createPostgresProvider({url: database.url});
    await other.connect();
    try {
      await provider.withTransaction(async (query) => {
        await query('INSERT INTO phase0_ac21_markers (value) VALUES ($1)', ['uncommitted']);
        expect(await other.query('SELECT value FROM phase0_ac21_markers WHERE value = $1', ['uncommitted'])).toEqual([]);
      });
    } finally {
      await other.disconnect();
    }
  });

  it('nested provisional work is not published after outer rollback', async () => {
    const publications: Array<string> = [];
    const result = await provider.withTransactionOutcome!(async (outer) => {
      outer.registerAfterCommit(() => { publications.push('published'); });
      const nested = await provider.withTransactionOutcome!(async (inner) => {
        await inner.query('INSERT INTO phase0_ac21_markers (value) VALUES ($1)', ['nested']);
        return 'nested';
      });
      expect(nested.status).toBe('provisional');
      throw new Error('outer rollback');
    });
    expect(result.status).toBe('confirmed_rollback');
    expect(publications).toEqual([]);
    expect(await readMarker()).toEqual([]);
  });

  it('caught SQL abort followed by rollback-tagged COMMIT is confirmed rollback', async () => {
    const faulty = createPostgresProvider({url: database.url}, {transactionFaults: {commitCommandTag: 'ROLLBACK'}});
    const result = await faulty.withTransactionOutcome!(async (scope) => {
      try { await scope.query('SELECT * FROM phase0_ac21_missing'); } catch { /* intentional swallowed SQL failure */ }
      return 'value';
    });
    expect(result.status).toBe('confirmed_rollback');
    await faulty.disconnect();
  });

  it('beforeCommit fault rolls back', async () => {
    const faulty = createPostgresProvider({url: database.url}, {transactionFaults: {beforeCommit: async () => { throw new Error('before commit'); }}});
    const result = await faulty.withTransactionOutcome!(async (scope) => {
      await scope.query('INSERT INTO phase0_ac21_markers (value) VALUES ($1)', ['before-commit']);
      return 'value';
    });
    expect(result.status).toBe('confirmed_rollback');
    await faulty.disconnect();
    expect(await readMarker()).toEqual([]);
  });

  it('afterCommit lost acknowledgement reconciles durable commit', async () => {
    let faulty: PersistenceProvider | null = createPostgresProvider({url: database.url}, {transactionFaults: {afterCommit: async () => { throw new Error('lost acknowledgement'); }}});
    const result = await faulty.withTransactionOutcome!(async (scope) => {
      await scope.query('INSERT INTO phase0_ac21_markers (value) VALUES ($1)', ['after-commit']);
      return 'value';
    }, async (_outcome, independentQuery) => {
      const rows = await independentQuery<{value: string}>('SELECT value FROM phase0_ac21_markers WHERE value = $1', ['after-commit']);
      return rows.length > 0 ? {truth: 'committed'} : {truth: 'rolled_back'};
    });
    expect(result.status).toBe('reconciled_commit');
    await faulty.disconnect();
    faulty = null;
  });

  it('reconciliation unavailable is fail closed', async () => {
    const faulty = createPostgresProvider({url: database.url}, {transactionFaults: {afterCommit: async () => { throw new Error('lost acknowledgement'); }}});
    const result = await faulty.withTransactionOutcome!(async () => 'value', async () => { throw new Error('reconciliation unavailable'); });
    expect(result.status).toBe('commit_unknown');
    if (result.status === 'commit_unknown') expect(String(result.error)).toContain('lost acknowledgement');
    await faulty.disconnect();
  });

  it('publication failure reports committed_publication_failed', async () => {
    const result = await provider.withTransactionOutcome!(async (scope) => {
      scope.registerAfterCommit(() => { throw new Error('publication failed'); });
      return 'value';
    });
    expect(result.status).toBe('committed_publication_failed');
  });
});
