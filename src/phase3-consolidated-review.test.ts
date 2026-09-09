import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent/agent.ts';
import type {ModelProvider, ModelResponse} from './model/types.ts';
import {createCheckpointStore} from './persistence/checkpoint-store.ts';
import {createConversationHistoryStore, type PreparedCompactionPlan} from './persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from './testing/ports.ts';
import {createIntegrityLifecycle} from './agent/integrity-lifecycle.ts';
import {createCompositionSeam} from './composition-seam.ts';
import {deserializeCheckpoint, serializeCheckpoint} from './agent/checkpoint-serializer.ts';
import type {SessionCheckpointV2} from './agent/checkpoint-types.ts';
import {restoreFromCheckpoint} from './agent/checkpoint-restore.ts';
import {createMessageStore} from './persistence/message-store.ts';
import type {MemoryManager} from './memory/manager.ts';
import type {CodeRuntime} from './runtime/types.ts';
import {createToolRegistry} from './tool/registry.ts';

function memory(replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>>): MemoryManager {
  return {
    getCoreBlocks: async () => [], getWorkingBlocks: async () => [], buildSystemPrompt: async () => 'test',
    read: async () => [], write: async () => ({applied: false, error: 'unused'}), list: async () => [],
    deleteBlock: async () => undefined, moveBlock: async () => { throw new Error('unused'); },
    getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}), getPendingMutations: async () => [],
    approveMutation: async () => { throw new Error('unused'); }, rejectMutation: async () => { throw new Error('unused'); },
    replaceWorkingMemory: async (blocks) => { replacements.push(blocks); return []; },
  };
}

function checkpoint(conversationId: string, messageIds: ReadonlyArray<string>): SessionCheckpointV2 {
  return serializeCheckpoint({
    id: crypto.randomUUID(), conversationId, owner: 'phase3', trigger: 'explicit', createdAt: new Date().toISOString(),
    state: {
      turnNumber: 4, toolRound: 0, messageIds, transcriptRevision: messageIds.length,
      activeArchiveIds: [], provenanceRefs: [], workingMemory: [{label: 'live', content: 'checkpoint'}],
      pendingPredictions: [], activeInterests: [], compactionMeta: {lastCompactedIndex: 0, summaryCount: 0}, recallCache: null,
    },
  });
}

function compactionPlan(conversationId: string, sourceMessageId: string, expectedRevision: number): PreparedCompactionPlan {
  return {
    operationId: `compaction-${conversationId}`,
    conversationId, expectedRevision, sourceMessageIds: [sourceMessageId],
    archiveBlocks: [{id: `archive-${conversationId}`, owner: 'phase3', label: `archive-${conversationId}`, content: 'archived source'}],
    summary: {id: `summary-${conversationId}`, conversation_id: conversationId, role: 'system', content: 'summary'},
  };
}

