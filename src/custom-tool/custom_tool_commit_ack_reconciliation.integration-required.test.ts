import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import {createToolRegistry} from '@/tool/registry.ts';
import type {CustomToolDefinition, CustomToolStore} from './types.ts';
import {createCustomToolManager} from './manager.ts';
import {createPostgresCustomToolStore} from './postgres-store.ts';

function runtime(): CodeRuntime {
  return {
    async execute(): Promise<ReturnType<CodeRuntime['execute']> extends Promise<infer TResult> ? TResult : never> {
      return {success: true, output: 'ok', error: null, tool_calls_made: 0, duration_ms: 0};
    },
  };
}

function definition(name: string, description = 'tool'): CustomToolDefinition {
  return {id: crypto.randomUUID(), owner: 'ack-owner', name, description, parameters: [], code: 'output("ok")', created_at: new Date(0), updated_at: new Date(0)};
}

type FakeOutcome = 'confirmed_commit' | 'reconciled_commit' | 'confirmed_rollback' | 'commit_unknown';
type MutableFakeStore = CustomToolStore & Readonly<{setOutcome: (outcome: FakeOutcome) => void}>;

function fakeStore(outcome: FakeOutcome): MutableFakeStore {
  const rows = new Map<string, CustomToolDefinition>();
  let currentOutcome = outcome;
  return {
    setOutcome(nextOutcome) { currentOutcome = nextOutcome; },
    async create(candidate) { rows.set(candidate.name, {...candidate, created_at: new Date(0), updated_at: new Date(0)}); return rows.get(candidate.name) as CustomToolDefinition; },
    async update(_owner, name, patch) { const prior = rows.get(name); if (!prior) return null; const next = {...prior, ...patch}; rows.set(name, next); return next; },
    async delete(_owner, name) { return rows.delete(name); },
    async list() { return [...rows.values()]; },
    async getByName(_owner, name) { return rows.get(name) ?? null; },
    async mutate(_operationId, _operationType, action) {
      const value = await action(async <T extends Record<string, unknown>>(_sql: string, _params?: ReadonlyArray<unknown>): Promise<Array<T>> => []);
      if (currentOutcome === 'confirmed_commit') return {status: 'confirmed_commit', value};
      if (currentOutcome === 'reconciled_commit') return {status: 'reconciled_commit', value: value as CustomToolDefinition, error: new Error('lost acknowledgement')};
      if (currentOutcome === 'confirmed_rollback') return {status: 'confirmed_rollback', error: new Error('rolled back')};
      return {status: 'commit_unknown', error: new Error('reconciliation unavailable')};
    },
  };
}

function managerFor(store: CustomToolStore, registry = createToolRegistry()): ReturnType<typeof createCustomToolManager> {
  return createCustomToolManager({store, registry, runtime: runtime(), secretResolver: {listKeys: async () => [], resolve: async () => ({})}, owner: 'ack-owner'});
}

