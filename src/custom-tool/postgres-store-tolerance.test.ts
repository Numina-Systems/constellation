import {describe, expect, test} from 'bun:test';
import type {CodeRuntime} from '@/runtime/types.js';
import type {PersistenceProvider} from '@/persistence/types.js';
import {createCustomToolManager} from './manager.js';
import {createPostgresCustomToolStore} from './postgres-store.js';

function createFakePersistence(rows: ReadonlyArray<Record<string, unknown>>): {readonly persistence: PersistenceProvider; readonly writes: Array<string>} {
  const writes: Array<string> = [];
  const persistence: PersistenceProvider = {
    async connect() {},
    async disconnect() {},
    async runMigrations() {},
    async query<T extends Record<string, unknown>>(sql: string): Promise<Array<T>> {
      if (sql.startsWith('SELECT * FROM custom_tools')) {
        // Test fixture rows are deliberately shaped like database rows.
        return [...rows] as Array<T>;
      }
      writes.push(sql);
      return [];
    },
    async withTransaction<T>(fn: (query: PersistenceProvider['query']) => Promise<T>): Promise<T> {
      return fn(persistence.query);
    },
  };
  return {persistence, writes};
}

function runtime(): CodeRuntime {
  return {
    async execute(): ReturnType<CodeRuntime['execute']> {
      return {success: true, output: 'ok', error: null, tool_calls_made: 0, duration_ms: 0};
    },
  };
}

describe('custom_tool_postgres_load_tolerance', () => {
  test('loads valid rows, reports corrupt metadata, quarantines it, and never rewrites storage', async () => {
    const rows: Array<Record<string, unknown>> = [
      {
        id: 'valid-id', owner: 'loader-owner', name: 'valid_tool', description: 'valid',
        parameters: JSON.stringify({parameters: []}), code: 'output("valid")',
        created_at: new Date(0), updated_at: new Date(0),
      },
      {
        id: 'corrupt-id', owner: 'loader-owner', name: 'corrupt_tool', description: 'corrupt',
        parameters: '{not-json', code: 'output("corrupt")',
        created_at: new Date(0), updated_at: new Date(0),
      },
    ];
    const {persistence, writes} = createFakePersistence(rows);
    const store = createPostgresCustomToolStore(persistence);
    const registry = (await import('@/tool/registry.js')).createToolRegistry();
    const manager = createCustomToolManager({
      store,
      registry,
      runtime: runtime(),
      secretResolver: {listKeys: async () => [], resolve: async () => ({})},
      owner: 'loader-owner',
    });

    await expect(manager.loadAll()).resolves.toBeUndefined();

    expect(registry.getDefinitions().map((definition) => definition.name)).toEqual(['valid_tool']);
    expect(registry.getQuarantines?.()).toEqual([{
      name: 'corrupt_tool',
      reason: expect.stringContaining('invalid persisted custom tool metadata'),
    }]);
    expect(registry.getQuarantines?.()[0]?.reason.length).toBeLessThanOrEqual(500);
    expect(writes).toEqual([]);
    expect(rows[1]?.['parameters']).toBe('{not-json');

    const loaded = await store.listWithIssues?.('loader-owner');
    expect(loaded?.definitions.map((definition) => definition.name)).toEqual(['valid_tool']);
    expect(loaded?.issues).toHaveLength(1);
    expect(loaded?.issues[0]?.name).toBe('corrupt_tool');
  });
});
