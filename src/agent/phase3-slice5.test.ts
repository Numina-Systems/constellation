import {describe, expect, it} from 'bun:test';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createMessageStore} from '@/persistence/message-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import {restoreFromCheckpoint, type RestorationDependencies} from './checkpoint-restore.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {SessionCheckpointV2} from './checkpoint-types.ts';

function memory(replacements: Array<ReadonlyArray<{label: string; content: string}>>): MemoryManager {
  return {
    getCoreBlocks: async () => [],
    getWorkingBlocks: async () => [],
    buildSystemPrompt: async () => '',
    read: async () => [],
    write: async () => ({applied: false, error: 'unused'}),
    list: async () => [],
    deleteBlock: async () => undefined,
    moveBlock: async () => { throw new Error('unused'); },
    getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}),
    getPendingMutations: async () => [],
    approveMutation: async () => { throw new Error('unused'); },
    rejectMutation: async () => { throw new Error('unused'); },
    replaceWorkingMemory: async (blocks) => { replacements.push(blocks); return []; },
  };
}

function checkpoint(conversationId: string, messageIds: ReadonlyArray<string>): SessionCheckpointV2 {
  return {
    version: 2,
    id: crypto.randomUUID(),
    conversationId,
    owner: 'phase3',
    trigger: 'pre_compaction',
    turnNumber: 2,
    toolRound: 0,
    messageIds: [...messageIds],
    transcriptRevision: 1,
    activeArchiveIds: [],
    provenanceRefs: [],
    workingMemory: [{label: 'session', content: 'restored'}],
    pendingPredictions: [],
    activeInterests: [],
    compactionMeta: {lastCompactedIndex: 0, summaryCount: 1},
    recallCache: null,
    createdAt: new Date().toISOString(),
  };
}

describe('Phase 3 exact restore wiring', () => {
  it('restore_failure_has_no_partial_state', async () => {
    const persistence = createInMemoryPersistence();
    const historyStore = createConversationHistoryStore(persistence);
    const first = await historyStore.append({conversation_id: 'restore-failure', role: 'user', content: 'first'});
    const second = await historyStore.append({conversation_id: 'restore-failure', role: 'assistant', content: 'second'});
    const before = await historyStore.readActive('restore-failure');
    const replacements: Array<ReadonlyArray<{label: string; content: string}>> = [];
    const deps: RestorationDependencies = {
      persistence,
      memory: memory(replacements),
      messageStore: createMessageStore(persistence, historyStore),
      historyStore,
      traceRecorder: {record: async () => undefined},
      owner: 'phase3',
    };

    await expect(restoreFromCheckpoint(checkpoint('restore-failure', [first.id, 'missing-id']), deps)).rejects.toMatchObject({code: 'history_membership_mismatch'});
    const after = await historyStore.readActive('restore-failure');
    expect(after.revision).toBe(before.revision);
    expect(after.messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(replacements).toHaveLength(0);
  });

  it('precompaction exact restore_publishes_memory_after_durable_commit', async () => {
    const persistence = createInMemoryPersistence();
    const historyStore = createConversationHistoryStore(persistence);
    const first = await historyStore.append({conversation_id: 'restore-success', role: 'user', content: 'first'});
    const second = await historyStore.append({conversation_id: 'restore-success', role: 'assistant', content: 'second'});
    const replacements: Array<ReadonlyArray<{label: string; content: string}>> = [];
    const deps: RestorationDependencies = {
      persistence,
      memory: memory(replacements),
      messageStore: createMessageStore(persistence, historyStore),
      historyStore,
      traceRecorder: {record: async () => undefined},
      owner: 'phase3',
    };

    const result = await restoreFromCheckpoint(checkpoint('restore-success', [first.id]), deps);
    expect(result.messageCount).toBe(1);
    expect(replacements).toEqual([[{label: 'session', content: 'restored'}]]);
    const active = await historyStore.readActive('restore-success');
    expect(active.messages.map((message) => message.id)).toEqual([first.id]);
    expect(active.revision).toBe(3);
    expect((await historyStore.readHistorical('restore-success', 10)).some((item) => item.message.id === second.id && item.status === 'superseded')).toBe(true);
  });
});
