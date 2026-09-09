/** Required PostgreSQL scenarios for Phase 3; never falls back to an operational database. */
import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent.ts';
import type {AgentDependencies} from './types.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createCheckpointStore} from '@/persistence/checkpoint-store.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createMessageStore} from '@/persistence/message-store.ts';
import {createPostgresProvider} from '@/persistence';
import type {PersistenceProvider} from '@/persistence/types.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import {createToolRegistry} from '@/tool/registry.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import type {ModelProvider} from '@/model/types.ts';
import {serializeCheckpoint} from './checkpoint-serializer.ts';
import type {SessionCheckpointV2} from './checkpoint-types.ts';
import {restoreFromCheckpoint} from './checkpoint-restore.ts';
import {createCompositionSeam} from '@/composition-seam.ts';

const databaseUrl = process.env['TEST_DATABASE_ADMIN_URL'];

function emptyMemory(replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>> = []): MemoryManager {
  return {
    getCoreBlocks: async () => [],
    getWorkingBlocks: async () => [],
    buildSystemPrompt: async () => 'integration test system',
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

function emptyRuntime(): CodeRuntime {
  return {execute: async () => ({success: true, output: '', error: null, tool_calls_made: 0, duration_ms: 0})};
}

function createRefusingModel(calls: Array<number>): ModelProvider {
  return {
    complete: async () => {
      calls.push(1);
      throw new Error('provider must not be called while recovery is required');
    },
    stream: async function* () { yield {type: 'message_start' as const, message: {id: 'integration'}}; },
  };
}

function createAgentDependencies(
  persistence: PersistenceProvider,
  model: ModelProvider,
  conversationId: string,
): AgentDependencies {
  return {
    persistence,
    model,
    memory: emptyMemory(),
    registry: createToolRegistry(),
    runtime: emptyRuntime(),
    historyStore: createConversationHistoryStore(persistence),
    integrityLifecycle: createIntegrityLifecycle(persistence, conversationId),
    config: {max_tool_rounds: 2, context_budget: 0.8, model_max_tokens: 10000, max_tokens: 100},
  };
}

async function createFreshPersistence(database: Readonly<TestDatabase>): Promise<PersistenceProvider> {
  const persistence = createPostgresProvider({url: database.url});
  await persistence.connect();
  return persistence;
}

function checkpointFor(
  conversationId: string,
  messageIds: ReadonlyArray<string>,
  transcriptRevision: number,
): SessionCheckpointV2 {
  return serializeCheckpoint({
    id: crypto.randomUUID(),
    conversationId,
    owner: 'phase3-integration',
    trigger: 'pre_compaction',
    createdAt: new Date().toISOString(),
    state: {
      turnNumber: 2,
      toolRound: 0,
      messageIds,
      transcriptRevision,
      activeArchiveIds: [],
      provenanceRefs: [],
      workingMemory: [{label: 'checkpoint', content: 'restored'}],
      pendingPredictions: [],
      activeInterests: [],
      compactionMeta: {lastCompactedIndex: 0, summaryCount: 1},
      recallCache: null,
    },
  });
}

describe('phase3.integration-required', () => {
  it('integration_mode_requires_database', () => {
    if (!databaseUrl) throw new Error('integration database required: set TEST_DATABASE_ADMIN_URL');
    expect(databaseUrl.length).toBeGreaterThan(0);
  });

  describe.skipIf(!databaseUrl)('restart and restore scenarios (requires disposable PostgreSQL)', () => {
    it('restart_with_unfinished_tool_batch_never_replays_effects', async () => {
      const database = await createTestDatabase();
      const conversationId = 'phase3-unfinished';
      let restarted: PersistenceProvider | null = null;
      try {
        const firstLifecycle = createIntegrityLifecycle(database.persistence, conversationId);
        const batchId = await firstLifecycle.beginBatch(['effect-1', 'effect-2']);
        await firstLifecycle.recordOutcome(batchId, 'effect-1', {kind: 'success', output: 'effect committed'});

        restarted = await createFreshPersistence(database);
        const secondLifecycle = createIntegrityLifecycle(restarted, conversationId);
        const recovery = await secondLifecycle.getRecoveryState();
        expect(recovery.required).toBe(true);
        expect(recovery.unresolvedCallIds).toEqual(['effect-2']);

        const providerCalls: Array<number> = [];
        const agent = createAgent(
          createAgentDependencies(restarted, createRefusingModel(providerCalls), conversationId),
          conversationId,
        );
        await expect(agent.processMessage('restart')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
        expect(providerCalls).toHaveLength(0);
        expect((await secondLifecycle.getRecoveryState()).unresolvedCallIds).toEqual(['effect-2']);
      } finally {
        if (restarted) await restarted.disconnect();
        await teardownTestDatabase(database);
      }
    });

    it('precompaction_checkpoint_exact_restore_after_restart', async () => {
      const database = await createTestDatabase();
      const conversationId = 'phase3-restore';
      let restarted: PersistenceProvider | null = null;
      try {
        const history = createConversationHistoryStore(database.persistence);
        const first = await history.append({id: 'restore-first', conversation_id: conversationId, role: 'user', content: 'first'});
        const second = await history.append({id: 'restore-second', conversation_id: conversationId, role: 'assistant', content: 'second'});
        const checkpoint = checkpointFor(conversationId, [first.id, second.id], 2);
        await createCheckpointStore(database.persistence).save(checkpoint);
        const later = await history.append({id: 'restore-later', conversation_id: conversationId, role: 'user', content: 'committed after checkpoint'});
        expect((await history.readActive(conversationId)).messages.map((message) => message.id)).toEqual([first.id, second.id, later.id]);

        restarted = await createFreshPersistence(database);
        const restartedHistory = createConversationHistoryStore(restarted);
        const replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>> = [];
        const result = await restoreFromCheckpoint(checkpoint, {
          persistence: restarted,
          memory: emptyMemory(replacements),
          messageStore: createMessageStore(restarted, restartedHistory),
          historyStore: restartedHistory,
          traceRecorder: {record: async () => undefined},
          owner: 'phase3-integration',
        });

        expect(result.messageCount).toBe(2);
        expect((await restartedHistory.readActive(conversationId)).messages.map((message) => message.id)).toEqual([first.id, second.id]);
        expect((await restartedHistory.readActive(conversationId)).revision).toBe(4);
        expect((await restartedHistory.readHistorical(conversationId, 10)).find((item) => item.message.id === later.id)?.status).toBe('superseded');
        expect(replacements).toEqual([[{label: 'checkpoint', content: 'restored'}]]);
      } finally {
        if (restarted) await restarted.disconnect();
        await teardownTestDatabase(database);
      }
    });

    it('auto_resume_preserves_post_checkpoint_commits', async () => {
      const database = await createTestDatabase();
      const conversationId = 'phase3-resume';
      try {
        const history = createConversationHistoryStore(database.persistence);
        const first = await history.append({id: 'resume-first', conversation_id: conversationId, role: 'user', content: 'first'});
        const checkpoint = checkpointFor(conversationId, [first.id], 1);
        await createCheckpointStore(database.persistence).save(checkpoint);
        const second = await history.append({id: 'resume-second', conversation_id: conversationId, role: 'assistant', content: 'committed after checkpoint'});

        const selected = await createCompositionSeam().selectStartup({
          conversationId,
          historyStore: createConversationHistoryStore(database.persistence),
          autoResume: true,
          // The root deliberately passes null in auto mode: checkpoint metadata is not authority.
          checkpoint: null,
        });
        expect(selected.mode).toBe('auto_resume');
        expect(selected.checkpoint).toBeNull();
        expect(selected.history?.messages.map((message) => message.id)).toEqual([first.id, second.id]);
      } finally {
        await teardownTestDatabase(database);
      }
    });
  });
});
