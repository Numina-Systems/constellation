// pattern: Imperative Shell

import {describe, it, expect, beforeAll, afterEach, afterAll} from 'bun:test';
import {createCheckpointStore} from './checkpoint-store.ts';
import {createPostgresProvider} from './postgres.ts';
import {serializeCheckpoint} from '@/agent/checkpoint-serializer.ts';
import type {SessionCheckpoint, AgentCheckpointState} from '@/agent/checkpoint-types.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let store: ReturnType<typeof createCheckpointStore>;
let persistence: ReturnType<typeof createPostgresProvider>;

function createTestCheckpoint(overrides: Partial<SessionCheckpoint> = {}): SessionCheckpoint {
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

describe('CheckpointStore Integration Tests', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    store = createCheckpointStore(persistence);
  });

  afterEach(async () => {
    await persistence.query('DELETE FROM session_checkpoints');
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('session-checkpointing.AC5.2: save and load round-trip', () => {
    it('should save checkpoint and load it back with matching fields', async () => {
      const checkpoint = createTestCheckpoint({
        conversationId: 'conv-1',
        owner: 'agent-1',
        trigger: 'explicit',
      });

      await store.save(checkpoint);
      const loaded = await store.load(checkpoint.id);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(checkpoint.id);
      expect(loaded?.conversationId).toBe(checkpoint.conversationId);
      expect(loaded?.owner).toBe(checkpoint.owner);
      expect(loaded?.trigger).toBe(checkpoint.trigger);
      expect(loaded?.turnNumber).toBe(checkpoint.turnNumber);
      expect(loaded?.toolRound).toBe(checkpoint.toolRound);
      expect(loaded?.messageIds).toEqual(checkpoint.messageIds);
      expect(loaded?.workingMemory).toEqual(checkpoint.workingMemory);
      expect(loaded?.createdAt).toBe(checkpoint.createdAt);
    });
  });

  describe('load nonexistent returns null', () => {
    it('should return null when checkpoint does not exist', async () => {
      const result = await store.load('nonexistent-id-12345');
      expect(result).toBeNull();
    });
  });

  describe('loadLatest returns most recent', () => {
    it('should return the most recent checkpoint for owner', async () => {
      const owner = 'agent-latest-test';
      const now = new Date();
      const checkpoint1 = createTestCheckpoint({
        owner,
        createdAt: new Date(now.getTime() - 2000).toISOString(),
      });
      const checkpoint2 = createTestCheckpoint({
        owner,
        createdAt: new Date(now.getTime() - 1000).toISOString(),
      });
      const checkpoint3 = createTestCheckpoint({
        owner,
        createdAt: now.toISOString(),
      });

      await store.save(checkpoint1);
      await store.save(checkpoint2);
      await store.save(checkpoint3);

      const latest = await store.loadLatest(owner);

      expect(latest).toBeDefined();
      expect(latest?.id).toBe(checkpoint3.id);
    });
  });

  describe('loadLatest with no checkpoints returns null', () => {
    it('should return null when no checkpoints exist for owner', async () => {
      const result = await store.loadLatest('nonexistent-owner-xyz');
      expect(result).toBeNull();
    });
  });

  describe('session-checkpointing.AC4.1 + AC4.3: prune deletes oldest beyond retention', () => {
    it('should delete oldest checkpoints and return count', async () => {
      const conversationId = 'conv-prune-test';
      const now = new Date();
      const checkpoints = Array.from({length: 5}, (_, i) =>
        createTestCheckpoint({
          conversationId,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        }),
      );

      for (const cp of checkpoints) {
        await store.save(cp);
      }

      const deletedCount = await store.prune(conversationId, 3);

      expect(deletedCount).toBe(2);

      // Verify oldest 2 are deleted, newest 3 remain
      for (let i = 0; i < 2; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeNull();
      }

      for (let i = 2; i < 5; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeDefined();
      }
    });
  });

  describe('session-checkpointing.AC4.2: retention parameter controls how many are kept', () => {
    it('should keep only 1 checkpoint when retainCount=1', async () => {
      const conversationId = 'conv-retain-one';
      const now = new Date();
      const checkpoints = Array.from({length: 3}, (_, i) =>
        createTestCheckpoint({
          conversationId,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        }),
      );

      for (const cp of checkpoints) {
        await store.save(cp);
      }

      const deletedCount = await store.prune(conversationId, 1);

      expect(deletedCount).toBe(2);

      // Only the newest checkpoint should remain
      for (let i = 0; i < 2; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeNull();
      }

      const newest = await store.load(checkpoints[2]!.id);
      expect(newest).toBeDefined();
      expect(newest?.id).toBe(checkpoints[2]!.id);
    });

    it('should keep 3 checkpoints when retainCount=3', async () => {
      const conversationId = 'conv-retain-three';
      const now = new Date();
      const checkpoints = Array.from({length: 5}, (_, i) =>
        createTestCheckpoint({
          conversationId,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        }),
      );

      for (const cp of checkpoints) {
        await store.save(cp);
      }

      const deletedCount = await store.prune(conversationId, 3);

      expect(deletedCount).toBe(2);

      // Oldest 2 should be deleted
      for (let i = 0; i < 2; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeNull();
      }

      // Newest 3 should remain
      for (let i = 2; i < 5; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeDefined();
      }
    });

    it('should keep 5 checkpoints when retainCount=5', async () => {
      const conversationId = 'conv-retain-five';
      const now = new Date();
      const checkpoints = Array.from({length: 7}, (_, i) =>
        createTestCheckpoint({
          conversationId,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        }),
      );

      for (const cp of checkpoints) {
        await store.save(cp);
      }

      const deletedCount = await store.prune(conversationId, 5);

      expect(deletedCount).toBe(2);

      // Oldest 2 should be deleted
      for (let i = 0; i < 2; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeNull();
      }

      // Newest 5 should remain
      for (let i = 2; i < 7; i++) {
        const loaded = await store.load(checkpoints[i]!.id);
        expect(loaded).toBeDefined();
      }
    });
  });

  describe('session-checkpointing.AC4.4: prune with fewer than retention is no-op', () => {
    it('should not delete when checkpoint count is below retention', async () => {
      const conversationId = 'conv-few-test';
      const checkpoint1 = createTestCheckpoint({
        conversationId,
      });
      const checkpoint2 = createTestCheckpoint({
        conversationId,
      });

      await store.save(checkpoint1);
      await store.save(checkpoint2);

      const deletedCount = await store.prune(conversationId, 5);

      expect(deletedCount).toBe(0);

      // Both checkpoints should still exist
      const loaded1 = await store.load(checkpoint1.id);
      const loaded2 = await store.load(checkpoint2.id);

      expect(loaded1).toBeDefined();
      expect(loaded2).toBeDefined();
    });
  });

  describe('prune scoped to conversation', () => {
    it('should only delete checkpoints from specified conversation', async () => {
      const convA = 'conv-a-scope-test';
      const convB = 'conv-b-scope-test';
      const now = new Date();

      const checkpointsA: SessionCheckpoint[] = [];
      const checkpointsB: SessionCheckpoint[] = [];

      // Create 3 checkpoints in conversation A
      for (let i = 0; i < 3; i++) {
        const cp = createTestCheckpoint({
          conversationId: convA,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        });
        checkpointsA.push(cp);
        await store.save(cp);
      }

      // Create 3 checkpoints in conversation B
      for (let i = 0; i < 3; i++) {
        const cp = createTestCheckpoint({
          conversationId: convB,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        });
        checkpointsB.push(cp);
        await store.save(cp);
      }

      // Prune conversation A with retention 1
      await store.prune(convA, 1);

      // Conversation A: oldest 2 should be deleted
      expect(await store.load(checkpointsA[0]!.id)).toBeNull();
      expect(await store.load(checkpointsA[1]!.id)).toBeNull();
      expect(await store.load(checkpointsA[2]!.id)).toBeDefined();

      // Conversation B: all 3 should remain
      expect(await store.load(checkpointsB[0]!.id)).toBeDefined();
      expect(await store.load(checkpointsB[1]!.id)).toBeDefined();
      expect(await store.load(checkpointsB[2]!.id)).toBeDefined();
    });
  });
});
