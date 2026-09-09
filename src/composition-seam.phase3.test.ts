import {describe, expect, it} from 'bun:test';
import {createCompositionSeam} from './composition-seam.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import type {SessionCheckpointV2} from '@/agent/checkpoint-types.ts';

function checkpoint(conversationId: string): SessionCheckpointV2 {
  return {
    version: 2,
    id: crypto.randomUUID(),
    conversationId,
    owner: 'phase3',
    trigger: 'pre_compaction',
    turnNumber: 4,
    toolRound: 0,
    messageIds: ['retained'],
    transcriptRevision: 2,
    activeArchiveIds: ['archive-1'],
    provenanceRefs: ['checkpoint-ref'],
    workingMemory: [],
    pendingPredictions: [],
    activeInterests: [],
    compactionMeta: {lastCompactedIndex: 0, summaryCount: 1},
    recallCache: null,
    createdAt: new Date().toISOString(),
  };
}

describe('Phase 3 composition startup seam', () => {
  it('selectStartup distinguishes fresh and auto-resume durable history', async () => {
    const persistence = createInMemoryPersistence();
    const historyStore = createConversationHistoryStore(persistence);
    const message = await historyStore.append({conversation_id: 'auto', role: 'user', content: 'durable'});
    const seam = createCompositionSeam();

    const fresh = await seam.selectStartup({conversationId: 'fresh', historyStore, autoResume: false});
    expect(fresh.mode).toBe('fresh');
    expect(fresh.history).toBeNull();

    const auto = await seam.selectStartup({conversationId: 'auto', historyStore, autoResume: true});
    expect(auto.mode).toBe('auto_resume');
    expect(auto.history?.messages.map((item) => item.id)).toEqual([message.id]);
    expect(auto.history?.revision).toBe(1);
    expect(auto.checkpoint).toBeNull();
  });

  it('selectStartup gives explicit restore precedence over auto-resume without mutating history', async () => {
    const persistence = createInMemoryPersistence();
    const historyStore = createConversationHistoryStore(persistence);
    const message = await historyStore.append({conversation_id: 'explicit', role: 'user', content: 'existing'});
    const selected = await createCompositionSeam().selectStartup({
      conversationId: 'explicit',
      historyStore,
      autoResume: true,
      checkpoint: checkpoint('explicit'),
    });

    expect(selected.mode).toBe('explicit_restore');
    expect(selected.checkpoint?.id).toBeDefined();
    expect(selected.history?.messages.map((item) => item.id)).toEqual([message.id]);
    expect((await historyStore.readActive('explicit')).messages.map((item) => item.id)).toEqual([message.id]);
  });

  it('selectStartup refuses recovery-required conversations before reading active history', async () => {
    const persistence = createInMemoryPersistence();
    const base = createConversationHistoryStore(persistence);
    let reads = 0;
    const historyStore = {...base, readActive: async (conversationId: string) => { reads += 1; return base.readActive(conversationId); }};
    const selected = await createCompositionSeam().selectStartup({
      conversationId: 'blocked',
      historyStore,
      autoResume: true,
      recovery: async () => ({required: true, reason: 'unfinished batch', batchId: 'batch-1', unresolvedCallIds: ['call-1']}),
    });

    expect(selected.mode).toBe('recovery_required');
    expect(selected.recoveryReason).toBe('unfinished batch');
    expect(reads).toBe(0);
    expect(selected.history).toBeNull();
  });
});
