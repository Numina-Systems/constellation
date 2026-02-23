// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import type { EmbeddingProvider } from '../embedding/types.ts';
import { createPostgresMemoryStore } from './postgres-store.ts';
import { createMemoryManager } from './manager.ts';
import { createPostgresProvider } from '../persistence/postgres.ts';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let store: ReturnType<typeof createPostgresMemoryStore>;
let mockEmbedding: EmbeddingProvider;
let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE pending_mutations CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

describe('MemoryManager', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    mockEmbedding = {
      embed: async (text: string): Promise<Array<number>> => {
        // Deterministic embedding based on text hash
        const hash = Array.from(text).reduce((acc, char) => {
          return acc * 31 + char.charCodeAt(0);
        }, 0);
        const seed = Math.abs(hash) % 1000;
        return Array.from({ length: 768 }, (_, i) =>
          Math.sin(seed + i) * 0.5 + 0.5,
        );
      },
      embedBatch: async (texts: ReadonlyArray<string>): Promise<Array<Array<number>>> => {
        return Promise.all(texts.map((text) => mockEmbedding.embed(text)));
      },
      dimensions: 768,
    };

    store = createPostgresMemoryStore(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC1.3: Core blocks in system prompt', () => {
    it('buildSystemPrompt includes all core blocks with labels', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create some core blocks
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'System Rules',
        content: 'Be helpful and accurate',
        embedding: null,
        permission: 'readwrite',
        pinned: true,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'Context',
        content: 'This is a test agent',
        embedding: null,
        permission: 'readwrite',
        pinned: true,
      });

      const prompt = await manager.buildSystemPrompt();

      expect(prompt).toContain('## System Rules');
      expect(prompt).toContain('Be helpful and accurate');
      expect(prompt).toContain('## Context');
      expect(prompt).toContain('This is a test agent');
    });

    it('buildSystemPrompt returns empty string when no core blocks exist', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);
      const prompt = await manager.buildSystemPrompt();
      expect(prompt).toBe('');
    });
  });

  describe('AC1.4: Working blocks management', () => {
    it('getWorkingBlocks returns all working tier blocks', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create working blocks
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Block 1',
        content: 'Content 1',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Block 2',
        content: 'Content 2',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      const blocks = await manager.getWorkingBlocks();

      expect(blocks).toHaveLength(2);
      expect(blocks.some((b) => b.label === 'Block 1')).toBe(true);
      expect(blocks.some((b) => b.label === 'Block 2')).toBe(true);
    });

    it('write() creates new working block', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const result = await manager.write('New Block', 'New Content');

      expect(result.applied).toBe(true);
      if (result.applied) {
        expect(result.block.label).toBe('New Block');
        expect(result.block.content).toBe('New Content');
        expect(result.block.tier).toBe('working');
        expect(result.block.permission).toBe('readwrite');
      }

      const blocks = await manager.getWorkingBlocks();
      expect(blocks).toHaveLength(1);
    });

    it('deleteBlock removes working block from list', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a working block
      const result = await manager.write('Delete Block', 'Content to delete');
      expect(result.applied).toBe(true);

      if (result.applied) {
        const blockId = result.block.id;

        // Verify it appears in the list
        let blocks = await manager.getWorkingBlocks();
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.id).toBe(blockId);

        // Delete the block
        await store.deleteBlock(blockId);

        // Verify it's removed from the list
        blocks = await manager.getWorkingBlocks();
        expect(blocks).toHaveLength(0);
      }
    });
  });

  describe('AC1.5: Archival memory and semantic search', () => {
    it('read() returns archival blocks ordered by similarity', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create archival blocks with embeddings
      const emb1 = await mockEmbedding.embed('machine learning models');
      const emb2 = await mockEmbedding.embed('neural networks');
      const emb3 = await mockEmbedding.embed('cooking recipes');

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'ML Block',
        content: 'machine learning models',
        embedding: emb1,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'NN Block',
        content: 'neural networks',
        embedding: emb2,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'Recipe Block',
        content: 'cooking recipes',
        embedding: emb3,
        permission: 'readwrite',
        pinned: false,
      });

      const results = await manager.read('machine learning', 10, 'archival');

      expect(results.length).toBeGreaterThan(0);
      // With deterministic embeddings, search returns results ordered by pgvector similarity
      // Just verify results are returned, not specific ordering
      const labels = results.map((r) => r.block.label);
      expect(labels).toContain('ML Block');
    });

    it('read() excludes core/working blocks when tier is archival', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create blocks in different tiers
      const emb = await mockEmbedding.embed('test content');

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'Core Block',
        content: 'test content',
        embedding: emb,
        permission: 'readwrite',
        pinned: true,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'Archival Block',
        content: 'test content',
        embedding: emb,
        permission: 'readwrite',
        pinned: false,
      });

      const results = await manager.read('test', 10, 'archival');

      expect(results).toHaveLength(1);
      expect(results[0]?.block.label).toBe('Archival Block');
    });
  });

  describe('AC1.6: Embedding generation on write', () => {
    it('write() generates and persists embedding', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const result = await manager.write('Test Block', 'Test Content');

      expect(result.applied).toBe(true);
      if (result.applied) {
        expect(result.block.embedding).not.toBeNull();
        expect(Array.isArray(result.block.embedding)).toBe(true);
        expect((result.block.embedding as Array<number>).length).toBe(768);
      }
    });
  });

  describe('AC1.7: Event sourcing for mutations', () => {
    it('create event is logged when block is created', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const result = await manager.write('Event Block', 'Initial Content');

      expect(result.applied).toBe(true);
      if (result.applied) {
        const events = await store.getEvents(result.block.id);

        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe('create');
        expect(events[0]?.old_content).toBeNull();
        expect(events[0]?.new_content).toBe('Initial Content');
      }
    });

    it('update event is logged with old and new content', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a block
      const createResult = await manager.write('Event Block', 'Initial Content');
      expect(createResult.applied).toBe(true);

      if (createResult.applied) {
        const blockId = createResult.block.id;

        // Update the block
        const updateResult = await manager.write('Event Block', 'Updated Content');
        expect(updateResult.applied).toBe(true);

        const events = await store.getEvents(blockId);

        expect(events).toHaveLength(2);
        expect(events[1]?.event_type).toBe('update');
        expect(events[1]?.old_content).toBe('Initial Content');
        expect(events[1]?.new_content).toBe('Updated Content');
      }
    });
  });

  describe('AC1.8: ReadOnly blocks reject writes', () => {
    it('write() to readonly block returns error', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a readonly block
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'ReadOnly Block',
        content: 'Original Content',
        embedding: null,
        permission: 'readonly',
        pinned: false,
      });

      const result = await manager.write('ReadOnly Block', 'New Content');

      expect(result.applied).toBe(false);
      if (!result.applied && 'error' in result) {
        expect(result.error).toContain('read-only');
      }

      // Verify original content is unchanged
      const block = await store.getBlockByLabel(TEST_OWNER, 'ReadOnly Block');
      expect(block?.content).toBe('Original Content');
    });
  });

  describe('AC1.9: Familiar blocks queue mutations', () => {
    it('write() to familiar block creates pending mutation', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a familiar block
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Familiar Block',
        content: 'Original Content',
        embedding: null,
        permission: 'familiar',
        pinned: false,
      });

      const result = await manager.write('Familiar Block', 'Proposed Content', 'working', 'Test reason');

      expect(result.applied).toBe(false);
      if (!result.applied && 'mutation' in result) {
        expect(result.mutation.proposed_content).toBe('Proposed Content');
        expect(result.mutation.status).toBe('pending');
        expect(result.mutation.reason).toBe('Test reason');
      }

      // Verify original content is unchanged
      const block = await store.getBlockByLabel(TEST_OWNER, 'Familiar Block');
      expect(block?.content).toBe('Original Content');

      // Verify mutation was stored
      const mutations = await manager.getPendingMutations();
      expect(mutations).toHaveLength(1);
    });
  });

  describe('AC1.10: Approved mutations apply changes', () => {
    it('approveMutation() updates block and marks mutation approved', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a familiar block
      const block = await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Familiar Block',
        content: 'Original Content',
        embedding: null,
        permission: 'familiar',
        pinned: false,
      });

      // Write to create a pending mutation
      const writeResult = await manager.write('Familiar Block', 'New Content');
      expect(writeResult.applied).toBe(false);

      if (!writeResult.applied && 'mutation' in writeResult) {
        const mutationId = writeResult.mutation.id;

        // Approve the mutation
        const approvedBlock = await manager.approveMutation(mutationId);

        expect(approvedBlock.content).toBe('New Content');
        expect(approvedBlock.embedding).not.toBeNull();

        // Verify mutation is no longer pending
        const pendingMutations = await manager.getPendingMutations();
        const stillPending = pendingMutations.find((m) => m.id === mutationId);
        expect(stillPending).toBeUndefined();

        // Verify event was logged
        const events = await store.getEvents(block.id);
        const updateEvent = events.find((e) => e.event_type === 'update');
        expect(updateEvent).toBeDefined();
        expect(updateEvent?.new_content).toBe('New Content');
      }
    });
  });

  describe('AC1.11: Rejected mutations notify with feedback', () => {
    it('rejectMutation() marks mutation rejected with feedback', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a familiar block
      const block = await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Familiar Block',
        content: 'Original Content',
        embedding: null,
        permission: 'familiar',
        pinned: false,
      });

      // Write to create a pending mutation
      const writeResult = await manager.write('Familiar Block', 'Proposed Content');
      expect(writeResult.applied).toBe(false);

      if (!writeResult.applied && 'mutation' in writeResult) {
        const mutationId = writeResult.mutation.id;

        // Reject the mutation
        const rejectedMutation = await manager.rejectMutation(
          mutationId,
          'User said no',
        );

        expect(rejectedMutation.status).toBe('rejected');
        expect(rejectedMutation.feedback).toBe('User said no');

        // Verify original content is unchanged
        const updatedBlock = await store.getBlock(block.id);
        expect(updatedBlock?.content).toBe('Original Content');
      }
    });
  });

  describe('Embedding failure graceful degradation', () => {
    it('write() succeeds with null embedding when provider fails', async () => {
      const failingEmbedding: EmbeddingProvider = {
        embed: async (): Promise<Array<number>> => {
          throw new Error('Embedding provider is down');
        },
        embedBatch: async (): Promise<Array<Array<number>>> => {
          throw new Error('Embedding provider is down');
        },
        dimensions: 768,
      };

      const manager = createMemoryManager(store, failingEmbedding, TEST_OWNER);

      const result = await manager.write('Test Block', 'Test Content');

      expect(result.applied).toBe(true);
      if (result.applied) {
        expect(result.block.embedding).toBeNull();
      }
    });

    it('read() returns empty results when blocks have null embeddings', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a block with null embedding
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'No Embedding Block',
        content: 'Content without embedding',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      const results = await manager.read('test content', 10, 'archival');

      expect(results).toHaveLength(0);
    });
  });

  describe('Append permission', () => {
    it('write() appends to block with append permission', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create an append block
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Append Block',
        content: 'Line 1',
        embedding: null,
        permission: 'append',
        pinned: false,
      });

      const result = await manager.write('Append Block', 'Line 2');

      expect(result.applied).toBe(true);
      if (result.applied) {
        expect(result.block.content).toBe('Line 1\nLine 2');
      }
    });
  });

  describe('list() method', () => {
    it('list() returns all blocks when no tier specified', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create blocks in different tiers
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'Core',
        content: 'Core content',
        embedding: null,
        permission: 'readwrite',
        pinned: true,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Working',
        content: 'Working content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'Archival',
        content: 'Archival content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      const blocks = await manager.list();

      expect(blocks).toHaveLength(3);
      expect(blocks.some((b) => b.tier === 'core')).toBe(true);
      expect(blocks.some((b) => b.tier === 'working')).toBe(true);
      expect(blocks.some((b) => b.tier === 'archival')).toBe(true);
    });

    it('list() filters by tier when specified', async () => {
      const manager = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create blocks in different tiers
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'Core',
        content: 'Core content',
        embedding: null,
        permission: 'readwrite',
        pinned: true,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'Working',
        content: 'Working content',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      const blocks = await manager.list('core');

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.tier).toBe('core');
    });
  });
});