describe('custom_tool_commit_ack_reconciliation', () => {
  test('fake supplement covers create/update/delete committed and unknown outcomes', async () => {
    const createStore = fakeStore('confirmed_commit');
    const createManager = managerFor(createStore);
    await expect(createManager.create({name: 'create_tool', description: 'created', parameters: [], code: 'output("ok")'})).resolves.toHaveProperty('name', 'create_tool');

    const updateStore = fakeStore('confirmed_commit');
    const updateManager = managerFor(updateStore);
    await updateManager.create({name: 'update_tool', description: 'old', parameters: [], code: 'output("old")'});
    await expect(updateManager.update('update_tool', {description: 'new'})).resolves.toHaveProperty('description', 'new');

    const deleteStore = fakeStore('confirmed_commit');
    const deleteManager = managerFor(deleteStore);
    await deleteManager.create({name: 'delete_tool', description: 'delete', parameters: [], code: 'output("ok")'});
    await expect(deleteManager.delete('delete_tool')).resolves.toBeUndefined();

    const reconciledUpdateStore = fakeStore('confirmed_commit');
    const reconciledUpdateManager = managerFor(reconciledUpdateStore);
    await reconciledUpdateManager.create({name: 'reconciled_update', description: 'old', parameters: [], code: 'output("old")'});
    reconciledUpdateStore.setOutcome('reconciled_commit');
    await expect(reconciledUpdateManager.update('reconciled_update', {description: 'new'})).resolves.toHaveProperty('description', 'new');

    const reconciledDeleteStore = fakeStore('confirmed_commit');
    const reconciledDeleteManager = managerFor(reconciledDeleteStore);
    await reconciledDeleteManager.create({name: 'reconciled_delete', description: 'delete', parameters: [], code: 'output("ok")'});
    reconciledDeleteStore.setOutcome('reconciled_commit');
    await expect(reconciledDeleteManager.delete('reconciled_delete')).resolves.toBeUndefined();

    const unknownUpdateStore = fakeStore('confirmed_commit');
    const unknownUpdateRegistry = createToolRegistry();
    const unknownUpdateManager = managerFor(unknownUpdateStore, unknownUpdateRegistry);
    await unknownUpdateManager.create({name: 'unknown_update', description: 'old', parameters: [], code: 'output("old")'});
    unknownUpdateStore.setOutcome('commit_unknown');
    await expect(unknownUpdateManager.update('unknown_update', {description: 'new'})).rejects.toThrow('outcome unknown');
    expect(unknownUpdateRegistry.getQuarantines?.()).toEqual([{name: 'unknown_update', reason: expect.stringContaining('reconciliation unavailable')}]);

    const unknownDeleteStore = fakeStore('confirmed_commit');
    const unknownDeleteRegistry = createToolRegistry();
    const unknownDeleteManager = managerFor(unknownDeleteStore, unknownDeleteRegistry);
    await unknownDeleteManager.create({name: 'unknown_delete', description: 'delete', parameters: [], code: 'output("ok")'});
    unknownDeleteStore.setOutcome('commit_unknown');
    await expect(unknownDeleteManager.delete('unknown_delete')).rejects.toThrow('outcome unknown');
    expect(unknownDeleteRegistry.getQuarantines?.()).toEqual([{name: 'unknown_delete', reason: expect.stringContaining('reconciliation unavailable')}]);
  });

  test('integration setup is visible when the required database is unavailable', async () => {
    if (!process.env['TEST_DATABASE_ADMIN_URL']) {
      throw new Error('integration prerequisites unavailable: TEST_DATABASE_ADMIN_URL is required; refusing to skip');
    }
    expect(process.env['TEST_DATABASE_ADMIN_URL']).toBeTruthy();
  });
});

if (process.env['TEST_DATABASE_ADMIN_URL']) describe('custom_tool_commit_ack_reconciliation PostgreSQL execution', () => {
  let database: TestDatabase | null = null;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    if (database !== null) await teardownTestDatabase(database);
  });

  test('creates the isolated database and exposes the receipt-backed store', async () => {
    if (database === null) throw new Error('database setup did not complete');
    const store = createPostgresCustomToolStore(database.persistence);
    const created = await store.create(definition('postgres_tool'));
    expect(created.name).toBe('postgres_tool');
  });

  test('lost acknowledgement can be reconciled through a separate provider connection', async () => {
    if (database === null) throw new Error('database setup did not complete');
    const primary = createPostgresProvider({url: database.url}, {transactionFaults: {afterCommit: async () => {throw new Error('lost acknowledgement');}}});
    await primary.connect();
    try {
      const store = createPostgresCustomToolStore(primary);
      const operationId = crypto.randomUUID();
      const result = await store.mutate?.(operationId, 'create', async (query) => {
        await query('INSERT INTO operation_receipts (operation_id, operation_type, status, details) VALUES ($1, $2, $3, $4::jsonb)', [operationId, 'custom_tool_create', 'committed', '{}']);
        return true;
      });
      expect(result?.status).toBe('reconciled_commit');
    } finally {
      await primary.disconnect();
    }
  });
});
