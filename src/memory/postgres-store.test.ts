import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createPostgresMemoryStore } from './postgres-store.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let store: ReturnType<typeof createPostgresMemoryStore>;

async function cleanupMemoryBlocks(): Promise<void> {
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

describe('diary-injection.AC5: MemoryStore.getBlocksByLabelPrefix', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupMemoryBlocks();

    store = createPostgresMemoryStore(persistence);
  });

  afterEach(async () => {
    await cleanupMemoryBlocks();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('diary-injection.AC5.1: Success - returns matching diary blocks', () => {
    it('returns all diary-labelled working-tier blocks matching prefix', async () => {
      // Create test blocks
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-16',
        content: 'First diary entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17',
        content: 'Second diary entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with prefix
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Both blocks should be returned
      expect(results).toHaveLength(2);
      expect(results.map(b => b.id)).toContain('test-1');
      expect(results.map(b => b.id)).toContain('test-2');
    });
  });

  describe('diary-injection.AC5.2: Failure - excludes non-matching prefixes', () => {
    it('excludes blocks with similar but non-matching labels', async () => {
      // Create matching block
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17',
        content: 'Diary entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Create non-matching block (different prefix)
      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary-notes:foo',
        content: 'Not a diary entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with prefix
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Only the exact prefix match should be returned
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('test-1');
    });
  });

  describe('diary-injection.AC5.3: Failure - respects tier filtering', () => {
    it('excludes blocks from other tiers when tier filter is specified', async () => {
      // Create blocks in different tiers (with unique labels due to DB constraint)
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'core',
        label: 'diary:2026-05-17-core',
        content: 'Core entry',
        embedding: null,
        permission: 'readonly',
        pinned: true,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17-working',
        content: 'Working entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with tier filter
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Only the working-tier block should be returned
      expect(results).toHaveLength(1);
      expect(results[0]!.tier).toBe('working');
      expect(results[0]!.id).toBe('test-2');
    });
  });

  describe('diary-injection.AC5.4: Edge - no matching blocks returns empty array', () => {
    it('returns empty array when no blocks match prefix', async () => {
      // Query with prefix with no matches
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Should return empty array
      expect(results).toHaveLength(0);
    });

    it('returns empty array when querying non-existent owner', async () => {
      // Create blocks for different owner
      await store.createBlock({
        id: 'test-1',
        owner: 'other-agent',
        tier: 'working',
        label: 'diary:2026-05-17',
        content: 'Other entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with different owner
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Should return empty array
      expect(results).toHaveLength(0);
    });
  });

  describe('Additional: Label ordering', () => {
    it('returns results ordered by label ASC', async () => {
      // Create blocks in non-sorted order
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17',
        content: 'Entry 1',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-16',
        content: 'Entry 2',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-3',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17-evening',
        content: 'Entry 3',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Should be ordered lexicographically
      expect(results).toHaveLength(3);
      expect(results[0]!.label).toBe('diary:2026-05-16');
      expect(results[1]!.label).toBe('diary:2026-05-17');
      expect(results[2]!.label).toBe('diary:2026-05-17-evening');
    });
  });

  describe('Additional: Owner isolation', () => {
    it('returns only blocks for specified owner', async () => {
      // Create blocks for two owners
      await store.createBlock({
        id: 'test-1',
        owner: 'agent-a',
        tier: 'working',
        label: 'diary:2026-05-17-a',
        content: 'Agent A entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'agent-b',
        tier: 'working',
        label: 'diary:2026-05-17-b',
        content: 'Agent B entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query agent-a
      const resultsA = await store.getBlocksByLabelPrefix('agent-a', 'diary:', 'working');
      expect(resultsA).toHaveLength(1);
      expect(resultsA[0]!.owner).toBe('agent-a');

      // Query agent-b
      const resultsB = await store.getBlocksByLabelPrefix('agent-b', 'diary:', 'working');
      expect(resultsB).toHaveLength(1);
      expect(resultsB[0]!.owner).toBe('agent-b');
    });
  });

  describe('Additional: No tier filter returns all matching tiers', () => {
    it('returns matching blocks across all tiers when tier not specified', async () => {
      // Create blocks in different tiers (with unique labels due to DB constraint)
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'core',
        label: 'diary:2026-05-17-core',
        content: 'Core entry',
        embedding: null,
        permission: 'readonly',
        pinned: true,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17-working',
        content: 'Working entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-3',
        owner: 'test-agent',
        tier: 'archival',
        label: 'diary:2026-05-17-archival',
        content: 'Archival entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query without tier filter
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:');

      // All matching blocks across tiers should be returned
      expect(results).toHaveLength(3);
      const tiers = new Set(results.map(b => b.tier));
      expect(tiers).toEqual(new Set(['core', 'working', 'archival']));
    });
  });

  describe('Additional: Prefix escaping for SQL wildcards', () => {
    it('correctly matches labels with % and _ characters', async () => {
      // Create block with special characters in label
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:100%_done',
        content: 'Special label entry',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with prefix containing special characters
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:100%', 'working');

      // Should match and not treat % as wildcard
      expect(results).toHaveLength(1);
      expect(results[0]!.label).toBe('diary:100%_done');
    });

    it('does not match unescaped wildcards as literals', async () => {
      // Create blocks
      await store.createBlock({
        id: 'test-1',
        owner: 'test-agent',
        tier: 'working',
        label: 'diary:2026-05-17',
        content: 'Entry 1',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      await store.createBlock({
        id: 'test-2',
        owner: 'test-agent',
        tier: 'working',
        label: 'other:2026-05-17',
        content: 'Entry 2',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
      });

      // Query with prefix - should only match prefix, not use it as wildcard
      const results = await store.getBlocksByLabelPrefix('test-agent', 'diary:', 'working');

      // Should match only diary: prefix, not act as wildcard
      expect(results).toHaveLength(1);
      expect(results[0]!.label).toBe('diary:2026-05-17');
    });
  });
});
