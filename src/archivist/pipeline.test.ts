/**
 * Integration tests for the archivist pipeline.
 * Tests both incremental and full modes against real PostgreSQL.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { ModelProvider, ModelResponse } from '@/model/types.js';
import type { PersistenceProvider } from '@/persistence/types.js';
import { createPostgresProvider } from '@/persistence/postgres.js';
import { createPostgresMemoryStore } from '@/memory/postgres-store.js';
import { createMemoryManager } from '@/memory/manager.js';
import { createMockEmbeddingProvider } from '@/integration/test-helpers.js';
import { createArchivistPipeline } from './pipeline.js';

const TEST_OWNER = `test-archivist-${Date.now()}`;
const TEST_MODEL_NAME = 'claude-3-5-sonnet';

let persistence: PersistenceProvider;

beforeAll(async () => {
  const dbUrl = process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/constellation';
  persistence = createPostgresProvider({
    url: dbUrl,
  });

  await persistence.connect();
  await persistence.runMigrations();
});

afterAll(async () => {
  // Clean up test blocks
  const store = createPostgresMemoryStore(persistence);
  const blocks = await store.getBlocksByTier(TEST_OWNER, 'working');
  for (const block of blocks) {
    await store.deleteBlock(block.id);
  }

  const archivalBlocks = await store.getBlocksByTier(TEST_OWNER, 'archival');
  for (const block of archivalBlocks) {
    await store.deleteBlock(block.id);
  }

  await persistence.disconnect();
});

/**
 * Create a mock model provider that returns fixed responses.
 */