function textModelResponse(content: string): ModelResponse {
  return {content: [{type: 'text', text: content}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

describe('Phase 3 consolidated review named regressions', () => {
  it('live_write_checkpoint_restore_compatibility', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    const message = await history.append({id: 'compat-message', conversation_id: 'compat', role: 'user', content: 'live'});
    const store = createCheckpointStore(persistence);
    const saved = checkpoint('compat', [message.id]);
    await store.save(saved);
    const loaded = deserializeCheckpoint((await store.load(saved.id)) as unknown);
    expect(loaded.version).toBe(2);
    expect(loaded.messageIds).toEqual([message.id]);
    const replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>> = [];
    await restoreFromCheckpoint(saved, {
      persistence, memory: memory(replacements), messageStore: createMessageStore(persistence, history), historyStore: history,
      traceRecorder: {record: async () => undefined}, owner: 'phase3',
    });
    expect(replacements).toEqual([[{label: 'live', content: 'checkpoint'}]]);
  });

  it('auto_resume_after_committed_compaction', async () => {
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    const source = await history.append({id: 'compact-source', conversation_id: 'compact-resume', role: 'user', content: 'source'});
    const before = await history.readActive('compact-resume');
    await history.commitCompaction(compactionPlan('compact-resume', source.id, before.revision));
    const later = await history.append({id: 'compact-later', conversation_id: 'compact-resume', role: 'user', content: 'later'});
    const selected = await createCompositionSeam().selectStartup({conversationId: 'compact-resume', historyStore: history, autoResume: true, checkpoint: null});
    expect(selected.mode).toBe('auto_resume');
    expect(selected.history?.messages.map((item) => item.id)).toEqual([`summary-compact-resume`, later.id]);
  });

  it('repair_orphaned_tool_result_then_recovery_allows_next_agent_turn', async () => {
    const persistence = createInMemoryPersistence();
    const conversationId = 'repair-recovery';
    const history = createConversationHistoryStore(persistence);
    await history.append({
      id: 'orphaned-assistant', conversation_id: conversationId, role: 'assistant', content: '[Tool calls]',
      tool_calls: [{type: 'tool_use', id: 'missing-result', name: 'already-completed'}],
    });
    const lifecycle = createIntegrityLifecycle(persistence, conversationId, history);
    const batchId = await lifecycle.beginBatch(['missing-result']);
    expect((await lifecycle.getRecoveryState()).unresolvedCallIds).toEqual(['missing-result']);

    await lifecycle.recover([],'trusted repair for missing result');

    const repaired = (await history.readActive(conversationId)).messages.find((message) => message.tool_call_id === 'missing-result');
    expect(repaired).toMatchObject({role: 'tool', tool_outcome: {kind: 'outcome_unknown', code: 'trusted_backfill'}, content: 'trusted repair for missing result'});
    const batchRows = await persistence.query<{readonly details: unknown}>('SELECT details FROM operation_receipts WHERE operation_type = \'agent_batch\' AND details->>\'conversationId\' = $1', [conversationId]);
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0]?.details).toMatchObject({batchId, completed: true, outcomes: {'missing-result': {kind: 'outcome_unknown', code: 'trusted_backfill'}}});
    expect(await lifecycle.getRecoveryState()).toMatchObject({required: false, unresolvedCallIds: []});

    let providerCalls = 0;
    const model: ModelProvider = {
      complete: async () => { providerCalls += 1; return textModelResponse('recovered turn'); },
      stream: async function* () { yield {type: 'message_start' as const, message: {id: 'recovered'}}; },
    };
    const runtime: CodeRuntime = {execute: async () => ({success: true, output: '', error: null, tool_calls_made: 0, duration_ms: 0})};
    const agent = createAgent({
      model, memory: memory([]), registry: createToolRegistry(), runtime, persistence, historyStore: history,
      integrityLifecycle: lifecycle, config: {max_tool_rounds: 2, context_budget: 0.8, model_max_tokens: 10_000, max_tokens: 100},
    }, conversationId);
    await expect(agent.processMessage('continue after repair')).resolves.toBe('recovered turn');
    expect(providerCalls).toBe(1);
  });

  it('remediation_end_to_end_restart_scenario', async () => {
    const persistence = createInMemoryPersistence();
    const conversationId = 'restart-e2e';
    const lifecycle = createIntegrityLifecycle(persistence, conversationId);
    const unfinishedBatch = await lifecycle.beginBatch(['unfinished-call']);
    expect(unfinishedBatch).toBeString();
    const restartedLifecycle = createIntegrityLifecycle(persistence, conversationId);
    expect((await restartedLifecycle.getRecoveryState()).required).toBe(true);
    await expect(restartedLifecycle.recover([], 'must acknowledge unfinished call')).rejects.toThrow();
    await restartedLifecycle.recover(['unfinished-call']);
    expect((await createIntegrityLifecycle(persistence, conversationId).getRecoveryState()).required).toBe(false);
  });

  it('checkpoint_version_and_missing_source_matrix', async () => {
    const legacy = {
      version: 1, id: '550e8400-e29b-41d4-a716-446655440000', conversationId: 'matrix', owner: 'phase3', trigger: 'explicit',
      turnNumber: 1, toolRound: 0, messageIds: ['missing'], workingMemory: [], pendingPredictions: [], activeInterests: [],
      compactionMeta: {lastCompactedIndex: 0, summaryCount: 0}, recallCache: null, createdAt: new Date().toISOString(),
    };
    const migrated = deserializeCheckpoint(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.migratedFromVersion).toBe(1);
    expect(() => deserializeCheckpoint({...legacy, version: 99})).toThrow();
    const persistence = createInMemoryPersistence();
    const history = createConversationHistoryStore(persistence);
    await history.append({id: 'present', conversation_id: 'matrix', role: 'user', content: 'present'});
    const replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>> = [];
    await expect(restoreFromCheckpoint({...migrated, messageIds: ['missing'], transcriptRevision: 0}, {
      persistence, memory: memory(replacements), messageStore: createMessageStore(persistence, history), historyStore: history,
      traceRecorder: {record: async () => undefined}, owner: 'phase3',
    })).rejects.toMatchObject({code: 'history_membership_mismatch'});
    expect(replacements).toHaveLength(0);
  });
});
