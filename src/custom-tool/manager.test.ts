// pattern: Imperative Shell

/**
 * Tests for CustomToolManager.
 * Verifies CRUD operations, registry integration, tool execution, and edge cases.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { createToolRegistry } from '@/tool/registry.js';
import type { ToolRegistry, ToolParameter } from '@/tool/types.js';
import type { CodeRuntime } from '@/runtime/types.js';
import type { SecretResolver } from '@/secrets/resolver.js';
import type { CustomToolStore, CustomToolDefinition } from './types.js';
import { createCustomToolManager } from './manager.js';

// Mock SecretResolver
function createMockSecretResolver(): SecretResolver {
  return {
    async listKeys() {
      return ['TEST_SECRET', 'API_KEY'];
    },
    async resolve() {
      return {
        TEST_SECRET: 'secret-value',
        API_KEY: 'api-key-value',
      };
    },
  };
}

// Mock CodeRuntime
function createMockCodeRuntime(): CodeRuntime {
  return {
    async execute(code) {
      // Simple mock: return success with captured code length
      return {
        success: true,
        output: `Executed code length: ${code.length}`,
        error: null,
        tool_calls_made: 0,
        duration_ms: 10,
      };
    },
  };
}

// In-memory CustomToolStore for testing
function createMockCustomToolStore(): CustomToolStore {
  const storage = new Map<string, CustomToolDefinition>();

  return {
    async create(def) {
      const key = `${def.owner}:${def.name}`;
      if (storage.has(key)) {
        throw new Error(`Tool already exists: ${def.name}`);
      }
      const withDates = {
        ...def,
        created_at: new Date(),
        updated_at: new Date(),
      };
      storage.set(key, withDates);
      return withDates;
    },

    async update(owner, name, patch) {
      const key = `${owner}:${name}`;
      const existing = storage.get(key);
      if (!existing) return null;

      const updated = {
        ...existing,
        ...patch,
        updated_at: new Date(),
      };
      storage.set(key, updated);
      return updated;
    },

    async delete(owner, name) {
      const key = `${owner}:${name}`;
      return storage.delete(key);
    },

    async list(owner) {
      const results: Array<CustomToolDefinition> = [];
      for (const [key, def] of storage) {
        if (key.startsWith(`${owner}:`)) {
          results.push(def);
        }
      }
      return results.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getByName(owner, name) {
      return storage.get(`${owner}:${name}`) ?? null;
    },
  };
}

describe('CustomToolManager', () => {
  let manager: ReturnType<typeof createCustomToolManager>;
  let registry: ToolRegistry;
  let store: CustomToolStore;
  let runtime: CodeRuntime;
  let secretResolver: SecretResolver;
  const TEST_OWNER = 'test-agent';

  beforeEach(() => {
    registry = createToolRegistry();
    store = createMockCustomToolStore();
    runtime = createMockCodeRuntime();
    secretResolver = createMockSecretResolver();

    manager = createCustomToolManager({
      store,
      registry,
      runtime,
      secretResolver,
      owner: TEST_OWNER,
    });
  });

  describe('create', () => {
    test('AC2.2: after create(), tool appears in registry.getDefinitions()', async () => {
      await manager.create({
        name: 'my_tool',
        description: 'Test tool',
        parameters: [
          { name: 'input', type: 'string', description: 'Input', required: true },
        ],
        code: 'const result = PARAMS.input;',
      });

      const definitions = registry.getDefinitions();
      const found = definitions.find(d => d.name === 'my_tool');
      expect(found).toBeDefined();
      expect(found?.description).toBe('Test tool');
      expect(found?.parameters).toHaveLength(1);
    });

    test('AC2.2: after create(), tool appears in registry.toModelTools()', async () => {
      await manager.create({
        name: 'my_tool',
        description: 'Test tool',
        parameters: [],
        code: 'output("done")',
      });

      const modelTools = registry.toModelTools();
      const found = modelTools.find(t => t.name === 'my_tool');
      expect(found).toBeDefined();
    });

    test('AC2.3: after create(), tool appears in registry.generateStubs()', async () => {
      await manager.create({
        name: 'my_tool',
        description: 'Test tool',
        parameters: [
          { name: 'query', type: 'string', description: 'Query', required: true },
        ],
        code: 'const result = PARAMS.query;',
      });

      const stubs = registry.generateStubs();
      expect(stubs).toContain('my_tool');
      expect(stubs).toContain('query');
    });

    test('AC2.7: create() with conflicting built-in tool name throws error', async () => {
      // Register a built-in tool first
      registry.register({
        definition: {
          name: 'memory_read',
          description: 'Built-in tool',
          parameters: [],
        },
        handler: async () => ({ success: true, output: '' }),
      });

      try {
        await manager.create({
          name: 'memory_read',
          description: 'Conflicting tool',
          parameters: [],
          code: 'output("test")',
        });
        expect.unreachable('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('conflicts');
      }
    });

    test('create() persists to store', async () => {
      await manager.create({
        name: 'persistent_tool',
        description: 'Should persist',
        parameters: [],
        code: 'output("stored")',
      });

      const retrieved = await store.getByName(TEST_OWNER, 'persistent_tool');
      expect(retrieved).toBeDefined();
      expect(retrieved?.code).toBe('output("stored")');
    });

    test('create() returns CustomToolDefinition with timestamps', async () => {
      const created = await manager.create({
        name: 'timestamped_tool',
        description: 'Has timestamps',
        parameters: [],
        code: 'output("test")',
      });

      expect(created.id).toBeDefined();
      expect(created.created_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      expect(created.owner).toBe(TEST_OWNER);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await manager.create({
        name: 'test_tool',
        description: 'Original',
        parameters: [
          { name: 'x', type: 'number', description: 'Number', required: true },
        ],
        code: 'const result = PARAMS.x * 2;',
      });
    });

    test('AC2.5: after update(), handler uses new code', async () => {
      // Create a runtime that captures the code
      let capturedCode = '';
      const capturingRuntime: CodeRuntime = {
        async execute(code) {
          capturedCode = code;
          return { success: true, output: 'done', error: null, tool_calls_made: 0, duration_ms: 10 };
        },
      };

      // Create new manager with capturing runtime
      const testManager = createCustomToolManager({
        store,
        registry,
        runtime: capturingRuntime,
        secretResolver,
        owner: TEST_OWNER,
      });

      // Recreate initial tool
      await testManager.create({
        name: 'exec_tool',
        description: 'Original',
        parameters: [],
        code: 'output("original")',
      });

      // Update the tool
      const newCode = 'output("updated")';
      await testManager.update('exec_tool', { code: newCode });

      // Dispatch and verify new code was used
      const result = await registry.dispatch('exec_tool', {});
      expect(result.success).toBe(true);
      expect(capturedCode).toContain('updated');
    });

    test('update() modifies description', async () => {
      const updated = await manager.update('test_tool', {
        description: 'New description',
      });

      expect(updated.description).toBe('New description');
    });

    test('update() modifies parameters', async () => {
      const newParams: ReadonlyArray<ToolParameter> = [
        { name: 'a', type: 'string', description: 'A', required: true },
        { name: 'b', type: 'string', description: 'B', required: false },
      ];

      const updated = await manager.update('test_tool', {
        parameters: newParams,
      });

      expect(updated.parameters).toHaveLength(2);
      expect(updated.parameters[0]?.name).toBe('a');
    });

    test('update() modifies code', async () => {
      const newCode = 'output("new code")';
      const updated = await manager.update('test_tool', { code: newCode });

      expect(updated.code).toBe(newCode);
    });

    test('update() throws on non-existent tool', async () => {
      try {
        await manager.update('nonexistent', { description: 'Test' });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('not found');
      }
    });

    test('update() re-registers tool in registry', async () => {
      await manager.update('test_tool', { description: 'Updated' });

      const definitions = registry.getDefinitions();
      const tool = definitions.find(d => d.name === 'test_tool');
      expect(tool?.description).toBe('Updated');
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await manager.create({
        name: 'delete_me',
        description: 'To be deleted',
        parameters: [],
        code: 'output("bye")',
      });
    });

    test('AC2.6: after delete(), tool not in registry.getDefinitions()', async () => {
      await manager.delete('delete_me');

      const definitions = registry.getDefinitions();
      const found = definitions.find(d => d.name === 'delete_me');
      expect(found).toBeUndefined();
    });

    test('AC2.6: after delete(), dispatch() returns "unknown tool"', async () => {
      await manager.delete('delete_me');

      const result = await registry.dispatch('delete_me', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown tool');
    });

    test('delete() throws on non-existent tool', async () => {
      try {
        await manager.delete('nonexistent');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('not found');
      }
    });

    test('delete() removes from store', async () => {
      await manager.delete('delete_me');

      const retrieved = await store.getByName(TEST_OWNER, 'delete_me');
      expect(retrieved).toBeNull();
    });
  });

  describe('list', () => {
    test('list() returns empty when no tools created', async () => {
      const tools = await manager.list();
      expect(tools).toHaveLength(0);
    });

    test('list() returns all tools for owner', async () => {
      await manager.create({
        name: 'tool_a',
        description: 'A',
        parameters: [],
        code: 'a',
      });
      await manager.create({
        name: 'tool_b',
        description: 'B',
        parameters: [],
        code: 'b',
      });

      const tools = await manager.list();
      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('tool_a');
      expect(tools[1]?.name).toBe('tool_b');
    });

    test('list() sorts by name', async () => {
      await manager.create({
        name: 'z_tool',
        description: 'Z',
        parameters: [],
        code: 'z',
      });
      await manager.create({
        name: 'a_tool',
        description: 'A',
        parameters: [],
        code: 'a',
      });

      const tools = await manager.list();
      expect(tools[0]?.name).toBe('a_tool');
      expect(tools[1]?.name).toBe('z_tool');
    });
  });

  describe('loadAll', () => {
    test('loadAll() registers all persisted tools', async () => {
      // Create tools directly in store, bypassing manager
      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'stored_tool_1',
        description: 'Stored tool 1',
        parameters: [],
        code: 'code1',
      });

      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'stored_tool_2',
        description: 'Stored tool 2',
        parameters: [],
        code: 'code2',
      });

      // Create fresh manager and load
      const newRegistry = createToolRegistry();
      const newManager = createCustomToolManager({
        store,
        registry: newRegistry,
        runtime,
        secretResolver,
        owner: TEST_OWNER,
      });

      await newManager.loadAll();

      const definitions = newRegistry.getDefinitions();
      expect(definitions.find(d => d.name === 'stored_tool_1')).toBeDefined();
      expect(definitions.find(d => d.name === 'stored_tool_2')).toBeDefined();
    });

    test('loadAll() silently skips conflicting tools', async () => {
      // Create a persisted tool
      await store.create({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        name: 'conflicting_tool',
        description: 'Will conflict',
        parameters: [],
        code: 'code',
      });

      // Add a built-in tool with same name
      registry.register({
        definition: {
          name: 'conflicting_tool',
          description: 'Built-in',
          parameters: [],
        },
        handler: async () => ({ success: true, output: '' }),
      });

      // loadAll should not throw
      await expect(manager.loadAll()).resolves.toBeUndefined();

      // Tool should remain registered as built-in
      const definitions = registry.getDefinitions();
      const found = definitions.find(d => d.name === 'conflicting_tool');
      expect(found?.description).toBe('Built-in');
    });

    test('AC2.8: handler passes secrets to runtime.execute()', async () => {
      let receivedContext: any = null;
      const contextCapturingRuntime: CodeRuntime = {
        async execute(_code, _toolStubs, context) {
          receivedContext = context;
          return { success: true, output: 'done', error: null, tool_calls_made: 0, duration_ms: 10 };
        },
      };

      const secretManager = createCustomToolManager({
        store,
        registry,
        runtime: contextCapturingRuntime,
        secretResolver,
        owner: TEST_OWNER,
      });

      await secretManager.create({
        name: 'secret_tool',
        description: 'Uses secrets',
        parameters: [],
        code: 'const key = PARAMS.key;',
      });

      await registry.dispatch('secret_tool', {});

      expect(receivedContext).toBeDefined();
      expect(receivedContext.secrets).toBeDefined();
      expect(receivedContext.secrets.TEST_SECRET).toBe('secret-value');
      expect(receivedContext.secrets.API_KEY).toBe('api-key-value');
    });
  });
});