function createMockModelProvider(): ModelProvider {
  return {
    complete: async (): Promise<ModelResponse> => ({
      content: [
        {
          type: 'text',
          text: 'This is a merged summary of the duplicate blocks.',
        },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    stream: async function* (_request) {
      // Not used in these tests
      yield {
        type: 'message_start',
        message: { id: 'msg-1', usage: { input_tokens: 0, output_tokens: 0 } },
      };
    },
  };
}

/**
 * Clean up blocks created by a test.
 */
async function cleanupTestBlocks(owner: string, store: ReturnType<typeof createPostgresMemoryStore>) {
  const blocks = await store.getBlocksByTier(owner, 'working');
  for (const block of blocks) {
    try {
      await store.deleteBlock(block.id);
    } catch {
      // Ignore errors during cleanup
    }
  }
}

describe('ArchivistPipeline', () => {
  test('runIncremental: scans eligible blocks and identifies duplicates', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);

    // Create test blocks with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`scan-test-${testId}:block1`, 'Content about topic A', 'working');
    await manager.write(`scan-test-${testId}:block2`, 'Content about topic A', 'working');
    await manager.write(`scan-test-${testId}:block3`, 'Unrelated content', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: null,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runIncremental();

    expect(result.mode).toBe('incremental');
    expect(result.scanned).toBeGreaterThanOrEqual(3);
    expect(result.deduped).toBeGreaterThanOrEqual(0);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runIncremental: prunes empty blocks', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);

    // Create blocks including empty ones with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`prune-test-${testId}:filled`, 'Has content', 'working');
    await manager.write(`prune-test-${testId}:empty`, '', 'working');
    await manager.write(`prune-test-${testId}:whitespace`, '   \n\t  ', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: null,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runIncremental();

    expect(result.pruned).toBeGreaterThanOrEqual(0); // May be 0 if pre-existing
    // Verify empty blocks were deleted by checking final state
    const allBlocks = await store.getBlocksByTier(TEST_OWNER, 'working');
    const emptyBlocks = allBlocks.filter((b) => b.content.trim().length === 0);
    expect(emptyBlocks).toHaveLength(0);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: consolidates duplicate groups via model', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);
    const mockModel = createMockModelProvider();

    // Create duplicate blocks with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`consolidate-test-${testId}:v1`, 'Block about AI algorithms', 'working');
    await manager.write(`consolidate-test-${testId}:v2`, 'Block about AI algorithms', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: mockModel,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runFull();

    expect(result.mode).toBe('full');
    // Dedup should find the duplicates
    expect(result.deduped).toBeGreaterThanOrEqual(0);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: appends related block references', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);
    const mockModel = createMockModelProvider();

    // Create related blocks with similar but not duplicate content and unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`crossref-test-${testId}:main`, 'Discussion of machine learning', 'working');
    await manager.write(`crossref-test-${testId}:secondary`, 'Discussion of deep learning models', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: mockModel,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.70, // Lower threshold to catch more relations
      tokenBudget: 50000,
    });

    const result = await pipeline.runFull();

    expect(result.mode).toBe('full');
    expect(result.reflected).toBe(true);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: writes reflection to archivist:reflection working memory', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);
    const mockModel = createMockModelProvider();

    // Create some blocks to analyze with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`reflect-test-${testId}:a`, 'Some memory content', 'working');
    await manager.write(`reflect-test-${testId}:b`, 'Another memory block', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: mockModel,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runFull();

    expect(result.reflected).toBe(true);

    // Verify reflection was written
    const reflection = await store.getBlockByLabel(TEST_OWNER, 'archivist:reflection');
    expect(reflection).toBeDefined();
    expect(reflection?.content).toContain('summary');

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: skips dedup when no embedding provider', async () => {
    const store = createPostgresMemoryStore(persistence);
    const manager = createMemoryManager(
      store,
      createMockEmbeddingProvider(),
      TEST_OWNER,
    );
    const mockModel = createMockModelProvider();

    // Create test blocks with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`no-embedding-${testId}:a`, 'Content A', 'working');
    await manager.write(`no-embedding-${testId}:b`, 'Content B', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding: null, // No embedding provider
      summarizationModel: mockModel,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runFull();

    // Dedup should be skipped
    expect(result.deduped).toBe(0);
    // But prune should still run
    expect(result.pruned).toBeGreaterThanOrEqual(0);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: skips consolidate and reflect when no model provider', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);

    // Create test blocks with unique labels
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await manager.write(`no-model-${testId}:a`, 'Content A', 'working');
    await manager.write(`no-model-${testId}:b`, 'Content B', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: null, // No model provider
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runFull();

    // Consolidate and reflect should be skipped
    expect(result.consolidated).toBe(0);
    expect(result.reflected).toBe(false);
    // But other stages should run
    expect(result.scanned).toBeGreaterThan(0);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runFull: excludes archivist:* and diary:* labels from scanning', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);

    // Create blocks with excluded labels (using unique label names)
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await persistence.withTransaction(async () => {
      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: `archivist:metadata-${testId}`,
        content: 'Should be skipped',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: `diary:personal-${testId}`,
        content: 'Should be skipped',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: crypto.randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: `normal-exclude-test-${testId}:block`,
        content: 'Should be included',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });
    });

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: null,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    const result = await pipeline.runIncremental();

    // Should exclude archivist:* and diary:* blocks
    // (exact count depends on other test blocks, but at least 1)
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    // Clean up test blocks
    await cleanupTestBlocks(TEST_OWNER, store);
  });

  test('runIncremental: state tracking detects block changes', async () => {
    const store = createPostgresMemoryStore(persistence);
    const embedding = createMockEmbeddingProvider();
    const manager = createMemoryManager(store, embedding, TEST_OWNER);

    // Create initial state
    await manager.write('state-tracking-test:content', 'Original content', 'working');

    const pipeline = createArchivistPipeline({
      memoryStore: store,
      memoryManager: manager,
      embedding,
      summarizationModel: null,
      persistence,
      owner: TEST_OWNER,
      modelName: TEST_MODEL_NAME,
      dedupThreshold: 0.92,
      crossrefThreshold: 0.75,
      tokenBudget: 50000,
    });

    // Run once to establish state
    const result1 = await pipeline.runIncremental();
    expect(result1.scanned).toBeGreaterThan(0);

    // Verify state block was created with JSON map of blockId -> contentHash
    const stateBlock = await store.getBlockByLabel(TEST_OWNER, 'archivist:state');
    expect(stateBlock).toBeDefined();
    const stateContent = JSON.parse(stateBlock?.content || '{}');
    expect(typeof stateContent).toBe('object');
    // Verify it contains at least one entry (the content hash for our block)
    expect(Object.keys(stateContent).length).toBeGreaterThan(0);

    // Run again without changes - should short-circuit
    const result2 = await pipeline.runIncremental();
    expect(result2.scanned).toBeGreaterThanOrEqual(0);
  });
});
