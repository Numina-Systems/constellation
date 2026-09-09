import {describe, expect, it} from 'bun:test';
import type {ConversationMessage} from '@/agent/types.ts';
import {createInMemoryPersistence, type TestPersistence} from '@/testing/ports.ts';
import {createCheckpointStore, saveAndPruneCheckpoint} from './checkpoint-store.ts';
import {createConversationHistoryStore, type PreparedCompactionPlan} from './conversation-history-store.ts';
import {serializeCheckpoint} from '@/agent/checkpoint-serializer.ts';
import type {AgentCheckpointState, SessionCheckpoint} from '@/agent/checkpoint-types.ts';

function message(id: string, conversationId: string, content = id): Readonly<Parameters<ReturnType<typeof createConversationHistoryStore>['append']>[0]> {
  return {id, conversation_id: conversationId, role: 'user', content, created_at: new Date('2026-01-01T00:00:00.000Z')};
}

function createPlan(conversationId: string, sourceMessageIds: ReadonlyArray<string>, expectedRevision: number, operationId = `op-${conversationId}`): PreparedCompactionPlan {
  return {
    operationId,
    conversationId,
    expectedRevision,
    sourceMessageIds,
    archiveBlocks: [{id: `archive-${operationId}`, owner: 'agent', label: `history/${operationId}`, content: 'retained bytes'}],
    summary: {
      id: `summary-${operationId}`,
      conversation_id: conversationId,
      role: 'assistant',
      content: 'compact summary',
      created_at: new Date('2026-01-01T00:00:01.000Z'),
    },
  };
}

function createCheckpoint(conversationId: string, id: string, createdAt: string): SessionCheckpoint {
  const state: AgentCheckpointState = {
    turnNumber: 1,
    toolRound: 0,
    messageIds: ['m1'],
    workingMemory: [],
    pendingPredictions: [],
    activeInterests: [],
    compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
    recallCache: null,
  };
  return serializeCheckpoint({id, conversationId, owner: 'test-owner', trigger: 'explicit', state, createdAt});
}

async function seed(history: ReturnType<typeof createConversationHistoryStore>, ...messages: ReadonlyArray<Parameters<typeof history.append>[0]>): Promise<void> {
  for (const value of messages) await history.append(value);
}

