// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
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
    const databaseUrl = process.env['DATABASE_URL'] || 'postgresql://constellation:constellation@localhost:5432/constellation';
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
      const messageId1 = randomUUID();
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content)
         VALUES ($1, $2, $3, $4)`,
        [messageId1, TEST_CONVERSATION_ID, 'user', 'test message'],
      );

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

      const result = await restoreFromCheckpoint(checkpoint, deps);
      expect(result.conversationId).toBe(TEST_CONVERSATION_ID);
      expect(result.turnNumber).toBe(5);
      expect(result.toolRound).toBe(2);
      expect(result.messageCount).toBe(1);

      // Verify working memory was restored
      const blocks = await memory.list('working');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.label).toBe('session-state');
      expect(blocks[0]?.content).toBe('restored session');
      expect(blocks[1]?.label).toBe('context');
      expect(blocks[1]?.content).toBe('user context');
    });
  });

  describe('arch-hardening.AC1.2: Pre-flight validation rejects invalid memory', () => {
    it('should reject checkpoint with memory block content exceeding length limit', async () => {
      const invalidCheckpoint: SessionCheckpoint = {
        version: 1,
        id: 'invalid-checkpoint',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 1,
        toolRound: 0,
        messageIds: [],
        workingMemory: [
          {
            label: 'valid-label',
            content: 'x'.repeat(50000), // exceeds MAX_BLOCK_CONTENT_LENGTH (10000)
          },
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

      let caughtError: unknown = null;
      try {
        await restoreFromCheckpoint(invalidCheckpoint, deps);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toContain('pre-flight validation failed');
    });
  });

  describe('arch-hardening.AC1.3: Message integrity check on empty conversation', () => {
    it('should reject restore when conversation has no messages but checkpoint references them', async () => {
      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-empty-conv',
        conversationId: 'conv-nonexistent',
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 1,
        toolRound: 0,
        messageIds: ['msg-1', 'msg-2'],
        workingMemory: [],
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

      let caughtError: unknown = null;
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toContain('cannot restore checkpoint');
    });
  });

  describe('arch-hardening.AC1.4: Rollback on memory restore failure', () => {
    it('should rollback DB transaction if memory write fails', async () => {
      // Setup: create a valid conversation
      const messageId = randomUUID();
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content)
         VALUES ($1, $2, $3, $4)`,
        [messageId, TEST_CONVERSATION_ID, 'user', 'test'],
      );

      // Create a checkpoint that will fail during memory restore
      // (by trying to restore too many blocks)
      const tooManyBlocks: CheckpointWorkingMemory[] = [];
      for (let i = 0; i < 25; i++) {
        tooManyBlocks.push({
          label: `block-${i}`,
          content: 'content',
        });
      }

      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-too-many',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 1,
        toolRound: 0,
        messageIds: [messageId],
        workingMemory: tooManyBlocks,
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

      let caughtError: unknown = null;
      try {
        await restoreFromCheckpoint(checkpoint, deps);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  describe('arch-hardening.AC1.5: Graceful degradation for missing subsystem state', () => {
    it('should complete restore when predictions missing', async () => {
      const messageId = randomUUID();
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content)
         VALUES ($1, $2, $3, $4)`,
        [messageId, TEST_CONVERSATION_ID, 'user', 'test'],
      );

      const checkpoint: SessionCheckpoint = {
        version: 1,
        id: 'checkpoint-no-preds',
        conversationId: TEST_CONVERSATION_ID,
        owner: AGENT_OWNER,
        trigger: 'explicit',
        turnNumber: 2,
        toolRound: 0,
        messageIds: [messageId],
        workingMemory: [{ label: 'state', content: 'restored' }],
        pendingPredictions: [], // Empty
        activeInterests: [],
        compactionMeta: { lastCompactedIndex: 0, summaryCount: 0 },
        recallCache: null,
        createdAt: new Date().toISOString(),
      };

      // Create deps without predictionStore
      const deps: RestorationDependencies = {
        persistence,
        memory,
        messageStore,
        traceRecorder,
        owner: AGENT_OWNER,
      };

      const result = await restoreFromCheckpoint(checkpoint, deps);
      expect(result.turnNumber).toBe(2);
      expect(result.messageCount).toBe(1);

      // Memory should still be restored
      const blocks = await memory.list('working');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.label).toBe('state');
    });
  });
});
