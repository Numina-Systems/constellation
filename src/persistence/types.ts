// pattern: Functional Core

import type {TransactionOutcome, TransactionReconciliation} from '@/contracts/outcomes.ts';

export type QueryFunction = <T extends Record<string, unknown>>(
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<Array<T>>;

export type TransactionScope = {
  readonly query: QueryFunction;
  readonly depth: number;
  readonly isOutermost: boolean;
  readonly isProvisional: boolean;
  /** Register publication work; nested scopes are forbidden from publishing. */
  readonly registerAfterCommit: (publication: () => void | Promise<void>) => void;
};

export type TransactionReconciler<TResult> = (
  outcome: TransactionOutcome<TResult>,
  query: QueryFunction,
) => Promise<void | TransactionReconciliation<TResult>>;

export type PersistenceProviderOptions = {
  readonly transactionFaults?: PostgresTransactionFaults;
};

export type PostgresTransactionFaults = {
  readonly beforeCommit?: () => Promise<void>;
  /** Test-only lost-ack seam: fail after the server has committed. */
  readonly afterCommit?: () => Promise<void>;
  /** Test-only command-tag seam for protocol-level commit validation. */
  readonly commitCommandTag?: 'COMMIT' | 'ROLLBACK';
  readonly beforeRollback?: () => Promise<void>;
  readonly afterRollback?: () => Promise<void>;
};

export interface PersistenceProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runMigrations(): Promise<void>;
  query: QueryFunction;
  withTransaction<T>(
    fn: (query: QueryFunction) => Promise<T>,
  ): Promise<T>;
  withTransactionOutcome?<T>(
    fn: (scope: TransactionScope) => Promise<T>,
    reconcile?: TransactionReconciler<T>,
  ): Promise<TransactionOutcome<T>>;
}
