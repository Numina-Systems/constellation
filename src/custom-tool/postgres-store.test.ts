// pattern: Imperative Shell

/**
 * Tests for PostgresCustomToolStore.
 * Tests persistence operations against real PostgreSQL.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createPostgresProvider } from '@/persistence/index.js';
import { createPostgresCustomToolStore } from './postgres-store.js';

const DB_CONNECTION_STRING = 'postgresql://constellation:constellation@localhost:5432/constellation';

describe('PostgresCustomToolStore', () => {
  let persistence: ReturnType<typeof createPostgresProvider>;
  let store: ReturnType<typeof createPostgresCustomToolStore>;
  const TEST_OWNER = 'test-custom-tool-' + Math.random().toString(36).substring(7);

  beforeAll(async () => {
    persistence = createPostgresProvider({ url: DB_CONNECTION_STRING });
    await persistence.connect();
    await persistence.runMigrations();
    store = createPostgresCustomToolStore(persistence);
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await persistence.query('DELETE FROM custom_tools WHERE owner LIKE $1', [TEST_OWNER + '%']);
    } catch {
      // Table may not exist if migration failed
    }
    await persistence.disconnect();
  });

  describe('create', () => {
    test('AC2.4: persists a tool definition and getByName retrieves it', async () => {
      const def = await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'persist_test',
        description: 'Test persistence',
        parameters: [
          { name: 'input', type: 'string', description: 'Input', required: true },
        ],
        code: 'const result = PARAMS.input;',
      });

      const retrieved = await store.getByName(TEST_OWNER, 'persist_test');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(def.id);
      expect(retrieved?.code).toBe(def.code);
      expect(retrieved?.description).toBe(def.description);
      expect(retrieved?.parameters).toHaveLength(1);
    });

    test('create returns definition with timestamps', async () => {
      const created = await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'timestamped_tool',
        description: 'Has timestamps',
        parameters: [],
        code: 'code',
      });

      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.created_at.getTime()).toBeLessThanOrEqual(created.updated_at.getTime());
    });

    test('create with duplicate (owner, name) throws', async () => {
      const uniqueName = 'dup-test-' + Date.now();

      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: uniqueName,
        description: 'First',
        parameters: [],
        code: 'code1',
      });

      try {
        await store.create({
          id: crypto.randomUUID(),
          owner: TEST_OWNER,
          name: uniqueName,
          description: 'Second',
          parameters: [],
          code: 'code2',
        });
        expect.unreachable('Should have thrown on duplicate');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('list', () => {
    test('AC2.4: returns all tools for owner, sorted by name', async () => {
      const toolOwner = TEST_OWNER + '-list';

      await store.create({
        id: crypto.randomUUID(),
        owner: toolOwner,
        name: 'z_tool',
        description: 'Z',
        parameters: [],
        code: 'z',
      });

      await store.create({
        id: crypto.randomUUID(),
        owner: toolOwner,
        name: 'a_tool',
        description: 'A',
        parameters: [],
        code: 'a',
      });

      await store.create({
        id: crypto.randomUUID(),
        owner: toolOwner,
        name: 'm_tool',
        description: 'M',
        parameters: [],
        code: 'm',
      });

      const tools = await store.list(toolOwner);
      expect(tools).toHaveLength(3);
      expect(tools[0]?.name).toBe('a_tool');
      expect(tools[1]?.name).toBe('m_tool');
      expect(tools[2]?.name).toBe('z_tool');
    });

    test('list returns empty for owner with no tools', async () => {
      const nonexistentOwner = 'nonexistent-' + Math.random().toString(36);
      const tools = await store.list(nonexistentOwner);
      expect(tools).toHaveLength(0);
    });
  });

  describe('getByName', () => {
    test('returns null for non-existent tool', async () => {
      const result = await store.getByName(TEST_OWNER, 'nonexistent-' + Math.random().toString(36));
      expect(result).toBeNull();
    });

    test('returns exact tool by owner and name', async () => {
      const created = await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'exact-match-' + Date.now(),
        description: 'Exact',
        parameters: [],
        code: 'code',
      });

      const retrieved = await store.getByName(TEST_OWNER, created.name);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });
  });

  describe('update', () => {
    test('modifies specific fields and returns updated definition', async () => {
      const toolName = 'update-test-' + Date.now();
      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: toolName,
        description: 'Original',
        parameters: [
          { name: 'old', type: 'string', description: 'Old', required: true },
        ],
        code: 'original',
      });

      const updated = await store.update(TEST_OWNER, toolName, {
        description: 'Updated description',
        code: 'new code',
      });

      expect(updated).toBeDefined();
      expect(updated?.description).toBe('Updated description');
      expect(updated?.code).toBe('new code');
      expect(updated?.parameters).toHaveLength(1); // unchanged
    });

    test('updates parameters', async () => {
      const toolName = 'param-update-' + Date.now();
      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: toolName,
        description: 'Test',
        parameters: [],
        code: 'code',
      });

      const newParams: ReadonlyArray<import('@/tool/types.js').ToolParameter> = [
        { name: 'a', type: 'string', description: 'A', required: true },
        { name: 'b', type: 'number', description: 'B', required: false },
      ];

      const updated = await store.update(TEST_OWNER, toolName, {
        parameters: newParams,
      });

      expect(updated?.parameters).toHaveLength(2);
      expect(updated?.parameters[0]?.name).toBe('a');
      expect(updated?.parameters[1]?.name).toBe('b');
    });

    test('updates updated_at timestamp', async () => {
      const toolName = 'timestamp-update-' + Date.now();
      const created = await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: toolName,
        description: 'Test',
        parameters: [],
        code: 'code',
      });

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await store.update(TEST_OWNER, toolName, {
        description: 'Changed',
      });

      expect(updated?.updated_at.getTime()).toBeGreaterThan(created.created_at.getTime());
    });

    test('returns null for non-existent tool', async () => {
      const result = await store.update(TEST_OWNER, 'nonexistent-' + Math.random().toString(36), {
        description: 'New',
      });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    test('removes a tool and returns true; subsequent getByName returns null', async () => {
      const toolName = 'delete-test-' + Date.now();
      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: toolName,
        description: 'To delete',
        parameters: [],
        code: 'code',
      });

      const deleted = await store.delete(TEST_OWNER, toolName);
      expect(deleted).toBe(true);

      const retrieved = await store.getByName(TEST_OWNER, toolName);
      expect(retrieved).toBeNull();
    });

    test('returns false for non-existent tool', async () => {
      const result = await store.delete(TEST_OWNER, 'nonexistent-' + Math.random().toString(36));
      expect(result).toBe(false);
    });
  });

  describe('owner isolation', () => {
    test('tools from owner A are not visible to owner B', async () => {
      const ownerA = TEST_OWNER + '-a';
      const ownerB = TEST_OWNER + '-b';

      await store.create({
        id: crypto.randomUUID(),
        owner: ownerA,
        name: 'tool_a',
        description: 'A',
        parameters: [],
        code: 'code_a',
      });

      await store.create({
        id: crypto.randomUUID(),
        owner: ownerB,
        name: 'tool_b',
        description: 'B',
        parameters: [],
        code: 'code_b',
      });

      const listA = await store.list(ownerA);
      const listB = await store.list(ownerB);

      expect(listA).toHaveLength(1);
      expect(listA[0]?.name).toBe('tool_a');

      expect(listB).toHaveLength(1);
      expect(listB[0]?.name).toBe('tool_b');

      // Cross-owner lookups return null
      const aViewed = await store.getByName(ownerB, 'tool_a');
      const bViewed = await store.getByName(ownerA, 'tool_b');

      expect(aViewed).toBeNull();
      expect(bViewed).toBeNull();
    });
  });
});
