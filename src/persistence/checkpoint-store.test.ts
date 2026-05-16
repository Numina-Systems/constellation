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
    id: 'cp-' + crypto.getRandomValues(new Uint8Array(4)).join(''),
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
        id: 'cp-roundtrip-1',
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
        id: 'cp-1',
        owner,
        createdAt: new Date(now.getTime() - 2000).toISOString(),
      });
      const checkpoint2 = createTestCheckpoint({
        id: 'cp-2',
        owner,
        createdAt: new Date(now.getTime() - 1000).toISOString(),
      });
      const checkpoint3 = createTestCheckpoint({
        id: 'cp-3',
        owner,
        createdAt: now.toISOString(),
      });

      await store.save(checkpoint1);
      await store.save(checkpoint2);
      await store.save(checkpoint3);

      const latest = await store.loadLatest(owner);

      expect(latest).toBeDefined();
      expect(latest?.id).toBe('cp-3');
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
          id: `cp-prune-${i}`,
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
        const loaded = await store.load(`cp-prune-${i}`);
        expect(loaded).toBeNull();
      }

      for (let i = 2; i < 5; i++) {
        const loaded = await store.load(`cp-prune-${i}`);
        expect(loaded).toBeDefined();
      }
    });
  });

  describe('session-checkpointing.AC4.4: prune with fewer than retention is no-op', () => {
    it('should not delete when checkpoint count is below retention', async () => {
      const conversationId = 'conv-few-test';
      const checkpoint1 = createTestCheckpoint({
        id: 'cp-few-1',
        conversationId,
      });
      const checkpoint2 = createTestCheckpoint({
        id: 'cp-few-2',
        conversationId,
      });

      await store.save(checkpoint1);
      await store.save(checkpoint2);

      const deletedCount = await store.prune(conversationId, 5);

      expect(deletedCount).toBe(0);

      // Both checkpoints should still exist
      const loaded1 = await store.load('cp-few-1');
      const loaded2 = await store.load('cp-few-2');

      expect(loaded1).toBeDefined();
      expect(loaded2).toBeDefined();
    });
  });

  describe('prune scoped to conversation', () => {
    it('should only delete checkpoints from specified conversation', async () => {
      const convA = 'conv-a-scope-test';
      const convB = 'conv-b-scope-test';
      const now = new Date();

      // Create 3 checkpoints in conversation A
      for (let i = 0; i < 3; i++) {
        const cp = createTestCheckpoint({
          id: `cp-a-${i}`,
          conversationId: convA,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        });
        await store.save(cp);
      }

      // Create 3 checkpoints in conversation B
      for (let i = 0; i < 3; i++) {
        const cp = createTestCheckpoint({
          id: `cp-b-${i}`,
          conversationId: convB,
          createdAt: new Date(now.getTime() + i * 1000).toISOString(),
        });
        await store.save(cp);
      }

      // Prune conversation A with retention 1
      await store.prune(convA, 1);

      // Conversation A: oldest 2 should be deleted
      expect(await store.load('cp-a-0')).toBeNull();
      expect(await store.load('cp-a-1')).toBeNull();
      expect(await store.load('cp-a-2')).toBeDefined();

      // Conversation B: all 3 should remain
      expect(await store.load('cp-b-0')).toBeDefined();
      expect(await store.load('cp-b-1')).toBeDefined();
      expect(await store.load('cp-b-2')).toBeDefined();
    });
  });
});
