// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresSkillStore } from './postgres-store.ts';
import { createPostgresProvider } from '../persistence/postgres.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let store: ReturnType<typeof createPostgresSkillStore>;
let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE skill_embeddings CASCADE');
}

// Create deterministic test embeddings
function createTestEmbedding(seed: number): Array<number> {
  return Array.from({ length: 768 }, (_, i) => {
    const val = Math.sin(seed + i) * 0.5 + 0.5;
    return Number.isFinite(val) ? val : 0.5;
  });
}

describe('PostgreSQL Skill Store', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    store = createPostgresSkillStore(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('skills.AC2.1: upsertEmbedding inserts a new skill embedding record', () => {
    it('should insert a new skill embedding with all fields', async () => {
      const id = 'skill:builtin:test-skill-1';
      const name = 'Test Skill 1';
      const description = 'A test skill for insertion';
      const contentHash = 'abc123def456';
      const embedding = createTestEmbedding(1);

      await store.upsertEmbedding(id, name, description, contentHash, embedding);

      // Verify the row exists by querying directly
      const rows = await persistence.query<{
        id: string;
        name: string;
        description: string;
        content_hash: string;
      }>(
        'SELECT id, name, description, content_hash FROM skill_embeddings WHERE id = $1',
        [id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(id);
      expect(rows[0]?.name).toBe(name);
      expect(rows[0]?.description).toBe(description);
      expect(rows[0]?.content_hash).toBe(contentHash);
    });
  });

  describe('skills.AC2.2: upsertEmbedding updates an existing skill embedding', () => {
    it('should update an existing embedding when called with same ID', async () => {
      const id = 'skill:builtin:test-skill-2';
      const embedding = createTestEmbedding(2);

      // First upsert
      await store.upsertEmbedding(
        id,
        'Original Name',
        'Original description',
        'hash1',
        embedding,
      );

      // Second upsert with different values
      await store.upsertEmbedding(
        id,
        'Updated Name',
        'Updated description',
        'hash2',
        embedding,
      );

      // Verify only one row exists with updated values
      const rows = await persistence.query<{
        id: string;
        name: string;
        description: string;
        content_hash: string;
      }>(
        'SELECT id, name, description, content_hash FROM skill_embeddings WHERE id = $1',
        [id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('Updated Name');
      expect(rows[0]?.description).toBe('Updated description');
      expect(rows[0]?.content_hash).toBe('hash2');
    });
  });

  describe('skills.AC2.3: getByHash returns the stored content hash', () => {
    it('should return the correct content_hash for a known skill ID', async () => {
      const id = 'skill:builtin:test-skill-3';
      const contentHash = 'specific-hash-value-123';
      const embedding = createTestEmbedding(3);

      await store.upsertEmbedding(
        id,
        'Test Skill',
        'Test description',
        contentHash,
        embedding,
      );

      const result = await store.getByHash(id);

      expect(result).toBe(contentHash);
    });
  });

  describe('skills.AC2.4: getByHash returns null for unknown skill ID', () => {
    it('should return null when skill ID does not exist', async () => {
      const result = await store.getByHash('skill:builtin:nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('skills.AC2.5: searchByEmbedding returns skills ranked by similarity', () => {
    it('should return skills ordered by cosine similarity, highest first', async () => {
      // Create 3 skills with different embeddings
      const embedding1 = createTestEmbedding(10);
      const embedding2 = createTestEmbedding(20);
      const embedding3 = createTestEmbedding(30);

      await store.upsertEmbedding(
        'skill:builtin:skill-1',
        'Skill 1',
        'Description 1',
        'hash1',
        embedding1,
      );

      await store.upsertEmbedding(
        'skill:builtin:skill-2',
        'Skill 2',
        'Description 2',
        'hash2',
        embedding2,
      );

      await store.upsertEmbedding(
        'skill:builtin:skill-3',
        'Skill 3',
        'Description 3',
        'hash3',
        embedding3,
      );

      // Search with a query vector closest to skill #1
      const results = await store.searchByEmbedding(embedding1, 3, 0);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe('skill:builtin:skill-1');
      // Verify results are ordered by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    });
  });

  describe('skills.AC2.6: searchByEmbedding filters results below threshold', () => {
    it('should exclude results that fall below the similarity threshold', async () => {
      const embedding1 = createTestEmbedding(40);
      const embedding2 = createTestEmbedding(50);
      const embedding3 = createTestEmbedding(60);

      await store.upsertEmbedding(
        'skill:builtin:skill-a',
        'Skill A',
        'Description A',
        'hash-a',
        embedding1,
      );

      await store.upsertEmbedding(
        'skill:builtin:skill-b',
        'Skill B',
        'Description B',
        'hash-b',
        embedding2,
      );

      await store.upsertEmbedding(
        'skill:builtin:skill-c',
        'Skill C',
        'Description C',
        'hash-c',
        embedding3,
      );

      // Search with a very high threshold (0.99) to exclude most results
      const results = await store.searchByEmbedding(embedding1, 10, 0.99);

      // All scores should be >= 0.99
      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(0.99);
      });
    });
  });

  describe('skills.AC2.7: deleteEmbedding removes a skill embedding record', () => {
    it('should delete a skill embedding and getByHash should return null', async () => {
      const id = 'skill:builtin:test-skill-delete';
      const embedding = createTestEmbedding(70);

      // Insert
      await store.upsertEmbedding(id, 'Delete Test', 'To be deleted', 'hash-del', embedding);

      // Verify it exists
      let result = await store.getByHash(id);
      expect(result).toBe('hash-del');

      // Delete
      await store.deleteEmbedding(id);

      // Verify it's gone
      result = await store.getByHash(id);
      expect(result).toBeNull();
    });
  });

  describe('skills.AC2.8: searchByEmbedding respects the limit parameter', () => {
    it('should return exactly the specified number of results when limit is provided', async () => {
      // Create 5 skills
      for (let i = 1; i <= 5; i++) {
        const embedding = createTestEmbedding(100 + i);
        await store.upsertEmbedding(
          `skill:builtin:skill-${i}`,
          `Skill ${i}`,
          `Description ${i}`,
          `hash-${i}`,
          embedding,
        );
      }

      // Search with limit 2
      const results = await store.searchByEmbedding(createTestEmbedding(101), 2, 0);

      expect(results).toHaveLength(2);
    });

    it('should return fewer results if fewer are available after filtering', async () => {
      // Create 3 skills
      for (let i = 1; i <= 3; i++) {
        const embedding = createTestEmbedding(200 + i);
        await store.upsertEmbedding(
          `skill:builtin:skill-limit-${i}`,
          `Skill ${i}`,
          `Description ${i}`,
          `hash-limit-${i}`,
          embedding,
        );
      }

      // Search with very high threshold and high limit — threshold should reduce count
      const results = await store.searchByEmbedding(createTestEmbedding(201), 10, 0.99);

      // Results should be <= 3 (total available)
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });
});
