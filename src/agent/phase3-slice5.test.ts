import {describe, expect, it} from 'bun:test';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createMessageStore} from '@/persistence/message-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import {restoreFromCheckpoint, type RestorationDependencies} from './checkpoint-restore.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
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

  it('repeat_restore_of_same_checkpoint_replaces_membership_after_later_appends', async () => {
    const persistence = createInMemoryPersistence();
    const historyStore = createConversationHistoryStore(persistence);
    const first = await historyStore.append({conversation_id: 'restore-repeat', role: 'user', content: 'first'});
    await historyStore.append({conversation_id: 'restore-repeat', role: 'assistant', content: 'second'});
    const replacements: Array<ReadonlyArray<{label: string; content: string}>> = [];
    const deps: RestorationDependencies = {
      persistence,
      memory: memory(replacements),
      messageStore: createMessageStore(persistence, historyStore),
      historyStore,
      traceRecorder: {record: async () => undefined},
      owner: 'phase3',
    };
    // One checkpoint object restored twice: each request owns a distinct operation
    // identity, so the second restore must re-run membership replacement.
    const checkpointToRestore = checkpoint('restore-repeat', [first.id]);

    const firstRestore = await restoreFromCheckpoint(checkpointToRestore, deps);
    expect(firstRestore.messageCount).toBe(1);
    const appended = await historyStore.append({conversation_id: 'restore-repeat', role: 'user', content: 'later'});

    const secondRestore = await restoreFromCheckpoint(checkpointToRestore, deps);

    expect(secondRestore.messageCount).toBe(1);
    const active = await historyStore.readActive('restore-repeat');
    expect(active.messages.map((message) => message.id)).toEqual([first.id]);
    // revision 2 (seed) → 3 (first restore) → 4 (append) → 5 (second restore).
    expect(active.revision).toBe(5);
    expect((await historyStore.readHistorical('restore-repeat', 10)).some((item) => item.message.id === appended.id && item.status === 'superseded')).toBe(true);
    expect(replacements).toHaveLength(2);
  });

  it('restore_working_memory_failure_latches_durable_recovery', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'restore-latch');
    const historyStore = createConversationHistoryStore(persistence);
    const first = await historyStore.append({conversation_id: 'restore-latch', role: 'user', content: 'first'});
    const replacements: Array<ReadonlyArray<{label: string; content: string}>> = [];
    const failingMemory = {
      ...memory(replacements),
      replaceWorkingMemory: async (): Promise<ReadonlyArray<{label: string; content: string}>> => {
        throw new Error('protected working block');
      },
    };
    const deps: RestorationDependencies = {
      persistence,
      memory: failingMemory as unknown as MemoryManager,
      messageStore: createMessageStore(persistence, historyStore),
      historyStore,
      integrityLifecycle: lifecycle,
      traceRecorder: {record: async () => undefined},
      owner: 'phase3',
    };

    // History may commit, but the working-memory failure must leave the conversation
    // latched for trusted recovery instead of silently half-restored.
    const checkpointToRestore = checkpoint('restore-latch', [first.id]);
    await expect(restoreFromCheckpoint(checkpointToRestore, deps)).rejects.toMatchObject({code: 'CHECKPOINT_FAILED'});
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // Generic tool recovery must not clear a typed restore marker it cannot reconcile.
    await lifecycle.recover([], 'generic tool backfill');
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // Re-running the restore to a fully applied completion supersedes the stale
    // marker and clears the latch only after working memory actually followed.
    const appliedDeps: RestorationDependencies = {...deps, memory: memory(replacements)};
    await restoreFromCheckpoint(checkpointToRestore, appliedDeps);
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: false});
  });

  it('successful_restore_clears_its_recovery_marker', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'restore-clear');
    const historyStore = createConversationHistoryStore(persistence);
    const first = await historyStore.append({conversation_id: 'restore-clear', role: 'user', content: 'first'});
    const replacements: Array<ReadonlyArray<{label: string; content: string}>> = [];
    const deps: RestorationDependencies = {
      persistence,
      memory: memory(replacements),
      messageStore: createMessageStore(persistence, historyStore),
      historyStore,
      integrityLifecycle: lifecycle,
      traceRecorder: {record: async () => undefined},
      owner: 'phase3',
    };

    await restoreFromCheckpoint(checkpoint('restore-clear', [first.id]), deps);
    // Only a fully applied restore clears the marker; the latch never outlives success.
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: false});
  });
});