describe('Package D retained history real-store fake contracts', () => {
  it('append_publishes_active_message_and_revision', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);

    const appended = await history.append(message('m1', 'conv'));

    expect(appended.id).toBe('m1');
    expect(await history.readActive('conv')).toMatchObject({conversationId: 'conv', revision: 1, messages: [appended]});
  });

  it('compaction_stale_revision', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'));
    const before = await history.readActive('conv');

    await expect(history.commitCompaction(createPlan('conv', ['m1'], 0))).rejects.toMatchObject({code: 'history_stale_revision'});
    expect(await history.readActive('conv')).toEqual(before);
    expect(await persistence.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['op-conv'])).toEqual([]);
  });

  it('compaction_write_failure_reload_matrix', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('m2', 'conv'));
    const before = await history.readActive('conv');
    persistence.failures.push({operation: 'query', error: new Error('injected compaction write failure')});

    await expect(history.commitCompaction(createPlan('conv', ['m1', 'm2'], before.revision, 'rollback-op'))).rejects.toThrow('injected compaction write failure');
    expect(await history.readActive('conv')).toEqual(before);
    expect(await persistence.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['rollback-op'])).toEqual([]);
  });

  it('compaction_commit_ack_reconciliation', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'));
    persistence.failures.push({operation: 'commit', error: new Error('lost acknowledgement')});
    persistence.failures.push({operation: 'query', error: new Error('reconciliation unavailable'), when: 'outside_transaction'});

    await expect(history.commitCompaction(createPlan('conv', ['m1'], 1, 'lost-ack'))).rejects.toMatchObject({code: 'history_state_unknown'});
    expect(await history.readActive('conv')).toMatchObject({revision: 1, messages: [{id: 'm1'}]});

    const retry = await history.commitCompaction(createPlan('conv', ['m1'], 1, 'committed'));
    const repeated = await history.commitCompaction(createPlan('conv', ['m1'], 1, 'committed'));
    expect(repeated.receipt).toEqual(retry.receipt);
    expect(retry.history.revision).toBe(2);
  });

  it('foreign_message_active_prevention', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append(message('foreign', 'other'));

    await expect(history.commitCompaction(createPlan('conv', ['foreign'], 0, 'foreign-op'))).rejects.toMatchObject({code: 'history_stale_membership'});
    expect(await history.readActive('conv')).toEqual({conversationId: 'conv', revision: 0, messages: []});
  });

  it('readByIds_strict_membership_mismatch', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append(message('m1', 'conv'));

    await expect(history.readByIds('conv', ['m1', 'missing'])).rejects.toMatchObject({code: 'history_membership_mismatch'});
    await expect(history.readByIds('other', ['m1'])).rejects.toMatchObject({code: 'history_membership_mismatch'});
  });

  it('readHistorical_labels_active_and_superseded_rows', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv', 'source'), message('m2', 'conv', 'retained'));
    await history.commitCompaction(createPlan('conv', ['m1'], 2, 'archive-op'));

    const historical = await history.readHistorical('conv', 10);
    expect(historical.find((item) => item.message.id === 'm1')?.status).toBe('superseded');
    expect(historical.find((item) => item.message.id === 'm2')?.status).toBe('historical');
    expect(historical.find((item) => item.message.id === 'summary-archive-op')?.status).toBe('historical');
  });

  it('checkpoint_prune_retains_transcript', async () => {
    const persistence: TestPersistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append(message('m1', 'conv'));
    await history.commitCompaction(createPlan('conv', ['m1'], 1, 'archive-op'));
    const checkpoints = createCheckpointStore(persistence);
    const checkpoint1 = '11111111-1111-4111-8111-111111111111';
    const checkpoint2 = '22222222-2222-4222-8222-222222222222';
    const checkpoint3 = '33333333-3333-4333-8333-333333333333';
    await checkpoints.save(createCheckpoint('conv', checkpoint1, '2026-01-01T00:00:01.000Z'));
    await checkpoints.save(createCheckpoint('conv', checkpoint2, '2026-01-01T00:00:02.000Z'));

    const deleted = await saveAndPruneCheckpoint(persistence, createCheckpoint('conv', checkpoint3, '2026-01-01T00:00:03.000Z'), 1);

    expect(deleted).toBe(2);
    expect(await checkpoints.load(checkpoint1)).toBeNull();
    expect(await checkpoints.load(checkpoint2)).toBeNull();
    expect(await checkpoints.load(checkpoint3)).not.toBeNull();
    expect((await history.readByIds('conv', ['m1'])).map((item: ConversationMessage) => item.id)).toEqual(['m1']);
    expect(await persistence.query('SELECT operation_id FROM conversation_history_provenance WHERE operation_id = $1', ['archive-op'])).toHaveLength(1);
  });

  it('restoreExactHistory_exact_roundtrip_retains_later_messages_as_historical', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('m2', 'conv'), message('m3', 'conv'));
    const before = await history.readActive('conv');
    const restored = await history.restoreExactHistory({
      operationId: 'restore-roundtrip', conversationId: 'conv', expectedRevision: before.revision,
      messageIds: ['m2', 'm1'], checkpointId: 'checkpoint-1', sourceArchiveIds: ['archive-1'], provenanceRefs: ['prov-1'],
    });
    expect(restored.history.messages.map((item) => item.id)).toEqual(['m2', 'm1']);
    expect(restored.receipt.previousRevision).toBe(3);
    expect(restored.receipt.newRevision).toBe(4);
    expect(restored.receipt.sourceArchiveIds).toEqual(['archive-1']);
    expect((await history.readHistorical('conv', 10)).find((item) => item.message.id === 'm3')?.status).toBe('superseded');
  });

  it('restore_provenance_remains_compactable_after_exact_restore', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'restore-compaction'), message('m2', 'restore-compaction'), message('m3', 'restore-compaction'));
    const before = await history.readActive('restore-compaction');

    const restored = await history.restoreExactHistory({
      operationId: 'restore-before-compaction', conversationId: 'restore-compaction', expectedRevision: before.revision,
      messageIds: ['m1', 'm2'], checkpointId: 'checkpoint-prefix', sourceArchiveIds: [], provenanceRefs: [],
    });
    expect((await history.enumerateCompactionSources('restore-compaction', 10)).map((item) => item.id)).toEqual(['m1', 'm2']);

    const compacted = await history.commitCompaction(createPlan('restore-compaction', ['m1', 'm2'], restored.history.revision, 'compact-restored-prefix'));
    expect(compacted.history.messages.map((item) => item.id)).toEqual(['summary-compact-restored-prefix']);
    expect((await history.enumerateCompactionSources('restore-compaction', 10)).map((item) => item.id)).toEqual(['summary-compact-restored-prefix']);
    const provenanceRows = persistence.rows.get('conversation_history_provenance') ?? [];
    expect(provenanceRows.filter((row) => row['operation_id'] === 'restore-before-compaction')).toEqual([
      expect.objectContaining({operation_id: 'restore-before-compaction', operation_type: 'checkpoint_restore'}),
    ]);
  });

  it('restoreExactHistory_rejects_foreign_or_missing_ids_before_mutation', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('foreign', 'other'));
    const before = await history.readActive('conv');
    await expect(history.restoreExactHistory({operationId: 'restore-foreign', conversationId: 'conv', expectedRevision: before.revision, messageIds: ['m1', 'foreign'], checkpointId: 'checkpoint-foreign', sourceArchiveIds: [], provenanceRefs: []})).rejects.toMatchObject({code: 'history_membership_mismatch'});
    await expect(history.restoreExactHistory({operationId: 'restore-missing', conversationId: 'conv', expectedRevision: before.revision, messageIds: ['m1', 'missing'], checkpointId: 'checkpoint-missing', sourceArchiveIds: [], provenanceRefs: []})).rejects.toMatchObject({code: 'history_membership_mismatch'});
    expect(await history.readActive('conv')).toEqual(before);
    expect(await persistence.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['restore-foreign'])).toEqual([]);
  });

  it('restoreExactHistory_allocates_monotonic_revisions_and_replays_receipt_idempotently', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('m2', 'conv'));
    const first = await history.restoreExactHistory({operationId: 'restore-monotonic', conversationId: 'conv', expectedRevision: 2, messageIds: ['m1'], checkpointId: 'checkpoint-monotonic', sourceArchiveIds: [], provenanceRefs: []});
    const replay = await history.restoreExactHistory({operationId: 'restore-monotonic', conversationId: 'conv', expectedRevision: 2, messageIds: ['m1'], checkpointId: 'checkpoint-monotonic', sourceArchiveIds: [], provenanceRefs: []});
    expect(replay.receipt).toEqual(first.receipt);
    const second = await history.restoreExactHistory({operationId: 'restore-monotonic-2', conversationId: 'conv', expectedRevision: first.receipt.newRevision, messageIds: ['m1', 'm2'], checkpointId: 'checkpoint-monotonic-2', sourceArchiveIds: [], provenanceRefs: []});
    expect(second.receipt.newRevision).toBe(first.receipt.newRevision + 1);
    await expect(history.restoreExactHistory({operationId: 'restore-stale', conversationId: 'conv', expectedRevision: 1, messageIds: ['m1'], checkpointId: 'checkpoint-stale', sourceArchiveIds: [], provenanceRefs: []})).rejects.toMatchObject({code: 'history_stale_revision'});
  });

  it('restoreExactHistory_rolls_back_without_partial_state_on_fault', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('m2', 'conv'));
    const before = await history.readActive('conv');
    persistence.failures.push({operation: 'query', error: new Error('restore write failed'), when: 'inside_transaction'});
    await expect(history.restoreExactHistory({operationId: 'restore-rollback', conversationId: 'conv', expectedRevision: before.revision, messageIds: ['m2'], checkpointId: 'checkpoint-rollback', sourceArchiveIds: [], provenanceRefs: []})).rejects.toThrow('restore write failed');
    expect(await history.readActive('conv')).toEqual(before);
    expect(await persistence.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['restore-rollback'])).toEqual([]);
  });

  it('checkpoint_restore_commit_ack_reconciliation', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history, message('m1', 'conv'), message('m2', 'conv'));
    persistence.failures.push({operation: 'commit', error: new Error('lost acknowledgement'), commandTag: 'COMMIT'});
    const committed = await history.restoreExactHistory({operationId: 'restore-lost-ack', conversationId: 'conv', expectedRevision: 2, messageIds: ['m2'], checkpointId: 'checkpoint-lost-ack', sourceArchiveIds: [], provenanceRefs: []});
    expect(committed.receipt.newRevision).toBe(3);
    persistence.failures.push({operation: 'commit', error: new Error('lost unresolved acknowledgement'), commandTag: 'COMMIT'});
    persistence.failures.push({operation: 'query', error: new Error('reconciliation unavailable'), when: 'outside_transaction'});
    await expect(history.restoreExactHistory({operationId: 'restore-unresolved', conversationId: 'conv', expectedRevision: 3, messageIds: ['m1'], checkpointId: 'checkpoint-unresolved', sourceArchiveIds: [], provenanceRefs: []})).rejects.toMatchObject({code: 'history_state_unknown'});
    expect(await history.readActive('conv')).toMatchObject({revision: 4, messages: [{id: 'm1'}]});
  });

  it('history_mutations_reject_nested_transaction_scopes_with_typed_codes', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append(message('nested-source', 'nested-guards'));
    const errors: Array<unknown> = [];
    const nested = await persistence.withTransactionOutcome(async () => {
      const active = await history.readActive('nested-guards');
      try {
        await history.commitCompaction(createPlan('nested-guards', ['nested-source'], active.revision, 'nested-compaction'));
      } catch (error) {
        errors.push(error);
      }
      try {
        await history.restoreExactHistory({operationId: 'nested-restore', conversationId: 'nested-guards', expectedRevision: active.revision, messageIds: ['nested-source'], checkpointId: 'nested-checkpoint', sourceArchiveIds: [], provenanceRefs: []});
      } catch (error) {
        errors.push(error);
      }
      return 'outer';
    });
    expect(nested.status).toBe('confirmed_commit');
    expect(errors).toHaveLength(2);
    expect(errors).toEqual([
      expect.objectContaining({code: 'history_outermost_required'}),
      expect.objectContaining({code: 'history_outermost_required'}),
    ]);
  });

  it('fake_history_ordering_compares_timestamps_chronologically', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await seed(history,
      {...message('later', 'timestamp-order'), created_at: new Date('2026-01-01T00:00:00.010Z')},
      {...message('earlier', 'timestamp-order'), created_at: new Date('2026-01-01T00:00:00.002Z')},
    );
    expect((await history.readHistorical('timestamp-order', 10)).map((item) => item.message.id)).toEqual(['later', 'earlier']);
  });

  it('readActive_snapshot_consistency_uses_transaction_boundary', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append(message('m1', 'conv'));

    const snapshot = await history.readActive('conv');
    await history.append(message('m2', 'conv'));

    expect(snapshot).toMatchObject({revision: 1, messages: [{id: 'm1'}]});
    expect(await history.readActive('conv')).toMatchObject({revision: 2, messages: [{id: 'm1'}, {id: 'm2'}]});
  });
});
