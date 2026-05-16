// pattern: Imperative Shell

import {describe, it, expect, beforeAll, afterEach, afterAll} from 'bun:test';
import {restoreFromCheckpoint, type RestorationDependencies} from './checkpoint-restore.ts';
import {serializeCheckpoint} from './checkpoint-serializer.ts';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import type {SessionCheckpoint, AgentCheckpointState, CheckpointCompactionMeta} from './checkpoint-types.ts';
import type {MemoryBlock} from '@/memory/types.ts';
import type {Prediction} from '@/reflexion/types.ts';
import type {Interest} from '@/subconscious/types.ts';
import type {RecallResult} from '@/recall/types.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function createTestMessages(
  conversationId: string,
  messageIds: ReadonlyArray<string>,
): Promise<void> {
  for (const id of messageIds) {
    await persistence.query(
      'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, conversationId, 'user', 'test message', new Date().toISOString()],
    );
  }
}

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE messages CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE predictions CASCADE');
  await persistence.query('TRUNCATE TABLE interests CASCADE');
}

function createTestCheckpoint(
  overrides: Partial<SessionCheckpoint> = {},
): SessionCheckpoint {
  const now = new Date().toISOString();
  const state: AgentCheckpointState = {
    turnNumber: 1,
    toolRound: 0,
    messageIds: ['msg-1'],
    workingMemory: [],
    pendingPredictions: [],
    activeInterests: [],
    compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
    recallCache: null,
  };

  return serializeCheckpoint({
    id: crypto.randomUUID(),
    conversationId: 'conv-test',
    owner: 'agent-1',
    trigger: 'explicit',
    state,
    createdAt: now,
    ...overrides,
  });
}

