import {describe, expect, it} from 'bun:test';
import {createInMemoryPersistence} from '@/testing/ports.ts';

describe('Phase0/AC21 transaction contracts', () => {
  it('transaction_context_does_not_cross_provider_instances', async () => {
    const first = createInMemoryPersistence();
    const second = createInMemoryPersistence();
    await first.withTransaction(async (query) => {
      await query('INSERT INTO first (value) VALUES ($1)', ['one']);
      expect(await second.query('SELECT * FROM second')).toEqual([]);
    });
    expect(first.rows.has('first')).toBe(true);
    expect(second.rows.has('first')).toBe(false);
  });

  it('transaction_outcome_preserves_commit_error', async () => {
    const persistence = createInMemoryPersistence();
    const error = new Error('commit acknowledgement lost');
    persistence.failures.push({operation: 'commit', error});
    const outcome = await persistence.withTransactionOutcome(async () => 'value');
    expect(outcome).toEqual({status: 'commit_unknown', error});
  });

  it('nested_success_outer_rollback_never_publishes', async () => {
    const persistence = createInMemoryPersistence();
    const publications: Array<string> = [];
    const outcome = await persistence.withTransactionOutcome(async (scope) => {
      scope.registerAfterCommit(() => { publications.push('outer'); });
      const nested = await persistence.withTransactionOutcome(async () => 'nested');
      expect(nested.status).toBe('provisional');
      throw new Error('outer rollback');
    });
    expect(outcome.status).toBe('confirmed_rollback');
    expect(publications).toEqual([]);
  });

  it('nested_failure_preserves_original_error', async () => {
    const persistence = createInMemoryPersistence();
    const original = new Error('nested callback failed');
    const outcome = await persistence.withTransactionOutcome(async () => {
      const nested = await persistence.withTransactionOutcome(async () => { throw original; });
      expect(nested.status).toBe('confirmed_rollback');
      throw original;
    });
    expect(outcome.status).toBe('confirmed_rollback');
    if (outcome.status === 'confirmed_rollback') expect(outcome.error).toBe(original);
  });

  it('reconciler failure after confirmed commit is commit_unknown', async () => {
    const persistence = createInMemoryPersistence();
    const reconcileError = new Error('receipt query failed');
    const outcome = await persistence.withTransactionOutcome(async () => 'value', async () => { throw reconcileError; });
    expect(outcome).toEqual({status: 'commit_unknown', error: reconcileError, value: 'value'});
  });

  it('nested_reconciliation_runs_only_after_outer_exit', async () => {
    const persistence = createInMemoryPersistence();
    const stages: Array<string> = [];
    const outcome = await persistence.withTransactionOutcome(
      async () => {
        stages.push('outer');
        const nested = await persistence.withTransactionOutcome(async () => 'nested');
        expect(nested.status).toBe('provisional');
        return 'committed';
      },
      async () => { stages.push('reconcile'); return {truth: 'committed'}; },
    );
    expect(outcome.status).toBe('confirmed_commit');
    expect(stages).toEqual(['outer', 'reconcile']);
  });
});
