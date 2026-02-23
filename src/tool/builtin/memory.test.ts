// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { MemoryManager } from '../../memory/index.ts';
import type { MemoryBlock, MemorySearchResult } from '../../memory/index.ts';
import { createMemoryTools } from './memory.ts';

describe('Built-in memory tools', () => {
  function createMockMemoryManager(): MemoryManager {
    return {
      getCoreBlocks: async () => [],
      getWorkingBlocks: async () => [],
      buildSystemPrompt: async () => '',
      read: async () => [],
      write: async () => ({ applied: false, error: 'not implemented' }),
      list: async () => [],
      getPendingMutations: async () => [],
      approveMutation: async () => (
        { id: '', owner: '', tier: 'core', label: '', content: '', embedding: null, permission: 'readwrite', pinned: false, created_at: new Date(), updated_at: new Date() }
      ),
      rejectMutation: async () => (
        { id: '', block_id: '', proposed_content: '', reason: null, status: 'rejected', feedback: null, created_at: new Date(), resolved_at: new Date() }
      ),
    };
  }

  describe('memory_read', () => {
    it('should search memory with query parameter', async () => {
      let capturedQuery: string | null = null;
      let capturedLimit: number | undefined = undefined;

      const mockManager = createMockMemoryManager();
      mockManager.read = async (query, limit) => {
        capturedQuery = query;
        capturedLimit = limit;
        const block: MemoryBlock = {
          id: 'block-1',
          owner: 'test',
          tier: 'core',
          label: 'test block',
          content: 'test content',
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        const result: MemorySearchResult = {
          block,
          similarity: 0.95,
        };
        return [result];
      };

      const tools = createMemoryTools(mockManager);
      const memory_read = tools.find((t) => t.definition.name === 'memory_read');
      expect(memory_read).toBeDefined();

      if (!memory_read) return;

      const result = await memory_read.handler({ query: 'test query' });

      expect(result.success).toBe(true);
      expect(capturedQuery === 'test query').toBe(true);
      const limit = capturedLimit ?? 0;
      expect(limit).toBe(5);
      expect(result.output).toContain('test block');
    });

    it('should support optional limit parameter', async () => {
      let capturedLimit: number | undefined = undefined;

      const mockManager = createMockMemoryManager();
      mockManager.read = async (_query, limit) => {
        capturedLimit = limit;
        return [];
      };

      const tools = createMemoryTools(mockManager);
      const memory_read = tools.find((t) => t.definition.name === 'memory_read');
      expect(memory_read).toBeDefined();

      if (!memory_read) return;

      await memory_read.handler({ query: 'test', limit: 10 });

      expect(capturedLimit === 10).toBe(true);
    });

    it('should support optional tier filter', async () => {
      let capturedTier: string | undefined = undefined;

      const mockManager = createMockMemoryManager();
      mockManager.read = async (_query, _limit, tier) => {
        capturedTier = tier;
        return [];
      };

      const tools = createMemoryTools(mockManager);
      const memory_read = tools.find((t) => t.definition.name === 'memory_read');
      expect(memory_read).toBeDefined();

      if (!memory_read) return;

      await memory_read.handler({ query: 'test', tier: 'archival' });

      expect(capturedTier === 'archival').toBe(true);
    });
  });

  describe('memory_write', () => {
    it('should write a readwrite block and return success', async () => {
      const mockManager = createMockMemoryManager();
      const blockToReturn: MemoryBlock = {
        id: 'block-1',
        owner: 'test',
        tier: 'working',
        label: 'my note',
        content: 'my content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockManager.write = async () => ({
        applied: true,
        block: blockToReturn,
      });

      const tools = createMemoryTools(mockManager);
      const memory_write = tools.find((t) => t.definition.name === 'memory_write');
      expect(memory_write).toBeDefined();

      if (!memory_write) return;

      const result = await memory_write.handler({
        label: 'my note',
        content: 'my content',
        tier: 'working',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('memory written');
      expect(result.output).toContain('block-1');
    });

    it('should handle familiar blocks queued for approval', async () => {
      const mockManager = createMockMemoryManager();
      mockManager.write = async () => ({
        applied: false,
        mutation: {
          id: 'mutation-1',
          block_id: 'block-1',
          proposed_content: 'new content',
          reason: 'update reason',
          status: 'pending',
          feedback: null,
          created_at: new Date(),
          resolved_at: null,
        },
      });

      const tools = createMemoryTools(mockManager);
      const memory_write = tools.find((t) => t.definition.name === 'memory_write');
      expect(memory_write).toBeDefined();

      if (!memory_write) return;

      const result = await memory_write.handler({
        label: 'label',
        content: 'content',
        reason: 'update reason',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('mutation queued');
      expect(result.output).toContain('pending');
    });

    it('should return error for readonly blocks', async () => {
      const mockManager = createMockMemoryManager();
      mockManager.write = async () => ({
        applied: false,
        error: 'block is readonly',
      });

      const tools = createMemoryTools(mockManager);
      const memory_write = tools.find((t) => t.definition.name === 'memory_write');
      expect(memory_write).toBeDefined();

      if (!memory_write) return;

      const result = await memory_write.handler({
        label: 'label',
        content: 'content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('readonly');
    });

    it('should pass label, content, tier, and reason to manager', async () => {
      interface CapturedParams {
        label: string;
        content: string;
        tier?: string;
        reason?: string;
      }
      let capturedParams: CapturedParams | null = null;

      const mockManager = createMockMemoryManager();
      mockManager.write = async (label, content, tier, reason) => {
        capturedParams = { label, content, tier, reason };
        return { applied: false, error: 'test' };
      };

      const tools = createMemoryTools(mockManager);
      const memory_write = tools.find((t) => t.definition.name === 'memory_write');
      expect(memory_write).toBeDefined();

      if (!memory_write) return;

      await memory_write.handler({
        label: 'my label',
        content: 'my content',
        tier: 'archival',
        reason: 'archive old note',
      });

      expect(capturedParams !== null).toBe(true);
      const params = capturedParams as CapturedParams | null;
      if (params) {
        expect(params.label === 'my label').toBe(true);
        expect(params.content === 'my content').toBe(true);
        expect(params.tier === 'archival').toBe(true);
        expect(params.reason === 'archive old note').toBe(true);
      }
    });
  });

  describe('memory_list', () => {
    it('should list all memory blocks when called without tier', async () => {
      let capturedTier: string | undefined = undefined;

      const mockManager = createMockMemoryManager();
      mockManager.list = async (tier) => {
        capturedTier = tier;
        const block: MemoryBlock = {
          id: 'block-1',
          owner: 'test',
          tier: 'working',
          label: 'note 1',
          content: 'this is a long piece of content that should be truncated in the preview',
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        return [block];
      };

      const tools = createMemoryTools(mockManager);
      const memory_list = tools.find((t) => t.definition.name === 'memory_list');
      expect(memory_list).toBeDefined();

      if (!memory_list) return;

      const result = await memory_list.handler({});

      expect(result.success).toBe(true);
      expect(capturedTier).toBeUndefined();
      expect(result.output).toContain('note 1');
      expect(result.output).toContain('block-1');
    });

    it('should support optional tier filter', async () => {
      let capturedTier: string | undefined = undefined;

      const mockManager = createMockMemoryManager();
      mockManager.list = async (tier) => {
        capturedTier = tier;
        return [];
      };

      const tools = createMemoryTools(mockManager);
      const memory_list = tools.find((t) => t.definition.name === 'memory_list');
      expect(memory_list).toBeDefined();

      if (!memory_list) return;

      await memory_list.handler({ tier: 'core' });

      expect(capturedTier === 'core').toBe(true);
    });

    it('should include block summaries with preview text', async () => {
      const mockManager = createMockMemoryManager();
      mockManager.list = async () => {
        const block: MemoryBlock = {
          id: 'block-1',
          owner: 'test',
          tier: 'working',
          label: 'test label',
          content: 'short',
          embedding: null,
          permission: 'familiar',
          pinned: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        return [block];
      };

      const tools = createMemoryTools(mockManager);
      const memory_list = tools.find((t) => t.definition.name === 'memory_list');
      expect(memory_list).toBeDefined();

      if (!memory_list) return;

      const result = await memory_list.handler({});

      expect(result.success).toBe(true);
      expect(result.output).toContain('test label');
      expect(result.output).toContain('familiar');
      expect(result.output).toContain('short');
    });
  });

  describe('AC4.2 port-only dependency', () => {
    it('should work entirely with MemoryManager type without real implementation', async () => {
      const mockManager = createMockMemoryManager();
      const tools = createMemoryTools(mockManager);

      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.definition.name)).toEqual(['memory_read', 'memory_write', 'memory_list']);

      for (const tool of tools) {
        expect(tool.definition.description).toBeDefined();
        expect(tool.definition.parameters.length).toBeGreaterThanOrEqual(0);
        expect(typeof tool.handler).toBe('function');
      }
    });
  });

  describe('AC4.3 independence', () => {
    it('should work with mock MemoryManager without database or embedding provider', async () => {
      const mockManager = createMockMemoryManager();

      mockManager.read = async (query) => {
        if (query === 'empty') return [];
        const block: MemoryBlock = {
          id: 'test-id',
          owner: 'test-owner',
          tier: 'core',
          label: 'test',
          content: 'test content',
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        return [{ block, similarity: 0.9 }];
      };

      mockManager.write = async (label, content) => {
        if (label === 'fail') {
          return { applied: false, error: 'failed' };
        }
        const block: MemoryBlock = {
          id: 'new-id',
          owner: 'test-owner',
          tier: 'working',
          label,
          content,
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        return { applied: true, block };
      };

      mockManager.list = async () => {
        const block: MemoryBlock = {
          id: 'list-id',
          owner: 'test-owner',
          tier: 'working',
          label: 'listed',
          content: 'content',
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
        return [block];
      };

      const tools = createMemoryTools(mockManager);

      const readTool = tools.find((t) => t.definition.name === 'memory_read');
      if (readTool) {
        const readResult = await readTool.handler({ query: 'test' });
        expect(readResult.success).toBe(true);
      }

      const writeTool = tools.find((t) => t.definition.name === 'memory_write');
      if (writeTool) {
        const writeResult = await writeTool.handler({ label: 'new', content: 'data' });
        expect(writeResult.success).toBe(true);
      }

      const listTool = tools.find((t) => t.definition.name === 'memory_list');
      if (listTool) {
        const listResult = await listTool.handler({});
        expect(listResult.success).toBe(true);
      }
    });
  });
});
