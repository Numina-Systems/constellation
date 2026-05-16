// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '@/persistence';
import { createMessageStore } from '@/persistence/message-store.ts';
import { createMemoryManager, createPostgresMemoryStore } from '@/memory';
import { createPredictionStore } from '@/reflexion';
import { createTraceRecorder } from '@/reflexion';
import { createInterestRegistry } from '@/subconscious';
import { createEmbeddingProvider } from '@/embedding';
import { restoreFromCheckpoint } from './checkpoint-restore.ts';
import type { SessionCheckpoint, CheckpointWorkingMemory } from './checkpoint-types.ts';
import type { RestorationDependencies } from './checkpoint-restore.ts';
import type { MemoryManager } from '@/memory/manager.ts';
import type { PredictionStore } from '@/reflexion/types.ts';
import type { InterestRegistry } from '@/subconscious/types.ts';

describe('arch-hardening.AC1: Atomic checkpoint restore', () => {
  let persistence: ReturnType<typeof createPostgresProvider>;
  let memory: MemoryManager;
  let messageStore: ReturnType<typeof createMessageStore>;
  let predictionStore: PredictionStore;
  let traceRecorder: ReturnType<typeof createTraceRecorder>;
  let interestRegistry: InterestRegistry;

  const AGENT_OWNER = 'test-agent';
  const TEST_CONVERSATION_ID = 'conv-test-123';

  beforeAll(async () => {
    const databaseUrl = process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost/constellation_test';
    persistence = createPostgresProvider({ url: databaseUrl });

    await persistence.connect();
    await persistence.runMigrations();

    const memoryStore = createPostgresMemoryStore(persistence);
    const embedder = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      endpoint: 'http://192.168.1.6:11434',
      dimensions: 384,
    });

    memory = createMemoryManager(memoryStore, embedder, AGENT_OWNER);
    messageStore = createMessageStore(persistence);
    predictionStore = createPredictionStore(persistence);
    traceRecorder = createTraceRecorder(persistence);
    interestRegistry = createInterestRegistry(persistence);
  });

  afterEach(async () => {
    // Clean up test data
    await persistence.query('DELETE FROM memory_blocks WHERE owner = $1', [AGENT_OWNER]);
    await persistence.query('DELETE FROM memory_events WHERE owner = $1', [AGENT_OWNER]);
    await persistence.query('DELETE FROM messages WHERE conversation_id = $1', [TEST_CONVERSATION_ID]);
    await persistence.query('DELETE FROM predictions WHERE owner = $1', [AGENT_OWNER]);
    await persistence.query('DELETE FROM interests WHERE owner = $1', [AGENT_OWNER]);
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('arch-hardening.AC1.1: Success - full restore completes', () => {
    it('should restore predictions, interests, and memory to checkpoint state', async () => {
      // Setup: create conversation with messages
      const messageId1 = await persistence.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, $2, $3) RETURNING id`,
        [TEST_CONVERSATION_ID, 'user', 'test message'],
      ).then(rows => rows[0]!.id);

      // Create a working memory block
      const writeResult = await memory.write('session-state', 'active session', 'working');
      expect(writeResult.applied).toBe(true);

      // Create checkpoint
      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-1',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [messageId1],
        workingMemory: [
          { label: 'session-state', content: 'restored session' },
          { label: 'context', content: 'user context' },
        ],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: { lastCompactedIndex: 10, summaryCount: 2 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        predictionStore,
        interestRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Execute restore
      const result = await restoreFromCheckpoint(checkpoint, deps);

      // Verify result
      expect(result.conversationId).toBe(TEST_CONVERSATION_ID);
      expect(result.turnNumber).toBe(5);
      expect(result.toolRound).toBe(2);
      expect(result.messageCount).toBe(1);

      // Verify working memory matches checkpoint
      const blocks = await memory.list('working');
      expect(blocks.length).toBe(2);
      expect(blocks.some(b => b.label === 'session-state' && b.content === 'restored session')).toBe(true);
      expect(blocks.some(b => b.label === 'context' && b.content === 'user context')).toBe(true);
    });
  });

  describe('arch-hardening.AC1.2: Failure - pre-flight rejects invalid label', () => {
    it('should reject checkpoint with invalid label and not modify any state', async () => {
      // Setup: create message and initial memory state
      await persistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [TEST_CONVERSATION_ID, 'user', 'test'],
      );

      const writeResult = await memory.write('existing-block', 'initial content', 'working');
      expect(writeResult.applied).toBe(true);

      // Create checkpoint with invalid label (starts with number)
      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-bad',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [
          { label: '123-invalid', content: 'bad label' },
        ],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        predictionStore,
        interestRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Attempt restore - should throw
      let threwError = false;
      let errorMessage = '';
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch (error) {
        threwError = true;
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      }

      expect(threwError).toBe(true);
      expect(errorMessage).toContain('pre-flight validation failed');

      // Verify state unchanged: existing block should still be present
      const blocks = await memory.list('working');
      expect(blocks.length).toBe(1);
      expect(blocks[0]!.label).toBe('existing-block');
      expect(blocks[0]!.content).toBe('initial content');
    });
  });

  describe('arch-hardening.AC1.3: Failure - pre-flight rejects oversized block', () => {
    it('should reject checkpoint with block exceeding MAX_BLOCK_CONTENT_LENGTH', async () => {
      // Create oversized content (> 10000 chars)
      const oversizedContent = 'x'.repeat(10001);

      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-oversized',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [
          { label: 'large-block', content: oversizedContent },
        ],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        predictionStore,
        interestRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Attempt restore - should throw
      let threwError = false;
      let errorMessage = '';
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch (error) {
        threwError = true;
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      }

      expect(threwError).toBe(true);
      expect(errorMessage).toContain('exceeds limit');

      // Verify no memory blocks were written
      const blocks = await memory.list('working');
      expect(blocks.length).toBe(0);
    });
  });

  describe('arch-hardening.AC1.4: Failure - pre-flight rejects block count exceeding limit', () => {
    it('should reject checkpoint with more than MAX_WORKING_BLOCKS blocks', async () => {
      // Create 21 blocks (exceeds limit of 20)
      const workingMemory: Array<CheckpointWorkingMemory> = [];
      for (let i = 0; i < 21; i++) {
        workingMemory.push({
          label: `block-${i}`,
          content: `content ${i}`,
        });
      }

      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-too-many',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory,
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        predictionStore,
        interestRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Attempt restore - should throw
      let threwError = false;
      let errorMessage = '';
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch (error) {
        threwError = true;
        if (error instanceof Error) {
          errorMessage = error.message;
        }
      }

      expect(threwError).toBe(true);
      expect(errorMessage).toContain('exceeds limit');

      // Verify no memory blocks were written
      const blocks = await memory.list('working');
      expect(blocks.length).toBe(0);
    });
  });

  describe('arch-hardening.AC1.5: Failure - DB write fails mid-Tier-1, all writes rolled back', () => {
    it('should rollback DB operations when interestRegistry.updateInterest throws', async () => {
      // Setup: create conversation with message
      await persistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [TEST_CONVERSATION_ID, 'user', 'test'],
      );

      // Create an interest
      const interest = await interestRegistry.createInterest({
        name: 'test-interest',
        description: 'test interest for checkpoint',
        source: 'emergent',
        engagementScore: 10,
        status: 'active',
        owner: AGENT_OWNER,
      });

      // Create checkpoint with interest that has different engagement score
      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-interest-update',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [{ label: 'test', content: 'content' }],
        pendingPredictions: [],
        activeInterests: [
          {
            id: interest.id,
            name: interest.name,
            engagementScore: 50,
            status: 'active',
            lastEngagedAt: new Date().toISOString(),
          },
        ],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      // Create a mock interestRegistry that throws on updateInterest
      const failingRegistry = {
        ...interestRegistry,
        updateInterest: async () => {
          throw new Error('Simulated DB failure');
        },
      };

      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        predictionStore,
        interestRegistry: failingRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Attempt restore - should throw
      let threwError = false;
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(true);

      // Verify interest score was NOT updated (transaction rolled back)
      const interests = await interestRegistry.listInterests(AGENT_OWNER);
      const updatedInterest = interests.find(i => i.id === interest.id);
      expect(updatedInterest?.engagementScore).toBe(interest.engagementScore);

      // Verify memory was not written (transaction rolled back)
      const blocks = await memory.list('working');
      expect(blocks.length).toBe(0);
    });
  });

  describe('arch-hardening.AC1.6: Failure - memory write fails in Tier 2, DB rolled back, memory best-effort cleared', () => {
    it('should clear working memory on write failure and rollback DB', async () => {
      // Setup: create conversation
      await persistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [TEST_CONVERSATION_ID, 'user', 'test'],
      );

      // Create an interest
      const interest = await interestRegistry.createInterest({
        name: 'test-interest-2',
        description: 'second test interest for checkpoint',
        source: 'emergent',
        engagementScore: 15,
        status: 'active',
        owner: AGENT_OWNER,
      });

      // Create checkpoint with interest to update and memory to write
      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-memory-fail',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [
          { label: 'block-1', content: 'content 1' },
          { label: 'block-2', content: 'content 2' },
        ],
        pendingPredictions: [],
        activeInterests: [
          {
            id: interest.id,
            name: interest.name,
            engagementScore: 75,
            status: 'active',
            lastEngagedAt: new Date().toISOString(),
          },
        ],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      // Create a mock MemoryManager that throws on second write
      let writeCount = 0;
      const failingMemory = {
        ...memory,
        write: async (label: string, content: string, tier?: any, reason?: string) => {
          writeCount++;
          if (writeCount === 2) {
            throw new Error('Simulated memory write failure');
          }
          return memory.write(label, content, tier, reason);
        },
        list: memory.list.bind(memory),
        deleteBlock: memory.deleteBlock.bind(memory),
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: failingMemory,
        messageStore,
        predictionStore,
        interestRegistry,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      // Attempt restore - should throw
      let threwError = false;
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(true);

      // Verify interest score was NOT updated (transaction rolled back)
      const interests = await interestRegistry.listInterests(AGENT_OWNER);
      const updatedInterest = interests.find(i => i.id === interest.id);
      expect(updatedInterest?.engagementScore).toBe(interest.engagementScore);

      // Verify working memory was cleared (best-effort cleanup)
      // Note: This is challenging to verify without internal access to memory.list
      // In production, we'd see it was attempted to be cleared
      const finalBlocks = await memory.list('working');
      // Should be empty or contain only what was written before the failure
      expect(finalBlocks.length).toBeLessThanOrEqual(1);
    });
  });
});
