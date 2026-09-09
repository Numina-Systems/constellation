import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createConversationHistoryStore, type PreparedCompactionPlan} from './conversation-history-store.ts';
import {createPostgresProvider} from './postgres.ts';
import {createCheckpointStore, saveAndPruneCheckpoint} from './checkpoint-store.ts';
import {createMessageStore} from './message-store.ts';
import {createConversationSearchDomain} from '@/search/domains/conversations.ts';
import {createMemoryManager} from '@/memory/manager.ts';
import {createPostgresMemoryStore} from '@/memory/postgres-store.ts';
import {restoreFromCheckpoint} from '@/agent/checkpoint-restore.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import type {PersistenceProvider, QueryFunction, TransactionScope} from './types.ts';
import type {SessionCheckpoint, AgentCheckpointState} from '@/agent/checkpoint-types.ts';
import type {TransactionOutcome, TransactionReconciliation} from '@/contracts/outcomes.ts';
import {serializeCheckpoint} from '@/agent/checkpoint-serializer.ts';
import {createDeferred} from '@/testing/deferred.ts';

let database: TestDatabase | null = null;
let persistence: PersistenceProvider | null = null;

function requirePersistence(): PersistenceProvider {
  if (persistence === null) throw new Error('integration database was not initialized');
  return persistence;
}

function createPlan(conversationId: string, sourceMessageIds: ReadonlyArray<string>, expectedRevision: number, operationId: string): PreparedCompactionPlan {
  return {
    operationId,
    conversationId,
    expectedRevision,
    sourceMessageIds,
    archiveBlocks: [{id: `archive-${operationId}`, owner: 'integration-agent', label: `history/${operationId}`, content: 'canonical archive bytes'}],
    summary: {
      id: `summary-${operationId}`,
      conversation_id: conversationId,
      role: 'assistant',
      content: 'durable summary',
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    },
  };
}

