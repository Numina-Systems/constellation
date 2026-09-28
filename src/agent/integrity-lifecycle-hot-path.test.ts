import {describe, expect, it} from 'bun:test';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createInMemoryPersistence, type TestPersistence} from '@/testing/ports.ts';

function trackedPersistence(inner: TestPersistence): {readonly persistence: TestPersistence; readonly returned: () => number} {
  let rows = 0;
  const persistence: TestPersistence = {
    ...inner,
    query: async <T extends Record<string, unknown>>(sql: string, params: ReadonlyArray<unknown> = []): Promise<Array<T>> => {
      const result = await inner.query<T>(sql, params);
      rows += result.length;
      return result;
    },
  };
  return {persistence, returned: () => rows};
}

describe('Integrity lifecycle receipt access bounds', () => {
  it('hot_paths_never_reread_completed_batch_history', async () => {
    const inner = createInMemoryPersistence();
    const {persistence, returned} = trackedPersistence(inner);
    const lifecycle = createIntegrityLifecycle(persistence, 'hot-path-conv');

    // Retained history: 120 fully completed batches, each with a decoded outcome.
    for (let index = 0; index < 120; index += 1) {
      const batchId = await lifecycle.beginBatch([`call-${index}`]);
      await lifecycle.recordOutcome(batchId, `call-${index}`, {kind: 'success', output: 'ok'});
      await lifecycle.completeBatch(batchId);
    }
    // One open batch that recovery must still observe.
    const openBatchId = await lifecycle.beginBatch(['open-call']);

    const before = returned();
    await lifecycle.recordOutcome(openBatchId, 'open-call', {kind: 'success', output: 'ok'});
    const afterOutcome = returned();
    const state = await lifecycle.getRecoveryState();
    const afterRecoveryState = returned();
    expect(state).toMatchObject({required: true, batchId: openBatchId});
    await lifecycle.recover(['open-call'], 'cycle-7 access bound check');
    const afterRecover = returned();
    expect(await lifecycle.getRecoveryState()).toMatchObject({required: false});

    // By-PK and unfinished-scoped reads only: no historical receipt is reread.
    expect(afterOutcome - before).toBeLessThanOrEqual(2);
    expect(afterRecoveryState - afterOutcome).toBeLessThanOrEqual(2);
    expect(afterRecover - afterRecoveryState).toBeLessThanOrEqual(2);
  });
});
