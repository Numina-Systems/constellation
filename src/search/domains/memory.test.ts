// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPostgresProvider } from '../../persistence/postgres.ts';
import { createMemorySearchDomain } from './memory.ts';
import { createMockEmbeddingProvider } from '../../integration/test-helpers.ts';

const TEST_OWNER = 'test-search-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

describe('Memory Search Domain', () => {
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

  describe('GH-23.AC1.1: Hybrid mode returns both keyword and vector matches', () => {
    it('returns blocks matching both keyword query and semantic embedding', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      // Insert a block with exact keyword match
      const blockWithKeyword = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'keyword-match',
        content: 'This is about machine learning algorithms',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Insert a block with similar embedding but different keywords
      const queryEmbedding = await mockEmbedding.embed('machine learning');
      const blockWithEmbedding = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'semantic-match',
        content: 'AI models and neural networks for deep learning',
        embedding: queryEmbedding,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Insert both blocks
      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          blockWithKeyword.id,
          blockWithKeyword.owner,
          blockWithKeyword.tier,
          blockWithKeyword.label,
          blockWithKeyword.content,
          blockWithKeyword.embedding,
          blockWithKeyword.permission,
          blockWithKeyword.pinned,
        ],
      );

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)`,
        [
          blockWithEmbedding.id,
          blockWithEmbedding.owner,
          blockWithEmbedding.tier,
          blockWithEmbedding.label,
          blockWithEmbedding.content,
          JSON.stringify(blockWithEmbedding.embedding),
          blockWithEmbedding.permission,
          blockWithEmbedding.pinned,
        ],
      );

      const embedding = await mockEmbedding.embed('machine learning');
      const results = await domain.search({
        query: 'machine learning',
        mode: 'hybrid',
        domains: ['memory'],
        embedding: embedding,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === blockWithKeyword.id)).toBe(true);
      expect(results[0]?.domain).toBe('memory');
    });
  });

  describe('GH-23.AC1.2: Keyword mode without embedding', () => {
    it('returns only keyword matches without needing embedding', async () => {
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      // Insert blocks
      const block1 = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'test-block-1',
        content: 'This content contains the word database',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      const block2 = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'test-block-2',
        content: 'This is unrelated content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          block1.id,
          block1.owner,
          block1.tier,
          block1.label,
          block1.content,
          block1.embedding,
          block1.permission,
          block1.pinned,
        ],
      );

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          block2.id,
          block2.owner,
          block2.tier,
          block2.label,
          block2.content,
          block2.embedding,
          block2.permission,
          block2.pinned,
        ],
      );

      const results = await domain.search({
        query: 'database',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(block1.id);
      expect(results[0]?.content).toContain('database');
    });
  });

  describe('GH-23.AC1.3: Semantic mode returns vector similarity matches', () => {
    it('returns blocks by embedding similarity without text matching', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      // Block with similar embedding but no keyword match
      const queryEmbedding = await mockEmbedding.embed('neural networks');
      const block1 = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'semantic-block',
        content: 'Deep learning frameworks and AI systems',
        embedding: queryEmbedding,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Block without embedding (should not be returned)
      const block2 = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'no-embedding',
        content: 'neural networks everywhere in the world',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)`,
        [
          block1.id,
          block1.owner,
          block1.tier,
          block1.label,
          block1.content,
          JSON.stringify(block1.embedding),
          block1.permission,
          block1.pinned,
        ],
      );

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          block2.id,
          block2.owner,
          block2.tier,
          block2.label,
          block2.content,
          block2.embedding,
          block2.permission,
          block2.pinned,
        ],
      );

      const embedding = await mockEmbedding.embed('neural networks');
      const results = await domain.search({
        query: 'something unrelated',
        mode: 'semantic',
        domains: ['memory'],
        embedding: embedding,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Only block with embedding should be returned
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === block1.id)).toBe(true);
      expect(results.every((r) => r.id !== block2.id)).toBe(true);
    });
  });

  describe('GH-23.AC1.4: Tier filter respects tier parameter', () => {
    it('returns only blocks matching the specified tier', async () => {
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      // Insert blocks in different tiers
      const coreBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core-block',
        content: 'core memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: true,
      };

      const workingBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'working-block',
        content: 'working memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      const archivalBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'archival',
        label: 'archival-block',
        content: 'archival memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      for (const block of [coreBlock, workingBlock, archivalBlock]) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            block.id,
            block.owner,
            block.tier,
            block.label,
            block.content,
            block.embedding,
            block.permission,
            block.pinned,
          ],
        );
      }

      const results = await domain.search({
        query: 'memory',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: 'working',
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(workingBlock.id);
      expect(results[0]?.metadata.tier).toBe('working');
    });
  });

  describe('GH-23.AC4.1: Start time filter excludes earlier blocks', () => {
    it('excludes blocks created before startTime', async () => {
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Block created in the past
      const oldBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'old-block',
        content: 'old memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: oneHourAgo,
      };

      // Block created now
      const newBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'new-block',
        content: 'new memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: now,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          oldBlock.id,
          oldBlock.owner,
          oldBlock.tier,
          oldBlock.label,
          oldBlock.content,
          oldBlock.embedding,
          oldBlock.permission,
          oldBlock.pinned,
          oldBlock.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newBlock.id,
          newBlock.owner,
          newBlock.tier,
          newBlock.label,
          newBlock.content,
          newBlock.embedding,
          newBlock.permission,
          newBlock.pinned,
          newBlock.created_at.toISOString(),
        ],
      );

      const results = await domain.search({
        query: 'memory',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: now,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(newBlock.id);
    });
  });

  describe('GH-23.AC4.2: End time filter excludes later blocks', () => {
    it('excludes blocks created after endTime', async () => {
      const domain = createMemorySearchDomain(persistence, TEST_OWNER);

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      // Block created in the past
      const oldBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'old-block',
        content: 'old memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: oneHourAgo,
      };

      // Block created in the future
      const futureBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'future-block',
        content: 'future memory content',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: oneHourLater,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          oldBlock.id,
          oldBlock.owner,
          oldBlock.tier,
          oldBlock.label,
          oldBlock.content,
          oldBlock.embedding,
          oldBlock.permission,
          oldBlock.pinned,
          oldBlock.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          futureBlock.id,
          futureBlock.owner,
          futureBlock.tier,
          futureBlock.label,
          futureBlock.content,
          futureBlock.embedding,
          futureBlock.permission,
          futureBlock.pinned,
          futureBlock.created_at.toISOString(),
        ],
      );

      const results = await domain.search({
        query: 'memory',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: now,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(oldBlock.id);
    });
  });
});
