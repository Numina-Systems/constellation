// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { MemoryStore } from '@/memory/store';
import type { MemoryBlock } from '@/memory/types';
import { createIntrospectionContextProvider } from './introspection-context.ts';

function createMockMemoryStore(
  blockToReturn: MemoryBlock | null = null,
): MemoryStore & { calls: Array<{ method: string; args: Array<unknown> }> } {
  const calls: Array<{ method: string; args: Array<unknown> }> = [];

  return {
    calls,

    async getBlock(_id: string) {
      calls.push({ method: 'getBlock', args: [_id] });
      return null;
    },

    async getBlocksByTier(owner: string, tier) {
      calls.push({ method: 'getBlocksByTier', args: [owner, tier] });
      return [];
    },

    async getBlockByLabel(owner: string, label: string) {
      calls.push({ method: 'getBlockByLabel', args: [owner, label] });
      return blockToReturn;
    },

    async createBlock(block) {
      calls.push({ method: 'createBlock', args: [block] });
      return {
        created_at: new Date(),
        updated_at: new Date(),
        ...block,
      };
    },

    async updateBlock(id: string, content: string, embedding) {
      calls.push({ method: 'updateBlock', args: [id, content, embedding] });
      return {
        id,
        owner: 'test',
        tier: 'working' as const,
        label: 'test',
        content,
        embedding,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
    },

    async deleteBlock(_id: string) {
      calls.push({ method: 'deleteBlock', args: [_id] });
    },

    async searchByEmbedding(owner: string, embedding, limit, tier) {
      calls.push({
        method: 'searchByEmbedding',
        args: [owner, embedding, limit, tier],
      });
      return [];
    },

    async logEvent(event) {
      calls.push({ method: 'logEvent', args: [event] });
      return {
        id: 'event-1',
        created_at: new Date(),
        ...event,
      };
    },

    async getEvents(blockId: string) {
      calls.push({ method: 'getEvents', args: [blockId] });
      return [];
    },

    async createMutation(mutation) {
      calls.push({ method: 'createMutation', args: [mutation] });
      return {
        id: 'mut-1',
        created_at: new Date(),
        resolved_at: null,
        block_id: mutation.block_id,
        proposed_content: mutation.proposed_content,
        reason: mutation.reason ?? null,
        feedback: null,
        status: 'pending' as const,
      };
    },

    async getPendingMutations(owner?: string) {
      calls.push({ method: 'getPendingMutations', args: [owner] });
      return [];
    },

    async resolveMutation(id: string, status: 'approved' | 'rejected') {
      calls.push({ method: 'resolveMutation', args: [id, status] });
      return {
        id,
        block_id: 'b-1',
        proposed_content: 'test',
        status: status,
        reason: null,
        feedback: null,
        created_at: new Date(),
        resolved_at: new Date(),
      };
    },

    async updateBlockTier(id: string, tier) {
      calls.push({ method: 'updateBlockTier', args: [id, tier] });
      return {
        id,
        owner: 'test',
        tier,
        label: 'test',
        content: 'test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
    },
  };
}

describe('createIntrospectionContextProvider', () => {
  describe('AC2.1: Surfaces digest in system prompt', () => {
    it('returns [Unformalised Observations] section with digest content', async () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: 'Half-formed thought about X',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      // First call triggers refresh
      let result = provider();
      expect(result).toBeUndefined(); // refresh is async

      // Wait for background refresh
      await Bun.sleep(10);

      // Second call returns the cached result
      result = provider();
      expect(result).toBeDefined();
      expect(result).toContain('[Unformalised Observations]');
      expect(result).toContain('Half-formed thought about X');
    });

    it('includes full digest content in the section', async () => {
      const digest = `- Pattern A: recurring theme
- Pattern B: another observation
- Meta-note: system seems to prefer X over Y`;

      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: digest,
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      provider(); // trigger refresh
      await Bun.sleep(10);
      const result = provider();

      expect(result).toContain(digest);
    });
  });

  describe('AC2.3: Returns undefined when no digest block exists', () => {
    it('returns undefined when getBlockByLabel returns null (first run)', async () => {
      const store = createMockMemoryStore(null);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      provider(); // trigger refresh
      await Bun.sleep(10);
      const result = provider();

      expect(result).toBeUndefined();
    });

    it('returns undefined when digest block has empty content', async () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: '',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      provider();
      await Bun.sleep(10);
      const result = provider();

      expect(result).toBeUndefined();
    });

    it('returns undefined when digest block has only whitespace', async () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: '   \n\t  ',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      provider();
      await Bun.sleep(10);
      const result = provider();

      expect(result).toBeUndefined();
    });
  });

  describe('AC2.4: Stale digest from previous daemon run is surfaced on restart', () => {
    it('surfaces persistent block on provider restart', async () => {
      const staleDigest = 'Previous session observations: pattern discovered';

      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: staleDigest,
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date('2026-04-13T10:00:00Z'),
        updated_at: new Date('2026-04-13T10:00:00Z'),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      // Create provider and call it (simulating restart)
      provider(); // trigger first refresh
      await Bun.sleep(10);
      const result = provider(); // get cached result

      expect(result).toBeDefined();
      expect(result).toContain(staleDigest);
    });
  });

  describe('AC3.1: getBlockByLabel called with correct parameters', () => {
    it('calls getBlockByLabel with owner and introspection-digest label', async () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: 'Test content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      provider();
      await Bun.sleep(10);

      // Verify the call
      const calls = store.calls.filter((c) => c.method === 'getBlockByLabel');
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      expect(lastCall!.args[0]).toBe('test-agent'); // owner
      expect(lastCall!.args[1]).toBe('introspection-digest'); // label
    });
  });

  describe('Cache TTL behavior', () => {
    it('caches result and reuses it within TTL window', async () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: 'Test content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      // First call: triggers refresh
      provider();
      await Bun.sleep(10);
      provider(); // second call within TTL uses cache

      // Check that getBlockByLabel was only called once (from the refresh)
      const calls = store.calls.filter((c) => c.method === 'getBlockByLabel');
      expect(calls.length).toBe(1);
    });
  });

  describe('Provider synchronicity', () => {
    it('provider function is synchronous', () => {
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'introspection-digest',
        content: 'Test content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, 'test-agent');

      const result = provider();
      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  describe('Owner isolation', () => {
    it('queries with correct owner for label lookup', async () => {
      const testOwner = 'specific-agent-id';
      const mockBlock: MemoryBlock = {
        id: 'digest-1',
        owner: testOwner,
        tier: 'working',
        label: 'introspection-digest',
        content: 'Owner-specific content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const store = createMockMemoryStore(mockBlock);
      const provider = createIntrospectionContextProvider(store, testOwner);

      provider();
      await Bun.sleep(10);

      const calls = store.calls.filter((c) => c.method === 'getBlockByLabel');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]!.args[0]).toBe(testOwner);
    });
  });

  describe('Error handling', () => {
    it('handles store errors gracefully and logs warning', async () => {
      const errorStore: MemoryStore & {
        calls: Array<{ method: string; args: Array<unknown> }>;
      } = {
        calls: [],
        async getBlockByLabel() {
          throw new Error('Database connection failed');
        },
        // Other methods as no-ops
        async getBlock(_id: string) {
          return null;
        },
        async getBlocksByTier() {
          return [];
        },
        async createBlock(block) {
          return {
            created_at: new Date(),
            updated_at: new Date(),
            ...block,
          };
        },
        async updateBlock(id: string, content: string, embedding) {
          return {
            id,
            owner: 'test',
            tier: 'working' as const,
            label: 'test',
            content,
            embedding,
            permission: 'readwrite' as const,
            pinned: false,
            created_at: new Date(),
            updated_at: new Date(),
          };
        },
        async deleteBlock() {
          // no-op
        },
        async searchByEmbedding() {
          return [];
        },
        async logEvent(event) {
          return { id: 'e1', created_at: new Date(), ...event };
        },
        async getEvents() {
          return [];
        },
        async createMutation(mutation) {
          return {
            id: 'mut-1',
            created_at: new Date(),
            resolved_at: null,
            block_id: mutation.block_id,
            proposed_content: mutation.proposed_content,
            reason: mutation.reason ?? null,
            feedback: null,
            status: 'pending' as const,
          };
        },
        async getPendingMutations(_owner?: string) {
          return [];
        },
        async resolveMutation(id: string, status: 'approved' | 'rejected') {
          return {
            id,
            block_id: 'b-1',
            proposed_content: 'test',
            status: status,
            reason: null,
            feedback: null,
            created_at: new Date(),
            resolved_at: new Date(),
          };
        },
        async updateBlockTier(id: string, tier) {
          return {
            id,
            owner: 'test',
            tier,
            label: 'test',
            content: 'test',
            embedding: null,
            permission: 'readwrite' as const,
            pinned: false,
            created_at: new Date(),
            updated_at: new Date(),
          };
        },
      };

      const provider = createIntrospectionContextProvider(
        errorStore,
        'test-agent',
      );

      // Should not throw
      provider();
      await Bun.sleep(10);
      const result = provider();

      expect(result).toBeUndefined();
    });
  });
});