async function insertMessage(conversationId: string, id: string, content: string, createdAt: string): Promise<void> {
  await requirePersistence().query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'user', $3, $4)`, [id, conversationId, content, createdAt],
  );
}

function createCheckpoint(
  conversationId: string,
  owner: string,
  id: string,
  createdAt: string,
  messageIds: ReadonlyArray<string> = ['m1'],
  activeArchiveIds: ReadonlyArray<string> = [],
  provenanceRefs: ReadonlyArray<string> = [],
): SessionCheckpoint {
  const state: AgentCheckpointState = {
    turnNumber: 1,
    toolRound: 0,
    messageIds,
    transcriptRevision: messageIds.length,
    activeArchiveIds,
    provenanceRefs,
    workingMemory: [],
    pendingPredictions: [],
    activeInterests: [],
    compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
    recallCache: null,
  };
  return serializeCheckpoint({id, conversationId, owner, trigger: 'explicit', state, createdAt});
}

async function activeIds(conversationId: string): Promise<Array<string>> {
  const rows = await requirePersistence().query<{readonly message_id: string}>(
    'SELECT message_id FROM conversation_history_membership WHERE conversation_id = $1 ORDER BY position', [conversationId],
  );
  return rows.map((row) => row.message_id);
}

async function resetHistoryTables(): Promise<void> {
  const db = requirePersistence();
  await db.query('TRUNCATE TABLE messages CASCADE');
  await db.query('DELETE FROM operation_receipts');
}

type CompactionWriteStage = 'archive' | 'event' | 'provenance' | 'membership' | 'summary' | 'revision';

function stageForSql(sql: string): CompactionWriteStage | null {
  const normalized = sql.replaceAll(/\s+/g, ' ').trim().toUpperCase();
  if (normalized.startsWith('INSERT INTO MEMORY_BLOCKS')) return 'archive';
  if (normalized.startsWith('INSERT INTO OPERATION_RECEIPTS')) return 'event';
  if (normalized.startsWith('INSERT INTO CONVERSATION_HISTORY_PROVENANCE') || normalized.startsWith('INSERT INTO CONVERSATION_HISTORY_ARCHIVE_REFS')) return 'provenance';
  if (normalized.startsWith('DELETE FROM CONVERSATION_HISTORY_MEMBERSHIP')) return 'membership';
  if (normalized.startsWith('INSERT INTO MESSAGES')) return 'summary';
  if (normalized.startsWith('UPDATE CONVERSATION_HISTORY_STATE')) return 'revision';
  return null;
}

function createCompactionFaultProvider(base: PersistenceProvider, stage: CompactionWriteStage, timing: 'before' | 'after', reconciliationUnavailable = false): PersistenceProvider {
  function faultedQuery(query: QueryFunction): QueryFunction {
    let injected = false;
    return async function queryWithFault<T extends Record<string, unknown>>(sql: string, params: ReadonlyArray<unknown> = []): Promise<Array<T>> {
      if (!injected && stageForSql(sql) === stage && timing === 'before') {
        injected = true;
        throw new Error(`injected ${timing} ${stage} failure`);
      }
      const rows = await query<T>(sql, params);
      if (!injected && stageForSql(sql) === stage && timing === 'after') {
        injected = true;
        throw new Error(`injected ${timing} ${stage} failure`);
      }
      return rows;
    };
  }
  return {
    connect: base.connect,
    disconnect: base.disconnect,
    runMigrations: base.runMigrations,
    query: base.query,
    withTransaction: (fn) => base.withTransaction((query) => fn(faultedQuery(query))),
    withTransactionOutcome: async <T>(fn: (scope: TransactionScope) => Promise<T>, reconcile?: (outcome: TransactionOutcome<T>, query: QueryFunction) => Promise<void | TransactionReconciliation<T>>): Promise<TransactionOutcome<T>> =>
      base.withTransactionOutcome!(async (scope) => fn({...scope, query: faultedQuery(scope.query)}), reconciliationUnavailable ? async () => { throw new Error('reconciliation unavailable'); } : reconcile),
  };
}

describe('Package D AC.10/AC.11/AC.20 real PostgreSQL integration (required)', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    persistence = database.persistence;
  });

  afterEach(async () => {
    if (persistence !== null) await resetHistoryTables();
  });

  afterAll(async () => {
    if (database !== null) await teardownTestDatabase(database);
  });

  it('history_projection_migration_preserves_rows', async () => {
    const db = requirePersistence();
    const conversationId = 'migration-conversation';
    await db.query('DROP TRIGGER IF EXISTS trg_append_message_to_active_history ON messages');
    await db.query('DROP FUNCTION IF EXISTS append_message_to_active_history()');
    await db.query('DROP TABLE IF EXISTS conversation_history_archive_refs, conversation_history_provenance, conversation_history_membership, conversation_history_state CASCADE');
    await db.query('ALTER TABLE memory_blocks DROP CONSTRAINT IF EXISTS fk_memory_blocks_history_owner');
    await db.query('ALTER TABLE memory_blocks DROP COLUMN IF EXISTS history_owner_operation_id, DROP COLUMN IF EXISTS history_owned');
    await insertMessage(conversationId, 'migration-z', 'later id', '2026-01-01T00:00:02.000Z');
    await insertMessage(conversationId, 'migration-a', 'earlier timestamp', '2026-01-01T00:00:01.000Z');
    await insertMessage(conversationId, 'migration-b', 'same timestamp lower id', '2026-01-01T00:00:01.000Z');
    const before = await db.query<Record<string, unknown>>('SELECT * FROM messages ORDER BY conversation_id, created_at, id');
    const sql = readFileSync(resolve(import.meta.dir, 'migrations/016_conversation_history.sql'), 'utf8');
    await db.query(sql);
    const firstMembership = await activeIds(conversationId);
    const firstState = await db.query<{readonly revision: string}>('SELECT revision FROM conversation_history_state WHERE conversation_id = $1', [conversationId]);
    expect(firstMembership).toEqual(['migration-a', 'migration-b', 'migration-z']);
    expect(Number(firstState[0]?.revision)).toBe(3);
    const afterFirst = await db.query<Record<string, unknown>>('SELECT * FROM messages ORDER BY conversation_id, created_at, id');
    expect(afterFirst).toEqual(before);
    await db.query(sql);
    expect(await activeIds(conversationId)).toEqual(firstMembership);
    expect(await db.query('SELECT revision FROM conversation_history_state WHERE conversation_id = $1', [conversationId])).toEqual(firstState);
    expect(await db.query<Record<string, unknown>>('SELECT * FROM messages ORDER BY conversation_id, created_at, id')).toEqual(before);
  });

  it('compaction_stale_revision', async () => {
    const db = requirePersistence();
    const history = createConversationHistoryStore(db);
    await insertMessage('stale-conversation', 'stale-m1', 'source', '2026-01-01T00:00:00.000Z');
    const before = await history.readActive('stale-conversation');
    await expect(history.commitCompaction(createPlan('stale-conversation', ['stale-m1'], before.revision - 1, 'stale-operation'))).rejects.toThrow('stale compaction revision');
    expect(await history.readActive('stale-conversation')).toEqual(before);
    expect(await db.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['stale-operation'])).toEqual([]);
  });

  it('compaction_write_failure_reload_matrix', async () => {
    const stages: Array<CompactionWriteStage> = ['archive', 'event', 'provenance', 'membership', 'summary', 'revision'];
    for (const timing of ['before', 'after'] as const) {
      for (const stage of stages) {
        const conversationId = `fault-${timing}-${stage}`;
        await insertMessage(conversationId, `${conversationId}-m1`, 'one', '2026-01-01T00:00:00.000Z');
        await insertMessage(conversationId, `${conversationId}-m2`, 'two', '2026-01-01T00:00:01.000Z');
        const history = createConversationHistoryStore(requirePersistence());
        const old = await history.readActive(conversationId);
        const faultyBase = createPostgresProvider({url: (database as TestDatabase).url});
        const faulty = createCompactionFaultProvider(faultyBase, stage, timing);
        try {
          await expect(createConversationHistoryStore(faulty).commitCompaction(createPlan(conversationId, old.messages.map((message) => message.id), old.revision, `operation-${timing}-${stage}`))).rejects.toThrow(`injected ${timing} ${stage} failure`);
        } finally {
          await faulty.disconnect();
          await faultyBase.disconnect();
        }
        expect(await createConversationHistoryStore(requirePersistence()).readActive(conversationId)).toEqual(old);
        expect(await requirePersistence().query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', [`operation-${timing}-${stage}`])).toEqual([]);
      }
    }
  });

  it('compaction_commit_ack_reconciliation', async () => {
    const db = requirePersistence();
    const conversationId = 'reconcile-conversation';
    await insertMessage(conversationId, 'reconcile-m1', 'source', '2026-01-01T00:00:00.000Z');
    const faulty = createPostgresProvider({url: (database as TestDatabase).url}, {transactionFaults: {afterCommit: async () => { throw new Error('lost acknowledgement'); }}});
    try {
      const result = await createConversationHistoryStore(faulty).commitCompaction(createPlan(conversationId, ['reconcile-m1'], 1, 'reconcile-operation'));
      expect(result.receipt.operationId).toBe('reconcile-operation');
      expect(result.receipt.newRevision).toBe(2);
    } finally {
      await faulty.disconnect();
    }
    const receipt = await db.query<{readonly operation_id: string; readonly status: string}>('SELECT operation_id, status FROM operation_receipts WHERE operation_id = $1', ['reconcile-operation']);
    expect(receipt).toEqual([{operation_id: 'reconcile-operation', status: 'committed'}]);

    await insertMessage(conversationId, 'unavailable-m1', 'source', '2026-01-01T00:00:02.000Z');
    const unavailableBase = createPostgresProvider({url: (database as TestDatabase).url}, {transactionFaults: {afterCommit: async () => { throw new Error('lost acknowledgement'); }}});
    const unavailable = createCompactionFaultProvider(unavailableBase, 'revision', 'after', true);
    try {
      await expect(createConversationHistoryStore(unavailable).commitCompaction(createPlan(conversationId, ['unavailable-m1'], 3, 'unavailable-operation'))).rejects.toMatchObject({code: 'history_state_unknown'});
    } finally {
      await unavailable.disconnect();
      await unavailableBase.disconnect();
    }
    expect(await db.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', ['unavailable-operation'])).toHaveLength(1);
  });

  it('checkpoint_prune_retains_transcript', async () => {
    const db = requirePersistence();
    const conversationId = 'checkpoint-retention';
    await insertMessage(conversationId, 'retained-message', 'must survive pruning', '2026-01-01T00:00:00.000Z');
    await createConversationHistoryStore(db).commitCompaction(createPlan(conversationId, ['retained-message'], 1, 'retained-operation'));
    const checkpoints = [
      createCheckpoint(conversationId, 'checkpoint-owner', 'checkpoint-1', '2026-01-01T00:00:01.000Z'),
      createCheckpoint(conversationId, 'checkpoint-owner', 'checkpoint-2', '2026-01-01T00:00:02.000Z'),
      createCheckpoint(conversationId, 'checkpoint-owner', 'checkpoint-3', '2026-01-01T00:00:03.000Z'),
    ];
    const store = createCheckpointStore(db);
    await store.save(checkpoints[0]!);
    await store.save(checkpoints[1]!);
    const deleted = await saveAndPruneCheckpoint(db, checkpoints[2]!, 1);
    expect(deleted).toBe(2);
    expect(await store.load('checkpoint-1')).toBeNull();
    expect(await store.load('checkpoint-2')).toBeNull();
    expect(await store.load('checkpoint-3')).not.toBeNull();
    expect(await db.query('SELECT id FROM messages WHERE id = $1', ['retained-message'])).toHaveLength(1);
    expect(await db.query('SELECT operation_id FROM conversation_history_provenance WHERE operation_id = $1', ['retained-operation'])).toHaveLength(1);
    expect(await db.query('SELECT archive_block_id FROM conversation_history_archive_refs WHERE operation_id = $1', ['retained-operation'])).toHaveLength(1);
  });

  it('readActive snapshot consistency', async () => {
    const conversationId = 'snapshot-consistency';
    await insertMessage(conversationId, 'snapshot-0', 'initial', '2026-01-01T00:00:00.000Z');
    const db = requirePersistence();
    const appendProvider = createPostgresProvider({url: (database as TestDatabase).url});
    const appendStarted = createDeferred<void>();
    const appendPersistence = {
      ...appendProvider,
      withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T> {
        appendStarted.resolve(undefined);
        return appendProvider.withTransaction(fn);
      },
    } satisfies PersistenceProvider;
    const appendHistory = createConversationHistoryStore(appendPersistence);
    const readerEntered = createDeferred<void>();
    const releaseReader = createDeferred<void>();
    const reader = {
      ...db,
      withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T> {
        return db.withTransaction(async (query) => {
          let stateSeen = false;
          const gatedQuery: QueryFunction = async <R extends Record<string, unknown>>(sql: string, params?: ReadonlyArray<unknown>): Promise<Array<R>> => {
            const rows = await query<R>(sql, params);
            if (!stateSeen && /^SELECT revision FROM conversation_history_state/i.test(sql)) {
              stateSeen = true;
              readerEntered.resolve(undefined);
              await releaseReader.promise;
            }
            return rows;
          };
          return fn(gatedQuery);
        });
      },
    } satisfies PersistenceProvider;
    try {
      const readPromise = createConversationHistoryStore(reader).readActive(conversationId);
      await readerEntered.promise;
      const appendPromise = appendHistory.append({id: 'snapshot-1', conversation_id: conversationId, role: 'user', content: 'message 1', created_at: new Date('2026-01-01T00:00:01.000Z')});
      await appendStarted.promise;
      let appendSettled = false;
      void appendPromise.then(() => { appendSettled = true; });
      await Promise.resolve();
      expect(appendSettled).toBe(false);
      releaseReader.resolve(undefined);
      const snapshot = await readPromise;
      await appendPromise;
      expect(snapshot.revision).toBe(snapshot.messages.length);
      expect(snapshot).toMatchObject({revision: 1, messages: [{id: 'snapshot-0'}]});
    } finally {
      await appendProvider.disconnect();
    }
  });

  it('foreign_message_active_prevention', async () => {
    const db = requirePersistence();
    await insertMessage('foreign-conversation', 'foreign-message', 'foreign', '2026-01-01T00:00:00.000Z');
    await expect(db.query(
      'INSERT INTO conversation_history_membership (conversation_id, message_id, position) VALUES ($1, $2, 0)', ['local-conversation', 'foreign-message'],
    )).rejects.toThrow();
  });

  it('retained_archive_rejects_public_mutation', async () => {
    const db = requirePersistence();
    const conversationId = 'archive-integrity';
    await insertMessage(conversationId, 'archive-source', 'source', '2026-01-01T00:00:00.000Z');
    const result = await createConversationHistoryStore(db).commitCompaction(createPlan(conversationId, ['archive-source'], 1, 'archive-integrity-operation'));
    const archiveId = result.receipt.sourceArchiveIds[0];
    if (archiveId === undefined) throw new Error('test setup missing archive');
    for (const statement of [
      'UPDATE memory_blocks SET content = $2 WHERE id = $1',
      'UPDATE memory_blocks SET owner = $2 WHERE id = $1',
      'UPDATE memory_blocks SET tier = $2 WHERE id = $1',
      'UPDATE memory_blocks SET permission = $2 WHERE id = $1',
      'DELETE FROM memory_blocks WHERE id = $1',
    ]) {
      const params = statement.startsWith('DELETE') ? [archiveId] : [archiveId, statement.includes('tier') ? 'working' : statement.includes('permission') ? 'readwrite' : 'changed'];
      await expect(db.query(statement, params)).rejects.toThrow('history-owned memory block is immutable');
    }
    expect(await db.query('SELECT content, history_owned FROM memory_blocks WHERE id = $1', [archiveId])).toEqual([{content: 'canonical archive bytes', history_owned: true}]);
    await expect(createConversationHistoryStore(db).commitCompaction(createPlan(conversationId, ['archive-source'], 1, 'archive-integrity-operation'))).resolves.toMatchObject({receipt: result.receipt});
  });

  it('archivist_preserves_history_owned_archives', async () => {
    const db = requirePersistence();
    const conversationId = `archive-maintenance-${crypto.randomUUID()}`;
    const owner = 'archive-maintenance-owner';
    await insertMessage(conversationId, 'archive-maintenance-source', 'source', '2026-01-01T00:00:00.000Z');
    const committed = await createConversationHistoryStore(db).commitCompaction(
      createPlan(conversationId, ['archive-maintenance-source'], 1, `archive-maintenance-${crypto.randomUUID()}`),
    );
    const archiveId = committed.receipt.sourceArchiveIds[0];
    if (archiveId === undefined) throw new Error('test setup missing archive');
    const memoryStore = createPostgresMemoryStore(db);
    const constraints = {allowedTiers: ['archival'] as const, requireUnpinned: false, requireReadwrite: false};

    await expect(memoryStore.updateForMaintenance(owner, archiveId, 'tampered', null, constraints)).rejects.toThrow('history-owned memory block is immutable');
    await expect(memoryStore.deleteForMaintenance(owner, archiveId, constraints)).rejects.toThrow('history-owned memory block is immutable');
    expect(await db.query('SELECT content, history_owned FROM memory_blocks WHERE id = $1', [archiveId])).toEqual([
      {content: 'canonical archive bytes', history_owned: true},
    ]);
  });

  it('checkpoint_restore_archive_content_survives_maintenance', async () => {
    const db = requirePersistence();
    const conversationId = `archive-restore-${crypto.randomUUID()}`;
    const owner = 'archive-restore-owner';
    await insertMessage(conversationId, 'archive-restore-source', 'source', '2026-01-01T00:00:00.000Z');
    const operationId = `archive-restore-${crypto.randomUUID()}`;
    const history = createConversationHistoryStore(db);
    const committed = await history.commitCompaction(createPlan(conversationId, ['archive-restore-source'], 1, operationId));
    const archiveId = committed.receipt.sourceArchiveIds[0];
    if (archiveId === undefined) throw new Error('test setup missing archive');
    const activeBeforeRestore = await history.readActive(conversationId);
    const checkpoint = createCheckpoint(
      conversationId,
      owner,
      '33333333-3333-4333-8333-333333333333',
      '2026-01-01T00:00:02.000Z',
      activeBeforeRestore.messages.map((message) => message.id),
      [archiveId],
      [operationId],
    );
    const memoryStore = createPostgresMemoryStore(db);
    const constraints = {allowedTiers: ['archival'] as const, requireUnpinned: false, requireReadwrite: false};
    await expect(memoryStore.updateForMaintenance(owner, archiveId, 'tampered', null, constraints)).rejects.toThrow('history-owned memory block is immutable');
    await expect(memoryStore.deleteForMaintenance(owner, archiveId, constraints)).rejects.toThrow('history-owned memory block is immutable');

    const memory = createMemoryManager(memoryStore, {
      embed: async () => [0],
      embedBatch: async (texts: ReadonlyArray<string>) => texts.map(() => [0]),
      dimensions: 1,
    }, owner);
    const restored = await restoreFromCheckpoint(checkpoint, {
      persistence: db,
      memory,
      messageStore: createMessageStore(db, history),
      historyStore: history,
      traceRecorder: {record: async () => undefined},
      owner,
    });

    expect(restored.messageCount).toBe(activeBeforeRestore.messages.length);
    expect(await db.query('SELECT content, history_owned FROM memory_blocks WHERE id = $1', [archiveId])).toEqual([
      {content: 'canonical archive bytes', history_owned: true},
    ]);
    expect(await db.query(
      'SELECT archive_block_id FROM conversation_history_archive_refs WHERE operation_id = $1',
      [`checkpoint-restore-${checkpoint.id}`],
    )).toEqual([{archive_block_id: archiveId}]);
  });

  it('search_history_labels_retained_rows', async () => {
    const db = requirePersistence();
    const conversationId = 'search-history';
    await insertMessage(conversationId, 'search-source', 'historical needle', '2026-01-01T00:00:00.000Z');
    await createConversationHistoryStore(db).commitCompaction(createPlan(conversationId, ['search-source'], 1, 'search-operation'));
    const domain = createConversationSearchDomain(db);
    const params = {query: 'needle', mode: 'keyword' as const, domains: ['conversations'] as const, embedding: null, limit: 10, startTime: null, endTime: null, role: null, tier: null};
    const active = await domain.search({...params, history: 'active'});
    const historical = await domain.search({...params, history: 'historical'});
    expect(active.some((result) => result.id === 'search-source')).toBe(false);
    expect(historical.find((result) => result.id === 'search-source')?.metadata.historyStatus).toBe('superseded');
  });
});