describe('restoreFromCheckpoint Integration Tests', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('session-checkpointing.AC3.6: Deleted conversation fails', () => {
    it('should throw error when conversation has no messages but checkpoint references them', async () => {
      const conversationId = 'conv-deleted';
      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: ['msg-1', 'msg-2'],
      });

      // Create checkpoint but don't create messages

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      try {
        await restoreFromCheckpoint(checkpoint, deps);
        expect.unreachable('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('no messages (deleted or missing)');
      }
    });
  });

  describe('session-checkpointing.AC3.1: Message coverage verification', () => {
    it('should log warning when some checkpoint messages are missing', async () => {
      const conversationId = 'conv-missing';
      const checkpointMessageIds = ['msg-1', 'msg-2', 'msg-3'];

      // Create only some messages
      await createTestMessages(conversationId, ['msg-1', 'msg-3']);

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: checkpointMessageIds,
      });

      let loggedWarning = '';
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        loggedWarning = String(args[0]);
      };

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      try {
        const result = await restoreFromCheckpoint(checkpoint, deps);
        expect(result?.messageCount).toBe(2);
        expect(loggedWarning).toContain('1 message(s) from checkpoint are missing');
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('session-checkpointing.AC3.2: Working memory restoration', () => {
    it('should restore working memory blocks exactly as checkpointed', async () => {
      const conversationId = 'conv-memory';
      const checkpointBlocks = [
        {label: 'findings', content: 'Important findings from analysis'},
        {label: 'status', content: 'Current investigation status'},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        workingMemory: checkpointBlocks,
      } as any);

      let writtenBlocks: Array<{label: string; content: string}> = [];
      let deletedBlockIds: Array<string> = [];

      const mockMemory = {
        list: async (tier: string) => {
          if (tier === 'working') {
            return [
              {id: 'old-1', label: 'outdated', content: 'should be deleted'},
            ] as Array<MemoryBlock>;
          }
          return [];
        },
        write: async (label: string, content: string) => {
          writtenBlocks.push({label, content});
          return {applied: true, block: {id: crypto.randomUUID(), label, content}};
        },
        deleteBlock: async (id: string) => {
          deletedBlockIds.push(id);
        },
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      await restoreFromCheckpoint(checkpoint, deps);

      expect(writtenBlocks).toHaveLength(2);
      expect(writtenBlocks[0]).toEqual({label: 'findings', content: 'Important findings from analysis'});
      expect(writtenBlocks[1]).toEqual({label: 'status', content: 'Current investigation status'});
      expect(deletedBlockIds).toHaveLength(1);
      expect(deletedBlockIds[0]).toBe('old-1');
    });
  });

  describe('session-checkpointing.AC3.4: Active interests restoration', () => {
    it('should restore engagement scores to checkpoint values', async () => {
      const conversationId = 'conv-interests';
      const checkpointInterests = [
        {id: 'int-1', name: 'Pattern Analysis', engagementScore: 0.75, status: 'active' as const, lastEngagedAt: new Date().toISOString()},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        activeInterests: checkpointInterests,
      } as any);

      let restoredInterests: Array<{id: string; engagementScore: number}> = [];

      const mockInterestRegistry = {
        listInterests: async () => {
          return [
            {
              id: 'int-1',
              name: 'Pattern Analysis',
              engagementScore: 0.5,
              status: 'active' as const,
              lastEngagedAt: new Date().toISOString(),
              owner: 'agent-1',
              description: 'Test interest',
              source: 'exploration' as const,
              createdAt: new Date().toISOString(),
            },
          ] as unknown as Array<Interest>;
        },
        updateInterest: async (id: string, updates: {engagementScore: number}) => {
          restoredInterests.push({id, engagementScore: updates.engagementScore});
        },
      };

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        interestRegistry: mockInterestRegistry as any,
        owner: 'agent-1',
      };

      await restoreFromCheckpoint(checkpoint, deps);

      expect(restoredInterests).toHaveLength(1);
      expect(restoredInterests[0]).toEqual({id: 'int-1', engagementScore: 0.75});
    });

    it('should log warning when checkpoint interest no longer exists', async () => {
      const conversationId = 'conv-missing-interest';
      const checkpointInterests = [
        {id: 'int-missing', name: 'Deleted Interest', engagementScore: 0.8, status: 'active' as const, lastEngagedAt: new Date().toISOString()},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        activeInterests: checkpointInterests,
      } as any);

      let loggedWarning = '';
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        loggedWarning = String(args[0]);
      };

      const mockInterestRegistry = {
        listInterests: async () => [] as Array<Interest>,
      };

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        interestRegistry: mockInterestRegistry as any,
        owner: 'agent-1',
      };

      try {
        await restoreFromCheckpoint(checkpoint, deps);
        expect(loggedWarning).toContain('interest int-missing from checkpoint no longer exists');
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('session-checkpointing.AC3.3: Pending predictions verification', () => {
    it('should log warning when checkpoint prediction no longer exists', async () => {
      const conversationId = 'conv-missing-pred';
      const checkpointPredictions = [
        {id: 'pred-missing', predictionText: 'Will happen', domain: null, confidence: null, createdAt: new Date().toISOString()},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        pendingPredictions: checkpointPredictions,
      } as any);

      let loggedWarning = '';
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        loggedWarning = String(args[0]);
      };

      const mockPredictionStore = {
        listPredictions: async () => [] as Array<Prediction>,
      };

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        predictionStore: mockPredictionStore as any,
        owner: 'agent-1',
      };

      try {
        await restoreFromCheckpoint(checkpoint, deps);
        expect(loggedWarning).toContain('pending prediction(s) from checkpoint are no longer in database');
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('session-checkpointing.AC3.5: Compaction metadata restoration', () => {
    it('should return checkpoint compaction metadata in result', async () => {
      const conversationId = 'conv-compaction';
      const compactionMeta: CheckpointCompactionMeta = {
        lastCompactedIndex: 42,
        summaryCount: 3,
      };

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        compactionMeta,
      } as any);

      const mockMemory = {
        list: async () => [] as Array<MemoryBlock>,
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      const result = await restoreFromCheckpoint(checkpoint, deps);

      expect(result.compactionMeta).toEqual({
        lastCompactedIndex: 42,
        summaryCount: 3,
      });
    });
  });

  describe('session-checkpointing.AC3.7: Idempotency', () => {
    it('should produce identical state when called twice', async () => {
      const conversationId = 'conv-idempotent';
      const checkpointBlocks = [
        {label: 'memory-1', content: 'Content 1'},
        {label: 'memory-2', content: 'Content 2'},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        workingMemory: checkpointBlocks,
      } as any);

      const writtenBlocks: Array<{label: string; content: string}> = [];

      const mockMemory = {
        list: async () => {
          // Simulate that previous calls have restored the blocks
          return checkpointBlocks.map((b, i) => ({
            id: `block-${i}`,
            label: b.label,
            content: b.content,
          })) as Array<MemoryBlock>;
        },
        write: async (label: string, content: string) => {
          writtenBlocks.push({label, content});
          return {applied: true, block: {id: crypto.randomUUID(), label, content}};
        },
        deleteBlock: async () => {},
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      const result1 = await restoreFromCheckpoint(checkpoint, deps);
      writtenBlocks.length = 0; // Reset

      const result2 = await restoreFromCheckpoint(checkpoint, deps);

      // Both results should be identical
      expect(result1).toEqual(result2);
      // Second call should also write the same blocks (upsert idempotency)
      expect(writtenBlocks).toHaveLength(2);
      expect(writtenBlocks[0]).toEqual({label: 'memory-1', content: 'Content 1'});
      expect(writtenBlocks[1]).toEqual({label: 'memory-2', content: 'Content 2'});
    });
  });

  describe('session-checkpointing.AC3.2: Empty checkpoint restores cleanly', () => {
    it('should delete existing working blocks when checkpoint has none', async () => {
      const conversationId = 'conv-empty';

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: [],
        workingMemory: [],
      } as any);

      const deletedBlockIds: Array<string> = [];

      const mockMemory = {
        list: async (tier: string) => {
          if (tier === 'working') {
            return [
              {id: 'to-delete-1', label: 'old-block', content: 'should be deleted'},
              {id: 'to-delete-2', label: 'another-old', content: 'also delete'},
            ] as Array<MemoryBlock>;
          }
          return [];
        },
        write: async () => {
          return {applied: true, block: {}};
        },
        deleteBlock: async (id: string) => {
          deletedBlockIds.push(id);
        },
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        owner: 'agent-1',
      };

      await restoreFromCheckpoint(checkpoint, deps);

      expect(deletedBlockIds).toHaveLength(2);
      expect(deletedBlockIds).toContain('to-delete-1');
      expect(deletedBlockIds).toContain('to-delete-2');
    });
  });

  describe('session-checkpointing.AC3: Full restoration with all subsystems', () => {
    it('should restore complete agent state from checkpoint', async () => {
      const conversationId = 'conv-full';
      const checkpointBlocks = [
        {label: 'context', content: 'Session context'},
      ];

      const checkpoint = createTestCheckpoint({
        conversationId,
        messageIds: ['msg-1'],
        workingMemory: checkpointBlocks,
      } as any);

      // Create the message so conversation exists
      await createTestMessages(conversationId, ['msg-1']);

      const mockMemory = {
        list: async (tier: string) => {
          if (tier === 'working') return [] as Array<MemoryBlock>;
          return [];
        },
        write: async () => {
          return {applied: true, block: {}};
        },
        deleteBlock: async () => {},
      };

      const mockRecallContextState = {
        setResult: async (result: RecallResult | null) => {
          expect(result).toBeNull();
        },
      };

      const deps: RestorationDependencies = {
        persistence,
        memory: mockMemory as any,
        recallContextState: mockRecallContextState as any,
        owner: 'agent-1',
      };

      const restorationResult = await restoreFromCheckpoint(checkpoint, deps);

      expect(restorationResult.conversationId).toBe(conversationId);
      expect(restorationResult.turnNumber).toBe(1);
      expect(restorationResult.toolRound).toBe(0);
      expect(restorationResult.messageCount).toBe(1);
      expect(restorationResult.compactionMeta).toEqual({lastCompactedIndex: 0, summaryCount: 0});
    });
  });
});
