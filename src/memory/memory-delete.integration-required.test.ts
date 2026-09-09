import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {createPostgresMemoryStore} from './postgres-store.ts';
import {createMemoryManager} from './manager.ts';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import {createMockEmbeddingProvider} from '../integration/test-helpers.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';

const OWNER = 'memory-delete-integration-owner';
const FOREIGN_OWNER = 'memory-delete-integration-foreign';
let database: TestDatabase;
let persistence: PersistenceProvider;
let store: ReturnType<typeof createPostgresMemoryStore>;

async function insertBlock(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await persistence.query(
    `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
    [id, overrides['owner'] ?? OWNER, overrides['tier'] ?? 'working', overrides['label'] ?? id,
      overrides['content'] ?? 'content', overrides['permission'] ?? 'readwrite', overrides['pinned'] ?? false],
  );
  return id;
}

describe('AC.2 / memory_delete_authorization_matrix (integration-required)', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    persistence = database.persistence;
    store = createPostgresMemoryStore(persistence);
  });

  afterAll(async () => {
    if (database) await teardownTestDatabase(database);
  });

  it('rejects foreign and missing IDs without changing rows or events', async () => {
    const foreignId = await insertBlock({owner: FOREIGN_OWNER});
    const manager = createMemoryManager(store, createMockEmbeddingProvider(), OWNER);
    for (const id of [foreignId, 'missing-memory-delete-id']) {
      await expect(manager.deleteBlock(id)).rejects.toThrow('memory block not found');
    }
    const rows = await persistence.query<{id: string}>('SELECT id FROM memory_blocks WHERE id = $1', [foreignId]);
    const events = await persistence.query<{id: string}>(
      "SELECT id FROM memory_events WHERE event_type = 'delete' AND block_id IS NULL",
    );
    expect(rows).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it('rejects readonly, familiar, append-only, pinned, and core blocks', async () => {
    const cases: Array<Record<string, unknown>> = [
      {permission: 'readonly'}, {permission: 'familiar'}, {permission: 'append'},
      {pinned: true}, {tier: 'core'},
    ];
    const manager = createMemoryManager(store, createMockEmbeddingProvider(), OWNER);
    for (const overrides of cases) {
      const id = await insertBlock(overrides);
      await expect(manager.deleteBlock(id)).rejects.toThrow();
      const rows = await persistence.query<{id: string}>('SELECT id FROM memory_blocks WHERE id = $1', [id]);
      expect(rows).toHaveLength(1);
    }
  });

  it('permits an owner-owned unprotected readwrite non-core block atomically', async () => {
    const id = await insertBlock();
    const manager = createMemoryManager(store, createMockEmbeddingProvider(), OWNER);
    await manager.deleteBlock(id);
    const rows = await persistence.query<{id: string}>('SELECT id FROM memory_blocks WHERE id = $1', [id]);
    const events = await persistence.query<{event_type: string}>('SELECT event_type FROM memory_events WHERE block_id IS NULL AND event_type = \'delete\'');
    expect(rows).toHaveLength(0);
    expect(events.length).toBeGreaterThan(0);
  });

  // The delete and permission update serialize on the same row lock. Whichever
  // transaction wins determines the only valid outcome: a committed readonly
  // update makes delete reject eventlessly, or a committed delete makes the
  // updater affect zero rows.
  it('memory_delete_permission_race', async () => {
    const id = await insertBlock();
    const existingEvents = await persistence.query<{id: string}>(
      "SELECT id FROM memory_events WHERE block_id IS NULL AND event_type = 'delete'",
    );
    const updater = createPostgresProvider({url: database.url});
    await updater.connect();

    try {
      const manager = createMemoryManager(store, createMockEmbeddingProvider(), OWNER);
      const deletion = manager.deleteBlock(id);
      const update = updater.withTransaction(async (query) => {
        const rows = await query<{id: string}>('SELECT id FROM memory_blocks WHERE id = $1 FOR UPDATE', [id]);
        if (rows.length === 0) return {updated: false};
        const updatedRows = await query<{id: string}>(
          'UPDATE memory_blocks SET permission = \'readonly\' WHERE id = $1 RETURNING id',
          [id],
        );
        return {updated: updatedRows.length === 1};
      });
      const [deleteResult, updateResult] = await Promise.allSettled([deletion, update]);

      const rows = await persistence.query<{id: string; permission: string}>(
        'SELECT id, permission FROM memory_blocks WHERE id = $1',
        [id],
      );
      const events = await persistence.query<{id: string}>(
        "SELECT id FROM memory_events WHERE block_id IS NULL AND event_type = 'delete'",
      );
      const deletedFirst = deleteResult.status === 'fulfilled';
      const rejectedAfterUpdate = deleteResult.status === 'rejected';
      expect(deletedFirst !== rejectedAfterUpdate).toBe(true);

      if (rejectedAfterUpdate) {
        expect(updateResult.status).toBe('fulfilled');
        if (updateResult.status === 'fulfilled') expect(updateResult.value.updated).toBe(true);
        expect(rows).toEqual([{id, permission: 'readonly'}]);
        expect(events).toHaveLength(existingEvents.length);
      } else {
        expect(updateResult.status).toBe('fulfilled');
        if (updateResult.status === 'fulfilled') expect(updateResult.value.updated).toBe(false);
        expect(rows).toHaveLength(0);
        expect(events).toHaveLength(existingEvents.length + 1);
      }
    } finally {
      await updater.disconnect();
    }
  });
});
