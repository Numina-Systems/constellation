import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import type {ConversationMessage} from '@/agent/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import {createCompactor} from './compactor.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';

function emptyMemory(): MemoryManager {
  return {
    getCoreBlocks: async () => [],
    getWorkingBlocks: async () => [],
    buildSystemPrompt: async () => '',
    read: async () => [],
    write: async () => ({applied: false, error: 'durable test does not use memory'}),
    list: async () => [],
    deleteBlock: async () => undefined,
    moveBlock: async () => { throw new Error('durable test does not use memory'); },
    getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}),
    getPendingMutations: async () => [],
    approveMutation: async () => { throw new Error('durable test does not use memory'); },
    rejectMutation: async () => { throw new Error('durable test does not use memory'); },
  };
}

function response(text: string): ModelResponse {
  return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

function model(responses: ReadonlyArray<ModelResponse>): ModelProvider {
  let index = 0;
  return {
    complete: async (_request: ModelRequest) => responses[Math.min(index++, responses.length - 1)] ?? response('summary'),
    stream: async function* () { yield {type: 'message_stop', message: {stop_reason: 'end_turn'}}; },
  };
}

async function appendPair(
  history: ReturnType<typeof createConversationHistoryStore>,
  conversationId: string,
  suffix: string,
): Promise<void> {
  await history.append({id: `${suffix}-user`, conversation_id: conversationId, role: 'user', content: `objective ${suffix}`, created_at: new Date('2026-01-01T00:00:00.000Z')});
  await history.append({id: `${suffix}-assistant`, conversation_id: conversationId, role: 'assistant', content: `response ${suffix}`, created_at: new Date('2026-01-01T00:00:01.000Z')});
}

function createCompactorFor(
  persistence: PersistenceProvider,
  historyStore: ReturnType<typeof createConversationHistoryStore>,
  provider: ModelProvider,
  overrides: Readonly<Partial<Parameters<typeof createCompactor>[0]['config']>> = {},
) {
  return createCompactor({
    model: provider,
    memory: emptyMemory(),
    persistence,
    historyStore,
    modelName: 'phase4-integration-fake',
    config: {
      chunkSize: 2,
      keepRecent: 0,
      maxSummaryTokens: 128,
      clipFirst: 0,
      clipLast: 0,
      prompt: null,
      maxRetries: 0,
      ...overrides,
    },
  });
}

let database: TestDatabase | null = null;
let persistence: PersistenceProvider | null = null;
const hasIntegrationDatabase = Boolean(process.env['TEST_DATABASE_ADMIN_URL']);

function requirePersistence(): PersistenceProvider {
  if (persistence === null) throw new Error('integration database was not initialized');
  return persistence;
}

async function activeMessages(conversationId: string): Promise<ReadonlyArray<ConversationMessage>> {
  return (await createConversationHistoryStore(requirePersistence()).readActive(conversationId)).messages;
}

describe('Phase 4 compaction PostgreSQL integration gate prerequisite', () => {
  it('integration_mode_requires_database', () => {
    if (!hasIntegrationDatabase) throw new Error('integration database required: set TEST_DATABASE_ADMIN_URL');
    expect(hasIntegrationDatabase).toBe(true);
  });
});

describe.skipIf(!hasIntegrationDatabase)('Phase 4 compaction PostgreSQL integration gate', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    persistence = database.persistence;
  });

  afterAll(async () => {
    if (database !== null) await teardownTestDatabase(database);
  });

  it('compaction_commit_ack_reconciliation', async () => {
    const db = requirePersistence();
    const conversationId = `phase4-ack-${crypto.randomUUID()}`;
    const history = createConversationHistoryStore(db);
    await appendPair(history, conversationId, 'ack');
    const result = await createCompactorFor(db, history, model([response('cycle one summary')])).compress([], conversationId);
    expect(result.failed).not.toBe(true);
    expect(result.archiveIds?.length).toBeGreaterThan(0);
    expect((await history.readActive(conversationId)).revision).toBe(3);
  });

  it('compaction_write_failure_reload_matrix', async () => {
    const db = requirePersistence();
    const conversationId = `phase4-write-${crypto.randomUUID()}`;
    const history = createConversationHistoryStore(db);
    await appendPair(history, conversationId, 'write');
    const before = await history.readActive(conversationId);
    const faulty = createPostgresProvider({url: database?.url ?? ''}, {transactionFaults: {beforeCommit: async () => { throw new Error('injected write failure'); }}});
    await faulty.connect();
    try {
      const faultyHistory = createConversationHistoryStore(faulty);
      const result = await createCompactorFor(faulty, faultyHistory, model([response('must not publish')])).compress([], conversationId);
      expect(result.failed).toBe(true);
      expect(result.failureCode).toBe('intervention_required');
    } finally {
      await faulty.disconnect();
    }
    expect(await history.readActive(conversationId)).toEqual(before);
  });

  it('recursive_replacement_failure_retains_sources', async () => {
    const db = requirePersistence();
    const conversationId = `phase4-recursive-${crypto.randomUUID()}`;
    const history = createConversationHistoryStore(db);
    await appendPair(history, conversationId, 'recursive-a');
    await appendPair(history, conversationId, 'recursive-b');
    const before = await history.readActive(conversationId);
    const faulty = createPostgresProvider({url: database?.url ?? ''}, {transactionFaults: {beforeCommit: async () => { throw new Error('injected recursive publication failure'); }}});
    await faulty.connect();
    try {
      const faultyHistory = createConversationHistoryStore(faulty);
      const result = await createCompactorFor(faulty, faultyHistory, model([response('summary a'), response('summary b'), response('recursive summary')]), {chunkSize: 1}).compress([], conversationId);
      expect(result.failed).toBe(true);
    } finally {
      await faulty.disconnect();
    }
    expect((await history.readActive(conversationId)).messages.map((message) => message.id)).toEqual(before.messages.map((message) => message.id));
  });

  it('compaction_stale_revision', async () => {
    const db = requirePersistence();
    const conversationId = `phase4-stale-${crypto.randomUUID()}`;
    const base = createConversationHistoryStore(db);
    await appendPair(base, conversationId, 'stale');
    const current = await base.readActive(conversationId);
    const staleHistory = {...base, readActive: async (id: string) => ({...current, conversationId: id, revision: current.revision - 1})};
    const result = await createCompactorFor(db, staleHistory, model([response('not called')])).compress([], conversationId);
    expect(result.failed).toBe(true);
    expect(result.failureCode).toBe('history_stale_revision');
    expect((await activeMessages(conversationId)).map((message) => message.id)).toEqual(current.messages.map((message) => message.id));
  });
});
