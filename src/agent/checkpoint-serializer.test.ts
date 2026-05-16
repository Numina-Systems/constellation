import {describe, test, expect, beforeEach} from 'bun:test';
import {
  serializeCheckpoint,
  deserializeCheckpoint,
  type SerializeCheckpointOptions,
} from './checkpoint-serializer.ts';
import type { AgentCheckpointState } from './checkpoint-types.ts';

function createTestState(overrides?: Partial<AgentCheckpointState>): AgentCheckpointState {
  return {
    turnNumber: 5,
    toolRound: 2,
    messageIds: ['msg-1', 'msg-2', 'msg-3'],
    workingMemory: [
      {label: 'goals', content: 'Be helpful and accurate'},
      {label: 'context', content: 'Current user session'},
    ],
    pendingPredictions: [
      {
        id: 'pred-1',
        predictionText: 'User will ask a follow-up',
        domain: 'conversation',
        confidence: 0.75,
        createdAt: '2026-05-16T10:00:00Z',
      },
    ],
    activeInterests: [
      {
        id: 'int-1',
        name: 'machine learning',
        engagementScore: 3.5,
        status: 'active',
        lastEngagedAt: '2026-05-16T09:30:00Z',
      },
    ],
    compactionMeta: {
      lastCompactedIndex: 42,
      summaryCount: 3,
    },
    recallCache: {
      decomposition: {
        queries: ['query-1', 'query-2'],
        entities: ['entity-1'],
      },
      fragmentCount: 5,
    },
    ...overrides,
  };
}

describe('session-checkpointing.AC2: Checkpoint Content', () => {
  let testOptions: SerializeCheckpointOptions;

  beforeEach(() => {
    testOptions = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: 'conv-123',
      owner: 'user-456',
      trigger: 'explicit',
      state: createTestState(),
      createdAt: '2026-05-16T10:30:00Z',
    };
  });

  describe('AC2.1: Full conversation message history (IDs only)', () => {
    test('serializes messageIds exactly', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  describe('AC2.2: Working memory block labels and content', () => {
    test('serializes working memory blocks exactly', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.workingMemory).toEqual([
        {label: 'goals', content: 'Be helpful and accurate'},
        {label: 'context', content: 'Current user session'},
      ]);
    });
  });

  describe('AC2.3: Pending prediction journal entries', () => {
    test('serializes predictions with all fields', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.pendingPredictions).toEqual([
        {
          id: 'pred-1',
          predictionText: 'User will ask a follow-up',
          domain: 'conversation',
          confidence: 0.75,
          createdAt: '2026-05-16T10:00:00Z',
        },
      ]);
    });

    test('handles predictions with null domain and confidence', () => {
      const stateWithNullPrediction = createTestState({
        pendingPredictions: [
          {
            id: 'pred-2',
            predictionText: 'Something will happen',
            domain: null,
            confidence: null,
            createdAt: '2026-05-16T10:00:00Z',
          },
        ],
      });

      const checkpoint = serializeCheckpoint({
        ...testOptions,
        state: stateWithNullPrediction,
      });
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.pendingPredictions[0]?.domain).toBeNull();
      expect(deserialized.pendingPredictions[0]?.confidence).toBeNull();
    });
  });

  describe('AC2.4: Active interest state from subconscious', () => {
    test('serializes interests with status and engagement', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.activeInterests).toEqual([
        {
          id: 'int-1',
          name: 'machine learning',
          engagementScore: 3.5,
          status: 'active',
          lastEngagedAt: '2026-05-16T09:30:00Z',
        },
      ]);
    });

    test('handles all interest statuses', () => {
      const statuses: Array<'active' | 'dormant' | 'abandoned'> = [
        'active',
        'dormant',
        'abandoned',
      ];
      for (const status of statuses) {
        const stateWithStatus = createTestState({
          activeInterests: [
            {
              id: 'int-2',
              name: 'test',
              engagementScore: 1.0,
              status,
              lastEngagedAt: '2026-05-16T09:30:00Z',
            },
          ],
        });

        const checkpoint = serializeCheckpoint({
          ...testOptions,
          state: stateWithStatus,
        });
        const deserialized = deserializeCheckpoint(
          JSON.parse(JSON.stringify(checkpoint))
        );

        expect(deserialized.activeInterests[0]?.status).toBe(status);
      }
    });
  });

  describe('AC2.5: Compaction metadata', () => {
    test('serializes lastCompactedIndex and summaryCount', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.compactionMeta).toEqual({
        lastCompactedIndex: 42,
        summaryCount: 3,
      });
    });
  });

  describe('AC2.6: Recall cache', () => {
    test('serializes recall cache with decomposition and fragment count', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.recallCache).toEqual({
        decomposition: {
          queries: ['query-1', 'query-2'],
          entities: ['entity-1'],
        },
        fragmentCount: 5,
      });
    });

    test('handles null recall cache', () => {
      const stateWithNullRecall = createTestState({
        recallCache: null,
      });

      const checkpoint = serializeCheckpoint({
        ...testOptions,
        state: stateWithNullRecall,
      });
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.recallCache).toBeNull();
    });
  });

  describe('AC2.7: Turn number and tool round count', () => {
    test('serializes turnNumber and toolRound', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.turnNumber).toBe(5);
      expect(deserialized.toolRound).toBe(2);
    });
  });

  describe('AC2.8: Empty checkpoint edge case', () => {
    test('serializes empty arrays and null values cleanly', () => {
      const emptyState = createTestState({
        messageIds: [],
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        recallCache: null,
      });

      const checkpoint = serializeCheckpoint({
        ...testOptions,
        state: emptyState,
      });
      const deserialized = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(deserialized.messageIds).toEqual([]);
      expect(deserialized.workingMemory).toEqual([]);
      expect(deserialized.pendingPredictions).toEqual([]);
      expect(deserialized.activeInterests).toEqual([]);
      expect(deserialized.recallCache).toBeNull();
    });
  });
});

