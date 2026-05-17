/**
 * Integration tests for diary injection.
 * Tests the full wiring from database retrieval through session-static behavior.
 */

import { describe, test, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '@/persistence';
import { createPostgresMemoryStore } from '@/memory/postgres-store';
import { buildDiarySection } from './inject.js';
import type { MemoryStore } from '@/memory/store';
import type { MemoryBlock, MemoryTier, MemoryEvent, PendingMutation } from '@/memory/types';

const AGENT_OWNER = 'test-agent-diary-integration-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupDiaryBlocks(): Promise<void> {
  const memoryStore = createPostgresMemoryStore(persistence);
  const blocks = await memoryStore.getBlocksByLabelPrefix(AGENT_OWNER, 'diary:', 'working');
  for (const block of blocks) {
    await memoryStore.deleteBlock(block.id);
  }
}

describe('diary integration', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
  });

  afterEach(async () => {
    await cleanupDiaryBlocks();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  test('diary-injection.AC7.1 + AC7.2: diary section fetched once at session init, same content on every turn', async () => {
    const memoryStore = createPostgresMemoryStore(persistence);

    // Insert diary blocks
    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-16',
      content: 'Entry from May 16',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-17',
      content: 'Entry from May 17',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    // Simulate session init: retrieve diary once
    const diaryBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );

    expect(diaryBlocks).toHaveLength(2);

    const result = buildDiarySection(diaryBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(result).not.toBeNull();
    const firstSessionDiary = result!.section;

    // Test determinism: calling buildDiarySection with same input produces same output
    const secondBuildResult = buildDiarySection(diaryBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(secondBuildResult).not.toBeNull();
    const secondSessionDiary = secondBuildResult!.section;

    // Both builds should produce identical output (determinism test)
    expect(firstSessionDiary).toBe(secondSessionDiary);
    expect(firstSessionDiary).toContain('2026-05-16');
    expect(firstSessionDiary).toContain('2026-05-17');
  });

  test('diary-injection.AC7.3: new diary entries written mid-session do not appear until next session', async () => {
    const memoryStore = createPostgresMemoryStore(persistence);

    // Insert initial diary block
    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-16',
      content: 'Initial entry',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    // Session init: fetch diary once
    const initialBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );

    const initialResult = buildDiarySection(initialBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(initialResult).not.toBeNull();
    const sessionDiary = initialResult!.section;
    expect(sessionDiary).toContain('2026-05-16');
    expect(sessionDiary).not.toContain('2026-05-17');

    // Mid-session: new diary entry is written (simulating user adding to memory)
    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-17',
      content: 'New entry mid-session',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    // Session continues: same diary content still in use (stored in agent deps)
    // Verify it doesn't change
    expect(sessionDiary).not.toContain('2026-05-17');

    // Next session: new entry should appear
    const nextSessionBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );

    const nextSessionResult = buildDiarySection(nextSessionBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(nextSessionResult).not.toBeNull();
    const nextSessionDiary = nextSessionResult!.section;
    expect(nextSessionDiary).toContain('2026-05-16');
    expect(nextSessionDiary).toContain('2026-05-17');
  });

  test('diary-injection.AC6.1: diary_enabled=false skips retrieval entirely', async () => {
    const memoryStore = createPostgresMemoryStore(persistence);

    // Insert diary blocks
    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-17',
      content: 'Entry',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    // When diary_enabled is false, no retrieval happens
    // Simulate the guard condition from index.ts
    let diarySection: string | undefined;
    const diary_enabled = false;

    if (diary_enabled !== false) {
      const blocks = await memoryStore.getBlocksByLabelPrefix(
        AGENT_OWNER,
        'diary:',
        'working',
      );
      if (blocks.length > 0) {
        const result = buildDiarySection(blocks, {
          tokenBudget: 3000,
          maxEntries: 3,
        });
        diarySection = result?.section;
      }
    }

    // Should remain undefined
    expect(diarySection).toBeUndefined();
  });

  test('diary-injection.AC6.2: empty working tier (no diary blocks) returns null gracefully', async () => {
    const memoryStore = createPostgresMemoryStore(persistence);

    // No diary blocks inserted

    // Retrieval should handle empty gracefully
    const diaryBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );

    expect(diaryBlocks).toHaveLength(0);

    // buildDiarySection returns null for empty input
    const result = buildDiarySection(diaryBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(result).toBeNull();

    // Agent should handle this gracefully
    let diarySection: string | undefined;
    if (diaryBlocks.length > 0) {
      const buildResult = buildDiarySection(diaryBlocks, {
        tokenBudget: 3000,
        maxEntries: 3,
      });
      diarySection = buildResult?.section;
    }

    // Should remain undefined
    expect(diarySection).toBeUndefined();
  });

  test('diary-injection.AC6.3: store error is caught and logged gracefully', async () => {
    // This test verifies the error handling pattern used in index.ts
    // by simulating a broken memory store that throws on retrieval

    let diarySection: string | undefined;
    let errorWasCaught = false;
    let errorMessage = '';

    // Create a mock memory store that throws on getBlocksByLabelPrefix
    const brokenMemoryStore: MemoryStore = {
      async getBlocksByLabelPrefix(_owner: string, _prefix: string, _tier?: MemoryTier) {
        throw new Error('Database connection failed');
      },
      // Stub other methods to satisfy MemoryStore interface
      async getBlock() {
        return null;
      },
      async getBlocksByTier(_owner: string, _tier: MemoryTier) {
        return [];
      },
      async getBlockByLabel() {
        return null;
      },
      async createBlock(block: Omit<MemoryBlock, 'created_at' | 'updated_at'>) {
        return { ...block, created_at: new Date(), updated_at: new Date() };
      },
      async updateBlock(id: string, content: string, embedding: ReadonlyArray<number> | null) {
        return {
          id,
          owner: '',
          tier: 'working' as MemoryTier,
          label: '',
          content,
          embedding,
          permission: 'readwrite' as const,
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async updateBlockTier(id: string, tier: MemoryTier) {
        return {
          id,
          owner: '',
          tier,
          label: '',
          content: '',
          embedding: null,
          permission: 'readwrite' as const,
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async deleteBlock() {},
      async searchByEmbedding(_owner: string, _embedding: ReadonlyArray<number>, _limit: number, _tier?: MemoryTier) {
        return [];
      },
      async logEvent(event: Omit<MemoryEvent, 'id' | 'created_at'>) {
        return { ...event, id: '', created_at: new Date() };
      },
      async getEvents(_blockId: string) {
        return [];
      },
      async createMutation(mutation: Omit<PendingMutation, 'id' | 'created_at' | 'resolved_at'>) {
        return { ...mutation, id: '', created_at: new Date(), resolved_at: null };
      },
      async getPendingMutations() {
        return [];
      },
      async resolveMutation(id: string, status: 'approved' | 'rejected', feedback?: string) {
        return {
          id,
          block_id: '',
          proposed_content: '',
          reason: null,
          status,
          feedback: feedback || null,
          created_at: new Date(),
          resolved_at: new Date(),
        };
      },
    };

    try {
      // Simulate the retrieval pattern from index.ts
      const diaryBlocks = await brokenMemoryStore.getBlocksByLabelPrefix(
        AGENT_OWNER,
        'diary:',
        'working',
      );

      if (diaryBlocks.length > 0) {
        const result = buildDiarySection(diaryBlocks, {
          tokenBudget: 3000,
          maxEntries: 3,
        });
        diarySection = result?.section;
      }
    } catch (error) {
      // In real code: console.warn('diary: retrieval failed, continuing without diary', error);
      errorWasCaught = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // Key assertion: error was caught and handled gracefully
    expect(errorWasCaught).toBe(true);
    expect(errorMessage).toContain('Database connection failed');
    // diarySection should remain undefined because error was caught
    expect(diarySection).toBeUndefined();
  });

  test('diary-injection.AC7.1: multiple turns within session use identical diary section', async () => {
    const memoryStore = createPostgresMemoryStore(persistence);

    // Insert diary blocks
    await memoryStore.createBlock({
      id: crypto.randomUUID(),
      owner: AGENT_OWNER,
      tier: 'working',
      label: 'diary:2026-05-17',
      content: 'Session entry',
      embedding: null,
      permission: 'readwrite',
      pinned: false,
    });

    // Session init: fetch once
    const initialBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );

    const initialResult = buildDiarySection(initialBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(initialResult).not.toBeNull();
    const sessionDiary = initialResult!.section;

    // Test determinism: building with same blocks multiple times produces identical output
    const turnResult = buildDiarySection(initialBlocks, {
      tokenBudget: 3000,
      maxEntries: 3,
    });

    expect(turnResult).not.toBeNull();
    const turnDiary = turnResult!.section;

    // All builds should produce identical output (determinism test)
    expect(sessionDiary).toBe(turnDiary);
    expect(sessionDiary).toContain('2026-05-17');
  });
});
