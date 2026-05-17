// pattern: Imperative Shell

/**
 * Tests for custom tool management agent tools.
 * Verifies create_tool, list_tools, update_tool, delete_tool work correctly.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { createToolRegistry } from '@/tool/registry.js';
import type { ToolRegistry } from '@/tool/types.js';
import type { CustomToolStore, CustomToolDefinition } from '@/custom-tool/types.js';
import { createCustomToolManager } from '@/custom-tool/manager.js';
import { createCustomToolTools } from './custom-tools.js';

// Mock CodeRuntime
function createMockRuntime() {
  return {
    async execute(code: string) {
      return { success: true, output: `Executed: ${code.length} chars`, error: null, tool_calls_made: 0, duration_ms: 10 };
    },
  };
}

// Mock SecretResolver
function createMockSecretResolver() {
  return {
    async listKeys() {
      return [];
    },
    async resolve() {
      return {};
    },
  };
}

// In-memory CustomToolStore
function createMockStore(): CustomToolStore {
  const storage = new Map<string, CustomToolDefinition>();

  return {
    async create(def) {
      const key = `${def.owner}:${def.name}`;
      const withDates = { ...def, created_at: new Date(), updated_at: new Date() };
      storage.set(key, withDates);
      return withDates;
    },

    async update(owner, name, patch) {
      const key = `${owner}:${name}`;
      const existing = storage.get(key);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updated_at: new Date() };
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

describe('Custom Tool Agent Tools', () => {
  let manager: ReturnType<typeof createCustomToolManager>;
  let registry: ToolRegistry;
  let store: CustomToolStore;
  const TEST_OWNER = 'test-agent';

  beforeEach(() => {
    registry = createToolRegistry();
    store = createMockStore();

    manager = createCustomToolManager({
      store,
      registry,
      runtime: createMockRuntime(),
      secretResolver: createMockSecretResolver(),
      owner: TEST_OWNER,
    });
  });

  describe('create_tool', () => {
    test('create_tool is registered with correct definition', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const defs = registry.getDefinitions();
      const createTool = defs.find(d => d.name === 'create_tool');
      expect(createTool).toBeDefined();
      expect(createTool?.parameters.length).toBeGreaterThan(0);
      const nameParam = createTool?.parameters.find(p => p.name === 'name');
      expect(nameParam).toBeDefined();
    });

    test('create_tool successfully creates a tool', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('create_tool', {
        name: 'test_tool',
        description: 'Test tool',
        parameters: [
          { name: 'input', type: 'string', description: 'Input', required: true },
        ],
        code: 'output("result")',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('created successfully');
    });

    test('create_tool with conflicting name returns error', async () => {
      // Create a built-in tool first
      registry.register({
        definition: {
          name: 'existing_tool',
          description: 'Built-in',
          parameters: [],
        },
        handler: async () => ({ success: true, output: '' }),
      });

      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('create_tool', {
        name: 'existing_tool',
        description: 'Conflicting',
        parameters: [],
        code: 'output("test")',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('conflict');
    });

    test('create_tool validates parameters', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('create_tool', {
        name: 'my_tool',
        description: 'Test',
        parameters: [
          { name: 'param1', type: 'string', description: 'P1', required: true },
          { name: 'param2', type: 'number', description: 'P2', required: false },
        ],
        code: 'output("test")',
      });

      expect(result.success).toBe(true);

      // Verify tool is in registry
      const defs = registry.getDefinitions();
      const created = defs.find(d => d.name === 'my_tool');
      expect(created).toBeDefined();
      expect(created?.parameters).toHaveLength(2);
    });
  });

  describe('list_tools', () => {
    test('list_tools is registered', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const defs = registry.getDefinitions();
      const listTool = defs.find(d => d.name === 'list_tools');
      expect(listTool).toBeDefined();
      expect(listTool?.parameters).toHaveLength(0);
    });

    test('list_tools returns empty message when no tools', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('list_tools', {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('No custom tools');
    });

    test('list_tools lists created tools', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      // Create tools
      await registry.dispatch('create_tool', {
        name: 'tool_a',
        description: 'Tool A',
        parameters: [],
        code: 'a',
      });

      await registry.dispatch('create_tool', {
        name: 'tool_b',
        description: 'Tool B',
        parameters: [],
        code: 'b',
      });

      const result = await registry.dispatch('list_tools', {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('tool_a');
      expect(result.output).toContain('tool_b');
      expect(result.output).toContain('Tool A');
      expect(result.output).toContain('Tool B');
    });
  });

  describe('update_tool', () => {
    test('update_tool is registered', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const defs = registry.getDefinitions();
      const updateTool = defs.find(d => d.name === 'update_tool');
      expect(updateTool).toBeDefined();
      const nameParam = updateTool?.parameters.find(p => p.name === 'name');
      expect(nameParam?.required).toBe(true);
    });

    test('update_tool updates tool description', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      // Create tool
      await registry.dispatch('create_tool', {
        name: 'my_tool',
        description: 'Original',
        parameters: [],
        code: 'original',
      });

      // Update description
      const result = await registry.dispatch('update_tool', {
        name: 'my_tool',
        description: 'Updated',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('updated successfully');

      // Verify in store
      const retrieved = await store.getByName(TEST_OWNER, 'my_tool');
      expect(retrieved?.description).toBe('Updated');
    });

    test('update_tool updates code', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      // Create tool
      await registry.dispatch('create_tool', {
        name: 'code_tool',
        description: 'Code tool',
        parameters: [],
        code: 'original_code',
      });

      // Update code
      const result = await registry.dispatch('update_tool', {
        name: 'code_tool',
        code: 'new_code',
      });

      expect(result.success).toBe(true);

      // Verify in store
      const retrieved = await store.getByName(TEST_OWNER, 'code_tool');
      expect(retrieved?.code).toBe('new_code');
    });

    test('update_tool updates parameters', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      // Create tool
      await registry.dispatch('create_tool', {
        name: 'param_tool',
        description: 'Param tool',
        parameters: [{ name: 'x', type: 'string', description: 'X', required: true }],
        code: 'code',
      });

      // Update parameters
      const result = await registry.dispatch('update_tool', {
        name: 'param_tool',
        parameters: [
          { name: 'a', type: 'string', description: 'A', required: true },
          { name: 'b', type: 'number', description: 'B', required: false },
        ],
      });

      expect(result.success).toBe(true);

      // Verify in store
      const retrieved = await store.getByName(TEST_OWNER, 'param_tool');
      expect(retrieved?.parameters).toHaveLength(2);
    });

    test('update_tool fails on non-existent tool', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('update_tool', {
        name: 'nonexistent',
        description: 'New desc',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_tool', () => {
    test('delete_tool is registered', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const defs = registry.getDefinitions();
      const deleteTool = defs.find(d => d.name === 'delete_tool');
      expect(deleteTool).toBeDefined();
      const nameParam = deleteTool?.parameters.find(p => p.name === 'name');
      expect(nameParam?.required).toBe(true);
    });

    test('delete_tool deletes a tool', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      // Create tool
      await registry.dispatch('create_tool', {
        name: 'to_delete',
        description: 'Will be deleted',
        parameters: [],
        code: 'code',
      });

      // Verify it exists
      let defs = registry.getDefinitions();
      expect(defs.find(d => d.name === 'to_delete')).toBeDefined();

      // Delete it
      const result = await registry.dispatch('delete_tool', {
        name: 'to_delete',
      });

      expect(result.success).toBe(true);

      // Verify it's gone
      defs = registry.getDefinitions();
      expect(defs.find(d => d.name === 'to_delete')).toBeUndefined();
    });

    test('delete_tool fails on non-existent tool', async () => {
      const tools = createCustomToolTools(manager);
      for (const tool of tools) {
        registry.register(tool);
      }

      const result = await registry.dispatch('delete_tool', {
        name: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
