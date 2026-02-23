// pattern: Imperative Shell

/**
 * Integration tests for the Familiar mutation approval flow.
 * Tests the full permission system: queuing, approving, and rejecting mutations.
 * Requires Docker Postgres running with pgvector.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import type { EmbeddingProvider } from '../embedding/types';
import { createPostgresProvider } from '../persistence/postgres';
import { createPostgresMemoryStore } from '../memory/postgres-store';
import { createMemoryManager } from '../memory/manager';
import { createMockEmbeddingProvider } from './test-helpers';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let mockEmbedding: EmbeddingProvider;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE pending_mutations CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

describe('Familiar Mutation Approval Flow', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    mockEmbedding = createMockEmbeddingProvider();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC1.9: Mutation queuing for Familiar blocks', () => {
    it('should queue a mutation when writing to Familiar block', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a Familiar block
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core:persona',
        content: 'I am a machine spirit.',
        embedding: null,
        permission: 'familiar',
        pinned: true,
      });

      // Try to write to the Familiar block
      const result = await memory.write(
        'core:persona',
        'Updated persona content',
        undefined,
        'Want to change my identity',
      );

      // Verify mutation was queued, not applied
      expect(result.applied).toBe(false);
      expect('mutation' in result).toBe(true);
      if ('mutation' in result) {
        expect(result.mutation.status).toBe('pending');
        expect(result.mutation.proposed_content).toBe('Updated persona content');
        expect(result.mutation.reason).toBe('Want to change my identity');
      }

      // Verify the original block content is unchanged
      const block = await store.getBlockByLabel(TEST_OWNER, 'core:persona');
      expect(block?.content).toBe('I am a machine spirit.');

      // Verify mutation was created in database
      const mutations = await store.getPendingMutations(TEST_OWNER);
      expect(mutations.length).toBe(1);
      expect(mutations[0]?.block_id).toBe(block?.id);
      expect(mutations[0]?.status).toBe('pending');
    });
  });

  describe('AC1.10: Mutation approval', () => {
    it('should apply mutation and update block when approved', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a Familiar block
      const blockId = crypto.randomUUID();
      const originalContent = 'Original persona';
      await store.createBlock({
        id: blockId,
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core:persona',
        content: originalContent,
        embedding: null,
        permission: 'familiar',
        pinned: true,
      });

      // Queue a mutation
      const writeResult = await memory.write(
        'core:persona',
        'Updated persona',
        undefined,
        'Updating identity',
      );

      expect(writeResult.applied).toBe(false);
      if (!('mutation' in writeResult)) {
        throw new Error('Expected mutation result');
      }
      const mutationId = writeResult.mutation.id;

      // Approve the mutation
      const updatedBlock = await memory.approveMutation(mutationId);
      expect(updatedBlock.content).toBe('Updated persona');
      expect(updatedBlock.id).toBe(blockId);

      // Verify block was updated in database
      const block = await store.getBlock(blockId);
      expect(block?.content).toBe('Updated persona');

      // Verify mutation status changed (query directly since it's no longer pending)
      const mutations = await persistence.query<{ status: string }>(
        'SELECT * FROM pending_mutations WHERE id = $1',
        [mutationId],
      );
      expect(mutations.length).toBe(1);
      const mutation = mutations[0];
      expect(mutation.status).toBe('approved');

      // Verify update event was logged
      const events = await persistence.query<{ old_content: string; new_content: string; event_type: string }>(
        'SELECT * FROM memory_events WHERE block_id = $1 AND event_type = $2',
        [blockId, 'update'],
      );
      expect(events.length).toBeGreaterThan(0);
      const updateEvent = events[0];
      expect(updateEvent.old_content).toBe(originalContent);
      expect(updateEvent.new_content).toBe('Updated persona');
    });
  });

  describe('AC1.11: Mutation rejection', () => {
    it('should reject mutation without changing block content', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create a Familiar block
      const blockId = crypto.randomUUID();
      const originalContent = 'Original familiar';
      await store.createBlock({
        id: blockId,
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core:familiar',
        content: originalContent,
        embedding: null,
        permission: 'familiar',
        pinned: true,
      });

      // Queue a mutation
      const writeResult = await memory.write(
        'core:familiar',
        'New familiar content',
        undefined,
        'Trying to change',
      );

      expect(writeResult.applied).toBe(false);
      if (!('mutation' in writeResult)) {
        throw new Error('Expected mutation result');
      }
      const mutationId = writeResult.mutation.id;

      // Get initial event count (should only have creation event)
      const initialEvents = await persistence.query<{ event_type: string }>(
        'SELECT * FROM memory_events WHERE block_id = $1',
        [blockId],
      );
      const initialEventCount = initialEvents.length;

      // Reject the mutation
      const rejectedMutation = await memory.rejectMutation(
        mutationId,
        'I prefer the current description',
      );
      expect(rejectedMutation.status).toBe('rejected');
      expect(rejectedMutation.feedback).toBe('I prefer the current description');

      // Verify block content is unchanged
      const block = await store.getBlock(blockId);
      expect(block?.content).toBe(originalContent);

      // Verify mutation status is rejected (query directly since it's no longer pending)
      const mutations = await persistence.query<{ status: string }>(
        'SELECT * FROM pending_mutations WHERE id = $1',
        [mutationId],
      );
      expect(mutations.length).toBe(1);
      const mutation = mutations[0];
      expect(mutation.status).toBe('rejected');

      // Verify NO update event was logged (only creation event should exist)
      const allEvents = await persistence.query<{ event_type: string }>(
        'SELECT * FROM memory_events WHERE block_id = $1',
        [blockId],
      );
      expect(allEvents.length).toBe(initialEventCount);
      for (const event of allEvents) {
        expect(event.event_type).not.toBe('update');
      }
    });
  });

  describe('Integration: Multiple mutations', () => {
    it('should handle multiple mutations to different blocks', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Create two Familiar blocks
      const block1Id = crypto.randomUUID();
      const block2Id = crypto.randomUUID();

      await store.createBlock({
        id: block1Id,
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core:persona',
        content: 'Persona A',
        embedding: null,
        permission: 'familiar',
        pinned: true,
      });

      await store.createBlock({
        id: block2Id,
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core:familiar',
        content: 'Familiar A',
        embedding: null,
        permission: 'familiar',
        pinned: true,
      });

      // Queue mutations to both blocks
      const result1 = await memory.write('core:persona', 'Persona B', undefined, 'Change 1');
      const result2 = await memory.write('core:familiar', 'Familiar B', undefined, 'Change 2');

      if (!('mutation' in result1) || !('mutation' in result2)) {
        throw new Error('Expected mutation results');
      }

      const mutation1Id = result1.mutation.id;
      const mutation2Id = result2.mutation.id;

      // Approve first, reject second
      await memory.approveMutation(mutation1Id);
      await memory.rejectMutation(mutation2Id, 'Not ready');

      // Verify results
      const block1 = await store.getBlock(block1Id);
      const block2 = await store.getBlock(block2Id);

      expect(block1?.content).toBe('Persona B');
      expect(block2?.content).toBe('Familiar A');

      // Verify pending mutations are resolved
      const pending = await store.getPendingMutations(TEST_OWNER);
      expect(pending.every((m) => m.status !== 'pending')).toBe(true);
    });
  });
});
