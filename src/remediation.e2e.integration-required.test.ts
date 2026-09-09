import {describe, expect, it} from 'bun:test';
import type {MemoryManager} from '@/memory/manager.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import {createConversationHistoryStore, type ConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createCheckpointStore} from '@/persistence/checkpoint-store.ts';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import {createInMemoryPersistence, type TestPersistence} from '@/testing/ports.ts';
import {createIntegrityLifecycle} from '@/agent/integrity-lifecycle.ts';
import {createCompositionSeam} from '@/composition-seam.ts';
import {type AgentDependencies} from '@/agent/index.ts';
import {createToolRegistry} from '@/tool/registry.ts';
import {createCompactor} from '@/compaction/compactor.ts';
import {serializeCheckpoint} from '@/agent/checkpoint-serializer.ts';
import type {AgentCheckpointState, SessionCheckpointV2} from '@/agent/checkpoint-types.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import {createMessageStore} from '@/persistence/message-store.ts';

function memory(replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>>): MemoryManager {
  return {
    getCoreBlocks: async () => [], getWorkingBlocks: async () => [], buildSystemPrompt: async () => 'integration system',
    read: async () => [], write: async () => ({applied: false, error: 'unused'}), list: async () => [],
    deleteBlock: async () => undefined, moveBlock: async () => { throw new Error('unused'); },
    getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}), getPendingMutations: async () => [],
    approveMutation: async () => { throw new Error('unused'); }, rejectMutation: async () => { throw new Error('unused'); },
    replaceWorkingMemory: async (blocks) => { replacements.push(blocks); return []; },
  };
}

function runtime(): CodeRuntime {
  return {execute: async () => ({success: true, output: '', error: null, tool_calls_made: 0, duration_ms: 0})};
}