describe('session-checkpointing.AC5: Storage and Migration', () => {
  let testOptions: SerializeCheckpointOptions;

  beforeEach(() => {
    testOptions = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      conversationId: 'conv-123',
      owner: 'user-456',
      trigger: 'explicit',
      state: createTestState(),
      createdAt: '2026-05-16T10:30:00Z',
    };
  });

  describe('AC5.3: Zod validation on deserialization', () => {
    test('validates well-formed JSONB data', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const jsonbCycle = JSON.parse(JSON.stringify(checkpoint));
      const deserialized = deserializeCheckpoint(jsonbCycle);

      expect(deserialized.version).toBe(1);
      expect(deserialized.id).toBe(testOptions.id);
      expect(deserialized.conversationId).toBe(testOptions.conversationId);
    });

    test('round-trip fidelity through JSONB cycle', () => {
      const checkpoint = serializeCheckpoint(testOptions);
      const roundTrip = deserializeCheckpoint(
        JSON.parse(JSON.stringify(checkpoint))
      );

      expect(roundTrip.turnNumber).toBe(checkpoint.turnNumber);
      expect(roundTrip.toolRound).toBe(checkpoint.toolRound);
      expect(roundTrip.messageIds).toEqual(checkpoint.messageIds);
      expect(roundTrip.workingMemory).toEqual(checkpoint.workingMemory);
      expect(roundTrip.pendingPredictions).toEqual(checkpoint.pendingPredictions);
      expect(roundTrip.activeInterests).toEqual(checkpoint.activeInterests);
      expect(roundTrip.compactionMeta).toEqual(checkpoint.compactionMeta);
      expect(roundTrip.recallCache).toEqual(checkpoint.recallCache);
    });
  });

  describe('AC5.4: Corrupted JSONB validation failures', () => {
    test('rejects missing required field (conversationId)', () => {
      const corrupted = {
        version: 1,
        id: '550e8400-e29b-41d4-a716-446655440000',
        owner: 'user-456',
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
        recallCache: null,
        createdAt: '2026-05-16T10:30:00Z',
        // missing conversationId
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
      try {
        deserializeCheckpoint(corrupted);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
        expect((e as Error).message).toContain('conversationId');
      }
    });

    test('rejects wrong type for numeric field', () => {
      const corrupted = {
        version: 1,
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'conv-123',
        owner: 'user-456',
        trigger: 'explicit',
        turnNumber: 'not a number',
        toolRound: 2,
        messageIds: [],
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
        recallCache: null,
        createdAt: '2026-05-16T10:30:00Z',
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
      try {
        deserializeCheckpoint(corrupted);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
      }
    });

    test('rejects unknown version', () => {
      const corrupted = {
        version: 99,
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'conv-123',
        owner: 'user-456',
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
        recallCache: null,
        createdAt: '2026-05-16T10:30:00Z',
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
      try {
        deserializeCheckpoint(corrupted);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
        expect((e as Error).message).toContain('version');
      }
    });

    test('rejects null input', () => {
      expect(() => deserializeCheckpoint(null)).toThrow();
      try {
        deserializeCheckpoint(null);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
      }
    });

    test('rejects string input', () => {
      expect(() => deserializeCheckpoint('not an object')).toThrow();
    });

    test('rejects number input', () => {
      expect(() => deserializeCheckpoint(42)).toThrow();
    });

    test('rejects partial object with missing fields', () => {
      const corrupted = {
        version: 1,
        id: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
      try {
        deserializeCheckpoint(corrupted);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
      }
    });

    test('rejects null array when array expected', () => {
      const corrupted = {
        version: 1,
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'conv-123',
        owner: 'user-456',
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: null,
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
        recallCache: null,
        createdAt: '2026-05-16T10:30:00Z',
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
    });
  });

  describe('Serialization metadata', () => {
    test('serializeCheckpoint sets version, id, createdAt correctly', () => {
      const checkpoint = serializeCheckpoint(testOptions);

      expect(checkpoint.version).toBe(1);
      expect(checkpoint.id).toBe(testOptions.id);
      expect(checkpoint.conversationId).toBe(testOptions.conversationId);
      expect(checkpoint.owner).toBe(testOptions.owner);
      expect(checkpoint.trigger).toBe(testOptions.trigger);
      expect(checkpoint.createdAt).toBe(testOptions.createdAt);
    });

    test('serializeCheckpoint handles all trigger types', () => {
      const triggers: Array<'explicit' | 'pre_compaction' | 'shutdown' | 'interval'> = [
        'explicit',
        'pre_compaction',
        'shutdown',
        'interval',
      ];

      for (const trigger of triggers) {
        const checkpoint = serializeCheckpoint({
          ...testOptions,
          trigger,
        });
        expect(checkpoint.trigger).toBe(trigger);
      }
    });

    test('rejects data with version 2', () => {
      const corrupted = {
        version: 2,
        id: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'conv-123',
        owner: 'user-456',
        trigger: 'explicit',
        turnNumber: 5,
        toolRound: 2,
        messageIds: [],
        workingMemory: [],
        pendingPredictions: [],
        activeInterests: [],
        compactionMeta: {lastCompactedIndex: 0, summaryCount: 0},
        recallCache: null,
        createdAt: '2026-05-16T10:30:00Z',
      };

      expect(() => deserializeCheckpoint(corrupted)).toThrow();
      try {
        deserializeCheckpoint(corrupted);
      } catch (e) {
        expect((e as Error).message).toContain('checkpoint validation failed');
        expect((e as Error).message).toContain('version');
      }
    });
  });
});
