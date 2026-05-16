// pattern: Imperative Shell
import {expect, test, describe} from 'bun:test';
import {performCheckpoint, type CheckpointDependencies, type CheckpointAgentState} from './checkpoint-create.ts';
import type {SessionCheckpoint} from './checkpoint-types.ts';
import type {MemoryBlock} from '@/memory/types.ts';
import type {Prediction} from '@/reflexion/types.ts';
import type {Interest} from '@/subconscious/types.ts';

describe('performCheckpoint', () => {
  test('successful checkpoint creation with all subsystems', async () => {
    const savedCheckpoints: Array<SessionCheckpoint> = [];
    const prunedConversations: Array<{conversationId: string; retainCount: number}> = [];

    const mockMemory = {
      list: async (tier: string) => {
        if (tier === 'working') {
          return [
            {id: '1', label: 'recent_findings', content: 'Found important pattern X'},
            {id: '2', label: 'pending_investigation', content: 'Investigate Y further'},
          ] as Array<MemoryBlock>;
        }
        return [];
      },
    };

    const mockPredictionStore = {
      listPredictions: async () => {
        return [
          {
            id: 'pred1',
            predictionText: 'User will ask about patterns',
            domain: 'user_behavior',
            confidence: 0.8,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'pred2',
            predictionText: 'System will need optimization',
            domain: 'performance',
            confidence: 0.65,
            createdAt: new Date().toISOString(),
          },
        ] as any as Array<Prediction>;
      },
    };

    const mockInterestRegistry = {
      listInterests: async () => {
        return [
          {
            id: 'int1',
            name: 'Pattern Recognition',
            engagementScore: 0.85,
            status: 'active' as const,
            lastEngagedAt: new Date().toISOString(),
          },
        ] as any as Array<Interest>;
      },
    };

    const mockRecallContextState = {
      getResult: () => ({
        fragments: [
          {label: 'frag1', domain: 'search', content: 'recalled content', score: 0.9},
        ],
        totalTokens: 150,
        queryCount: 1,
        elapsed: 250,
      }),
    };

    const mockCheckpointStore = {
      save: async (checkpoint: SessionCheckpoint) => {
        savedCheckpoints.push(checkpoint);
      },
      prune: async (conversationId: string, retainCount: number) => {
        prunedConversations.push({conversationId, retainCount});
        return 0;
      },
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: mockMemory as any,
      predictionStore: mockPredictionStore as any,
      interestRegistry: mockInterestRegistry as any,
      recallContextState: mockRecallContextState as any,
      owner: 'test-owner',
      conversationId: 'conv-123',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 10,
      toolRound: 0,
      messageIds: ['msg-1', 'msg-2', 'msg-3'],
      compactionMeta: {
        lastCompactedIndex: 5,
        summaryCount: 2,
      },
    };

    const result = await performCheckpoint('explicit', agentState, deps);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(savedCheckpoints).toHaveLength(1);

    const checkpoint = savedCheckpoints[0]!;
    expect(checkpoint.trigger).toBe('explicit');
    expect(checkpoint.owner).toBe('test-owner');
    expect(checkpoint.conversationId).toBe('conv-123');
    expect(checkpoint.turnNumber).toBe(10);
    expect(checkpoint.toolRound).toBe(0);
    expect(checkpoint.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(checkpoint.workingMemory).toHaveLength(2);
    expect(checkpoint.workingMemory[0]!.label).toBe('recent_findings');
    expect(checkpoint.pendingPredictions).toHaveLength(2);
    expect(checkpoint.pendingPredictions[0]!.predictionText).toBe('User will ask about patterns');
    expect(checkpoint.activeInterests).toHaveLength(1);
    expect(checkpoint.activeInterests[0]!.name).toBe('Pattern Recognition');
    expect(checkpoint.recallCache).not.toBeNull();
    expect(checkpoint.recallCache!.fragmentCount).toBe(1);

    expect(prunedConversations).toHaveLength(1);
    expect(prunedConversations[0]!.conversationId).toBe('conv-123');
    expect(prunedConversations[0]!.retainCount).toBe(5);
  });

  test('failure tolerance: store error returns null without throwing', async () => {
    const errorCheckpointStore = {
      save: async () => {
        throw new Error('Database connection failed');
      },
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: errorCheckpointStore,
      memory: {list: async () => []} as any,
      owner: 'test-owner',
      conversationId: 'conv-123',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 5,
      toolRound: 0,
      messageIds: [],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    let consoleWarnCalled = false;
    const originalWarn = console.warn;
    console.warn = (msg: string) => {
      if (msg.includes('checkpoint') && msg.includes('failed')) {
        consoleWarnCalled = true;
      }
    };

    try {
      const result = await performCheckpoint('interval', agentState, deps);
      expect(result).toBeNull();
      expect(consoleWarnCalled).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('empty subsystem state: missing optional dependencies', async () => {
    const savedCheckpoints: Array<SessionCheckpoint> = [];

    const mockCheckpointStore = {
      save: async (checkpoint: SessionCheckpoint) => {
        savedCheckpoints.push(checkpoint);
      },
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {list: async () => []} as any,
      owner: 'test-owner',
      conversationId: 'conv-456',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 1,
      toolRound: 0,
      messageIds: ['msg-1'],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    await performCheckpoint('shutdown', agentState, deps);

    expect(savedCheckpoints).toHaveLength(1);
    const checkpoint = savedCheckpoints[0]!;
    expect(checkpoint.workingMemory).toHaveLength(0);
    expect(checkpoint.pendingPredictions).toHaveLength(0);
    expect(checkpoint.activeInterests).toHaveLength(0);
    expect(checkpoint.recallCache).toBeNull();
  });

  test('working memory block mapping', async () => {
    const savedCheckpoints: Array<SessionCheckpoint> = [];

    const mockCheckpointStore = {
      save: async (checkpoint: SessionCheckpoint) => {
        savedCheckpoints.push(checkpoint);
      },
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {
        list: async () => [
          {id: 'b1', label: 'context_a', content: 'content_a', tier: 'working'},
          {id: 'b2', label: 'context_b', content: 'content_b', tier: 'working'},
        ] as Array<MemoryBlock>,
      } as any,
      owner: 'test-owner',
      conversationId: 'conv-789',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 3,
      toolRound: 0,
      messageIds: ['m1', 'm2'],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    await performCheckpoint('pre_compaction', agentState, deps);

    const checkpoint = savedCheckpoints[0]!;
    expect(checkpoint.workingMemory).toHaveLength(2);
    expect(checkpoint.workingMemory[0]).toEqual({label: 'context_a', content: 'content_a'});
    expect(checkpoint.workingMemory[1]).toEqual({label: 'context_b', content: 'content_b'});
  });

  test('predictions mapped with correct fields', async () => {
    const savedCheckpoints: Array<SessionCheckpoint> = [];
    const createdAtString = new Date('2026-05-16T10:00:00Z').toISOString();

    const mockPredictionStore = {
      listPredictions: async () => [
        {
          id: 'p1',
          predictionText: 'Prediction 1',
          domain: 'domain1',
          confidence: 0.75,
          createdAt: createdAtString,
        },
      ] as any as Array<Prediction>,
    };

    const mockCheckpointStore = {
      save: async (checkpoint: SessionCheckpoint) => {
        savedCheckpoints.push(checkpoint);
      },
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {list: async () => []} as any,
      predictionStore: mockPredictionStore as any,
      owner: 'test-owner',
      conversationId: 'conv-999',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 2,
      toolRound: 0,
      messageIds: [],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    await performCheckpoint('explicit', agentState, deps);

    const checkpoint = savedCheckpoints[0]!;
    expect(checkpoint.pendingPredictions).toHaveLength(1);
    const pred = checkpoint.pendingPredictions[0]!;
    expect(pred.id).toBe('p1');
    expect(pred.predictionText).toBe('Prediction 1');
    expect(pred.domain).toBe('domain1');
    expect(pred.confidence).toBe(0.75);
    expect(pred.createdAt).toBe(createdAtString);
  });

  test('interests mapped with correct fields', async () => {
    const savedCheckpoints: Array<SessionCheckpoint> = [];
    const lastEngagedAtString = new Date('2026-05-16T11:00:00Z').toISOString();

    const mockInterestRegistry = {
      listInterests: async () => [
        {
          id: 'i1',
          name: 'Interest Name',
          engagementScore: 0.92,
          status: 'active' as const,
          lastEngagedAt: lastEngagedAtString,
        },
      ] as any as Array<Interest>,
    };

    const mockCheckpointStore = {
      save: async (checkpoint: SessionCheckpoint) => {
        savedCheckpoints.push(checkpoint);
      },
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {list: async () => []} as any,
      interestRegistry: mockInterestRegistry as any,
      owner: 'test-owner',
      conversationId: 'conv-111',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 1,
      toolRound: 0,
      messageIds: [],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    await performCheckpoint('explicit', agentState, deps);

    const checkpoint = savedCheckpoints[0]!;
    expect(checkpoint.activeInterests).toHaveLength(1);
    const interest = checkpoint.activeInterests[0]!;
    expect(interest.id).toBe('i1');
    expect(interest.name).toBe('Interest Name');
    expect(interest.engagementScore).toBe(0.92);
    expect(interest.status).toBe('active');
    expect(interest.lastEngagedAt).toBe(lastEngagedAtString);
  });

  test('prune is called after save', async () => {
    const callOrder: Array<string> = [];

    const mockCheckpointStore = {
      save: async () => {
        callOrder.push('save');
      },
      prune: async () => {
        callOrder.push('prune');
        return 0;
      },
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {list: async () => []} as any,
      owner: 'test-owner',
      conversationId: 'conv-222',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 1,
      toolRound: 0,
      messageIds: [],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    await performCheckpoint('explicit', agentState, deps);

    expect(callOrder).toEqual(['save', 'prune']);
  });

  test('returns UUID string on success', async () => {
    const mockCheckpointStore = {
      save: async () => {},
      prune: async () => 0,
    } as any as Parameters<typeof performCheckpoint>[2]['checkpointStore'];

    const deps: CheckpointDependencies = {
      checkpointStore: mockCheckpointStore,
      memory: {list: async () => []} as any,
      owner: 'test-owner',
      conversationId: 'conv-333',
      retentionCount: 5,
    };

    const agentState: CheckpointAgentState = {
      turnNumber: 1,
      toolRound: 0,
      messageIds: [],
      compactionMeta: {lastCompactedIndex: -1, summaryCount: 0},
    };

    const result = await performCheckpoint('explicit', agentState, deps);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    // Verify it's a valid UUID (36 chars with hyphens at positions 8, 13, 18, 23)
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