function text(content: string): ModelResponse {
  return {content: [{type: 'text', text: content}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

function batchResponse(): ModelResponse {
  return {
    content: [
      {type: 'tool_use', id: 'batch-tool-call', name: 'batch_tool', input: {}},
      {type: 'tool_use', id: 'compact-call', name: 'compact_context', input: {}},
    ],
    stop_reason: 'tool_use', usage: {input_tokens: 1, output_tokens: 1},
  };
}

function agentModel(): ModelProvider {
  let index = 0;
  const responses = [batchResponse(), text('first committed response'), text('second queued response')];
  return {
    complete: async (_request: ModelRequest) => responses[index++] ?? text('unexpected extra response'),
    stream: async function* () { yield {type: 'message_start' as const, message: {id: 'e2e'}}; },
  };
}

function isTestPersistence(persistence: PersistenceProvider): persistence is TestPersistence {
  return 'rows' in persistence && 'failures' in persistence;
}

function requireCheckpoint(checkpoint: SessionCheckpointV2 | null): SessionCheckpointV2 {
  if (checkpoint === null) throw new Error('scenario did not capture a checkpoint');
  return checkpoint;
}

function summaryModel(): ModelProvider {
  return {
    complete: async () => text('durable compaction summary'),
    stream: async function* () { yield {type: 'message_stop' as const, message: {stop_reason: 'end_turn' as const}}; },
  };
}

function dependencies(
  persistence: PersistenceProvider,
  historyStore: ConversationHistoryStore,
  conversationId: string,
  checkpointFn: AgentDependencies['checkpointFn'],
): AgentDependencies {
  const registry = createToolRegistry();
  registry.register({definition: {name: 'batch_tool', description: 'deterministic batch tool', parameters: []}, handler: async () => ({success: true, output: 'batch tool committed'})});
  const lifecycle = createIntegrityLifecycle(persistence, conversationId);
  const compactor = createCompactor({
    model: summaryModel(), memory: memory([]), persistence, historyStore, modelName: 'e2e-summary',
    config: {chunkSize: 2, keepRecent: 0, maxSummaryTokens: 128, clipFirst: 0, clipLast: 0, prompt: null, maxRetries: 0},
  });
  return {
    model: agentModel(), memory: memory([]), registry, runtime: runtime(), persistence, historyStore,
    integrityLifecycle: lifecycle, compactor, checkpointFn,
    config: {max_tool_rounds: 5, context_budget: 0.8, model_max_tokens: 10_000, max_tokens: 100, checkpoint_interval: 1},
  };
}

async function runScenario(persistence: PersistenceProvider): Promise<{
  readonly checkpoint: SessionCheckpointV2;
  readonly activeIds: ReadonlyArray<string>;
  readonly conversationId: string;
}> {
  const conversationId = `remediation-e2e-${crypto.randomUUID()}`;
  const historyStore = createConversationHistoryStore(persistence);
  const checkpointStore = createCheckpointStore(persistence);
  let firstCheckpoint: SessionCheckpointV2 | null = null;
  const checkpointFn: AgentDependencies['checkpointFn'] = async (trigger, state) => {
    if (state && trigger === 'interval' && firstCheckpoint === null) {
      const checkpointState: AgentCheckpointState = {
        ...state,
        workingMemory: [{label: 'post-compaction', content: 'durable state'}],
        pendingPredictions: [],
        activeInterests: [],
        recallCache: null,
      };
      firstCheckpoint = serializeCheckpoint({
        id: crypto.randomUUID(), conversationId, owner: 'remediation-e2e', trigger, createdAt: new Date().toISOString(), state: checkpointState,
      });
      await checkpointStore.save(firstCheckpoint);
    }
    return firstCheckpoint?.id ?? null;
  };
  const agent = createCompositionSeam().createAgent(dependencies(persistence, historyStore, conversationId, checkpointFn), conversationId);

  const results = await Promise.all([agent.processMessage('start concurrent batch'), agent.processMessage('queued after commit')]);
  expect(results).toEqual(['first committed response', 'second queued response']);
  expect(firstCheckpoint).not.toBeNull();
  const checkpoint = requireCheckpoint(firstCheckpoint);
  const active = await historyStore.readActive(conversationId);
  expect(active.messages.some((message) => message.role === 'system' && message.content.includes('durable compaction summary'))).toBe(true);
  const retained = await historyStore.readHistorical(conversationId, 50);
  expect(retained.some((item) => item.message.content === 'batch tool committed')).toBe(true);
  expect(checkpoint.activeArchiveIds.length).toBeGreaterThan(0);
  expect(checkpoint.provenanceRefs.length).toBeGreaterThan(0);
  if (isTestPersistence(persistence)) {
    const intentRows = Array.from(persistence.rows.get('operation_receipts') ?? []).filter((row) => row['operation_type'] === 'compaction_intent');
    expect(intentRows).toHaveLength(1);
  }
  return {checkpoint, activeIds: active.messages.map((message) => message.id), conversationId};
}

async function restoreAfterFreshInstances(
  persistence: PersistenceProvider,
  checkpoint: SessionCheckpointV2,
  conversationId: string,
  expectedIds: ReadonlyArray<string>,
): Promise<void> {
  const historyStore = createConversationHistoryStore(persistence);
  const replacements: Array<ReadonlyArray<{readonly label: string; readonly content: string}>> = [];
  const selection = await createCompositionSeam().selectStartup({conversationId, historyStore, autoResume: true, checkpoint: null});
  expect(selection.mode).toBe('auto_resume');
  expect(selection.history?.messages.map((message) => message.id)).toEqual([...expectedIds]);
  await createCompositionSeam().restoreCheckpoint(checkpoint, {
    persistence, memory: memory(replacements), messageStore: createMessageStore(persistence, historyStore),
    historyStore, traceRecorder: {record: async () => undefined}, owner: 'remediation-e2e',
  });
  expect((await historyStore.readActive(conversationId)).messages.map((message) => message.id)).toEqual([...checkpoint.messageIds]);
  expect(replacements).toEqual([[{label: 'post-compaction', content: 'durable state'}]]);
}

describe('remediation production composition end-to-end (fake persistence)', () => {
  it('remediation_end_to_end_restart_scenario', async () => {
    const persistence = createInMemoryPersistence();
    const scenario = await runScenario(persistence);
    const restartedPersistence = persistence;
    await restoreAfterFreshInstances(restartedPersistence, scenario.checkpoint, scenario.conversationId, scenario.activeIds);
  });

  it('manual_compaction_waits_for_complete_batch', async () => {
    const persistence = createInMemoryPersistence();
    const scenario = await runScenario(persistence);
    expect((await createConversationHistoryStore(persistence).readActive(scenario.conversationId)).messages.some((message) => message.content.includes('durable compaction summary'))).toBe(true);
  });
});

const databaseUrl = process.env['TEST_DATABASE_ADMIN_URL'];
describe('remediation production composition end-to-end (required PostgreSQL)', () => {
  it('integration_mode_requires_database', () => {
    if (!databaseUrl) throw new Error('integration database required: set TEST_DATABASE_ADMIN_URL');
    expect(databaseUrl.length).toBeGreaterThan(0);
  });

  it.skipIf(!databaseUrl)('remediation_end_to_end_restart_scenario', async () => {
    const database: TestDatabase = await createTestDatabase({adminUrl: databaseUrl});
    let restarted: PersistenceProvider | null = null;
    try {
      const scenario = await runScenario(database.persistence);
      restarted = createPostgresProvider({url: database.url});
      await restarted.connect();
      await restoreAfterFreshInstances(restarted, scenario.checkpoint, scenario.conversationId, scenario.activeIds);
    } finally {
      if (restarted) await restarted.disconnect();
      await teardownTestDatabase(database);
    }
  });
});
