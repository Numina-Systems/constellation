// pattern: Imperative Shell

import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Pool} from 'pg';
import type {PoolClient, QueryResultRow, QueryResult} from 'pg';
import type {DatabaseConfig} from '../config/config.ts';
import type {
  PersistenceProvider,
  PersistenceProviderOptions,
  PostgresTransactionFaults,
  QueryFunction,
  TransactionReconciler,
  TransactionScope,
} from './types.ts';
import type {TransactionOutcome, TransactionReconciliation} from '@/contracts/outcomes.ts';

type TxContext = {
  readonly client: PoolClient;
  readonly depth: number;
  readonly publications: Array<() => void | Promise<void>>;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRollbackResult(result: QueryResult<QueryResultRow>): boolean {
  return result.command === 'ROLLBACK';
}

export function createPostgresProvider(
  config: DatabaseConfig,
  options?: Readonly<PersistenceProviderOptions>,
): PersistenceProvider {
  const pool = new Pool({connectionString: config.url});
  const txStorage = new AsyncLocalStorage<TxContext>();
  const faults: PostgresTransactionFaults = options?.transactionFaults ?? {};

  async function connect(): Promise<void> {
    const client = await pool.connect();
    client.release();
  }

  async function disconnect(): Promise<void> {
    await pool.end();
  }

  async function runMigrations(): Promise<void> {
    const migrationsDir = resolve(import.meta.dir, 'migrations');
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    const client = await pool.connect();
    let clientIsBroken = false;
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const applied = await client.query<{name: string}>('SELECT name FROM schema_migrations ORDER BY name');
      const appliedSet = new Set(applied.rows.map((row) => row.name));
      for (const file of files) {
        if (appliedSet.has(file)) continue;
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (error) {
          // A failed COMMIT has unknown truth. Never issue ROLLBACK on that path.
          if (isCommitAttemptError(error)) {
            clientIsBroken = true;
            throw new Error('migrate stage: commit acknowledgement is unknown', {cause: error});
          }
          try {
            const rollbackResult = await client.query('ROLLBACK');
            if (!isRollbackResult(rollbackResult)) clientIsBroken = true;
          } catch {
            clientIsBroken = true;
          }
          throw error;
        }
      }
    } finally {
      client.release(clientIsBroken);
    }
  }

  async function query<T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> {
    const context = txStorage.getStore();
    const result = context
      ? await context.client.query<QueryResultRow>(sql, params as Array<unknown>)
      : await pool.query<QueryResultRow>(sql, params as Array<unknown>);
    return result.rows as Array<T>;
  }

  async function queryOnIndependentConnection<T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> {
    const client = await pool.connect();
    try {
      const result = await client.query<QueryResultRow>(sql, params as Array<unknown>);
      return result.rows as Array<T>;
    } finally {
      client.release();
    }
  }

  async function rollback(client: PoolClient): Promise<void> {
    await faults.beforeRollback?.();
    const result = await client.query('ROLLBACK');
    if (!isRollbackResult(result)) throw new Error(`rollback returned unexpected command tag: ${result.command}`);
    await faults.afterRollback?.();
  }

  async function withNestedTransaction<T>(
    parent: TxContext,
    fn: (scope: TransactionScope) => Promise<T>,
  ): Promise<TransactionOutcome<T>> {
    const depth = parent.depth + 1;
    const savepoint = `sp_${depth}`;
    await parent.client.query(`SAVEPOINT ${savepoint}`);
    const context: TxContext = {...parent, depth};
    const scope: TransactionScope = {
      query,
      depth,
      isOutermost: false,
      isProvisional: true,
      registerAfterCommit: () => {
        throw new Error('nested transaction scope cannot publish or reconcile');
      },
    };
    try {
      const value = await txStorage.run(context, () => fn(scope));
      await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return {status: 'provisional', value};
    } catch (error) {
      try {
        await parent.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch {
        // Preserve the callback's original error; the outer transaction remains responsible for rollback.
      }
      throw error;
    }
  }

  function combineReconciliationError(rootError: unknown, reconciliationError: unknown): Error {
    const root = asError(rootError);
    const reconciliation = asError(reconciliationError);
    return new AggregateError(
      [root, reconciliation],
      `${root.message}; reconciliation failed: ${reconciliation.message}`,
    );
  }

  function applyReconciliation<T>(
    outcome: TransactionOutcome<T>,
    reconciliation: TransactionReconciliation<T>,
  ): TransactionOutcome<T> {
    if (reconciliation.truth === 'committed') {
      if (outcome.status === 'confirmed_commit') return outcome;
      if (outcome.status !== 'commit_unknown') return outcome;
      if (reconciliation.value === undefined) {
        return {status: 'commit_unknown', error: new Error('reconciliation confirmed commit without a durable value', {cause: outcome.error}), value: outcome.value};
      }
      return {
        status: 'reconciled_commit',
        value: reconciliation.value,
        error: outcome.error,
      };
    }
    if (reconciliation.truth === 'rolled_back') {
      if (outcome.status === 'confirmed_commit') {
        return {
          status: 'commit_unknown',
          error: new Error('post-commit reconciliation contradicted confirmed commit'),
          value: outcome.value,
        };
      }
      if (outcome.status !== 'commit_unknown') return outcome;
      return {status: 'reconciled_rollback', error: reconciliation.error ?? outcome.error};
    }
    if (outcome.status !== 'commit_unknown') return outcome;
    return {
      status: 'commit_unknown',
      error: combineReconciliationError(outcome.error, reconciliation.error),
      value: outcome.value,
    };
  }

  async function withTransactionOutcome<T>(
    fn: (scope: TransactionScope) => Promise<T>,
    reconcile?: TransactionReconciler<T>,
  ): Promise<TransactionOutcome<T>> {
    const existing = txStorage.getStore();
    if (existing) return withNestedTransaction(existing, fn);

    const client = await pool.connect();
    const publications: Array<() => void | Promise<void>> = [];
    let clientReleased = false;
    let clientIsBroken = false;
    let value: T;
    try {
      await client.query('BEGIN');
      const context: TxContext = {client, depth: 0, publications};
      const scope: TransactionScope = {
        query,
        depth: 0,
        isOutermost: true,
        isProvisional: false,
        registerAfterCommit: (publication) => { publications.push(publication); },
      };
      try {
        value = await txStorage.run(context, () => fn(scope));
      } catch (error) {
        try {
          await rollback(client);
        } catch (rollbackError) {
          clientIsBroken = true;
          return {status: 'commit_unknown', error: new Error('transaction rollback acknowledgement is unknown', {cause: rollbackError})};
        }
        return {status: 'confirmed_rollback', error};
      }
      try {
        await faults.beforeCommit?.();
      } catch (error) {
        try {
          await rollback(client);
        } catch (rollbackError) {
          clientIsBroken = true;
          return {status: 'commit_unknown', error: new Error('transaction rollback acknowledgement is unknown', {cause: rollbackError})};
        }
        return {status: 'confirmed_rollback', error};
      }
      try {
        const commitResult = await client.query('COMMIT');
        const commitCommand = faults.commitCommandTag ?? commitResult.command;
        if (commitCommand !== 'COMMIT') {
          clientIsBroken = true;
          if (commitCommand === 'ROLLBACK') {
            client.release(true);
            clientReleased = true;
            return {status: 'confirmed_rollback', error: new Error('commit returned ROLLBACK command tag')};
          }
          const protocolError = new Error(`commit returned unexpected command tag: ${commitCommand}`);
          const unknown: TransactionOutcome<T> = {status: 'commit_unknown', error: protocolError, value};
          client.release(true);
          clientReleased = true;
          if (!reconcile) return unknown;
          try {
            const result = await reconcile(unknown, queryOnIndependentConnection);
            return result ? applyReconciliation(unknown, result) : unknown;
          } catch (reconciliationError) {
            return {status: 'commit_unknown', error: combineReconciliationError(protocolError, reconciliationError), value};
          }
        }
      } catch (error) {
        clientIsBroken = true;
        const unknown: TransactionOutcome<T> = {status: 'commit_unknown', error, value};
        client.release(true);
        clientReleased = true;
        if (!reconcile) return unknown;
        try {
          const result = await reconcile(unknown, queryOnIndependentConnection);
          return result ? applyReconciliation(unknown, result) : unknown;
        } catch (reconciliationError) {
          return {status: 'commit_unknown', error: combineReconciliationError(error, reconciliationError), value};
        }
      }
      let outcome: TransactionOutcome<T> = {status: 'confirmed_commit', value};
      try {
        await faults.afterCommit?.();
      } catch (error) {
        clientIsBroken = true;
        client.release(true);
        clientReleased = true;
        const unknown: TransactionOutcome<T> = {status: 'commit_unknown', error, value};
        if (!reconcile) return unknown;
        try {
          const result = await reconcile(unknown, queryOnIndependentConnection);
          if (result) outcome = applyReconciliation(unknown, result);
          else return unknown;
        } catch (reconciliationError) {
          return {status: 'commit_unknown', error: combineReconciliationError(error, reconciliationError), value};
        }
      }
      if (!clientReleased) {
        client.release();
        clientReleased = true;
      }
      if (outcome.status === 'confirmed_commit' || outcome.status === 'reconciled_commit') {
        if (reconcile && outcome.status === 'confirmed_commit') {
          try {
            const reconciliation = await reconcile(outcome, queryOnIndependentConnection);
            if (reconciliation?.truth === 'rolled_back') {
              return {status: 'commit_unknown', error: new Error('post-commit reconciliation contradicted confirmed commit'), value: outcome.value};
            }
            if (reconciliation?.truth === 'unknown') {
              return {status: 'commit_unknown', error: reconciliation.error, value: outcome.value};
            }
          } catch (error) {
            return {status: 'commit_unknown', error, value: outcome.value};
          }
        }
        for (const [index, publication] of publications.entries()) {
          try {
            await publication();
          } catch (error) {
            return {
              status: 'committed_publication_failed',
              value: outcome.value,
              error,
              details: {attempted: index + 1, skipped: publications.length - index - 1},
            };
          }
        }
      }
      return outcome;
    } finally {
      if (!clientReleased) client.release(clientIsBroken);
    }
  }

  async function withTransaction<T>(fn: (queryFn: QueryFunction) => Promise<T>): Promise<T> {
    const outcome = await withTransactionOutcome(async (scope) => fn(scope.query));
    if (outcome.status === 'confirmed_commit' || outcome.status === 'reconciled_commit' || outcome.status === 'provisional') return outcome.value;
    throw asError(outcome.error);
  }

  return {connect, disconnect, runMigrations, query, withTransaction, withTransactionOutcome};
}

function isCommitAttemptError(error: unknown): boolean {
  return error instanceof Error && /commit|acknowledg|connection|closed|timeout/i.test(error.message);
}
