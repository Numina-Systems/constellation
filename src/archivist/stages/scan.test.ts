import { describe, test, expect } from 'bun:test';
import type { MemoryBlock, MemoryTier } from '@/memory/types.js';
import { isEligible, toSnapshot, scan } from './scan.js';
import type { MemoryStore } from '@/memory/store.js';

const createMockBlock = (
  overrides?: Partial<MemoryBlock>,
): MemoryBlock => ({
  id: 'test-id',
  owner: 'test-owner',
  tier: 'working' as MemoryTier,
  label: 'test:label',
  content: 'test content',
  embedding: [0.1, 0.2, 0.3],
  permission: 'readwrite' as const,
  pinned: false,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

describe('scan stage', () => {
  describe('isEligible', () => {
    test('includes readwrite, non-pinned blocks without excluded labels', () => {
      const block = createMockBlock({
        permission: 'readwrite',
        pinned: false,
        label: 'user:thoughts',
      });

      expect(isEligible(block)).toBe(true);
    });

    test('excludes readonly permission blocks', () => {
      const block = createMockBlock({
        permission: 'readonly',
      });

      expect(isEligible(block)).toBe(false);
    });

    test('excludes familiar permission blocks', () => {
      const block = createMockBlock({
        permission: 'familiar',
      });

      expect(isEligible(block)).toBe(false);
    });

    test('excludes append permission blocks', () => {
      const block = createMockBlock({
        permission: 'append',
      });

      expect(isEligible(block)).toBe(false);
    });

    test('excludes pinned blocks', () => {
      const block = createMockBlock({
        permission: 'readwrite',
        pinned: true,
      });

      expect(isEligible(block)).toBe(false);
    });

    test('excludes blocks with archivist: label prefix', () => {
      const block = createMockBlock({
        label: 'archivist:state',
      });

      expect(isEligible(block)).toBe(false);
    });

    test('excludes blocks with diary: label prefix', () => {
      const block = createMockBlock({
        label: 'diary:2026-05-17',
      });

      expect(isEligible(block)).toBe(false);
    });

    test('only excludes exact prefixes', () => {
      const block = createMockBlock({
        label: 'archived-notes',
      });

      expect(isEligible(block)).toBe(true);
    });
  });

  describe('toSnapshot', () => {
    test('preserves block id, label, tier, content, and embedding', () => {
      const block = createMockBlock({
        id: 'block-123',
        label: 'test:label',
        tier: 'working',
        content: 'important content',
        embedding: [0.1, 0.2, 0.3],
      });

      const snapshot = toSnapshot(block);

      expect(snapshot.id).toBe('block-123');
      expect(snapshot.label).toBe('test:label');
      expect(snapshot.tier).toBe('working');
      expect(snapshot.content).toBe('important content');
      expect(snapshot.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    test('computes deterministic content hash', () => {
      const block = createMockBlock({
        content: 'test content',
      });

      const snapshot1 = toSnapshot(block);
      const snapshot2 = toSnapshot({...block});

      expect(snapshot1.contentHash).toBe(snapshot2.contentHash);
    });

    test('produces different hash for different content', () => {
      const block1 = createMockBlock({
        content: 'content A',
      });
      const block2 = createMockBlock({
        content: 'content B',
      });

      const snapshot1 = toSnapshot(block1);
      const snapshot2 = toSnapshot(block2);

      expect(snapshot1.contentHash).not.toBe(snapshot2.contentHash);
    });

    test('handles null embedding', () => {
      const block = createMockBlock({
        embedding: null,
      });

      const snapshot = toSnapshot(block);

      expect(snapshot.embedding).toBeNull();
    });

    test('contentHash is 16 characters', () => {
      const block = createMockBlock({
        content: 'some content',
      });

      const snapshot = toSnapshot(block);

      expect(snapshot.contentHash.length).toBe(16);
    });
  });

  describe('scan', () => {
    test('returns blocks from both working and archival tiers', async () => {
      const workingBlock = createMockBlock({
        id: 'working-1',
        tier: 'working',
      });
      const archivalBlock = createMockBlock({
        id: 'archival-1',
        tier: 'archival',
      });

      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner: string, tier) => {
          if (tier === 'working') {
            return [workingBlock];
          }
          if (tier === 'archival') {
            return [archivalBlock];
          }
          return [];
        },
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks.map(b => b.id)).toEqual(['working-1', 'archival-1']);
    });

    test('filters to only readwrite permission blocks', async () => {
      const readwriteBlock = createMockBlock({
        id: 'readwrite-1',
        permission: 'readwrite',
      });
      const readonlyBlock = createMockBlock({
        id: 'readonly-1',
        permission: 'readonly',
      });

      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner, tier) => {
          if (tier === 'working') {
            return [readwriteBlock, readonlyBlock];
          }
          return [];
        },
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.id).toBe('readwrite-1');
    });

    test('excludes pinned blocks', async () => {
      const unpinnedBlock = createMockBlock({
        id: 'unpinned-1',
        pinned: false,
      });
      const pinnedBlock = createMockBlock({
        id: 'pinned-1',
        pinned: true,
      });

      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner, tier) => {
          if (tier === 'working') {
            return [unpinnedBlock, pinnedBlock];
          }
          return [];
        },
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.id).toBe('unpinned-1');
    });

    test('excludes blocks with archivist: and diary: labels', async () => {
      const userBlock = createMockBlock({
        id: 'user-1',
        label: 'user:thoughts',
      });
      const archivistBlock = createMockBlock({
        id: 'archivist-1',
        label: 'archivist:state',
      });
      const diaryBlock = createMockBlock({
        id: 'diary-1',
        label: 'diary:2026-05-17',
      });

      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner, tier) => {
          if (tier === 'working') {
            return [userBlock, archivistBlock, diaryBlock];
          }
          return [];
        },
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.id).toBe('user-1');
    });

    test('includes all eligible blocks together', async () => {
      const eligible1 = createMockBlock({
        id: 'eligible-1',
        permission: 'readwrite',
        pinned: false,
        label: 'notes:general',
      });
      const eligible2 = createMockBlock({
        id: 'eligible-2',
        permission: 'readwrite',
        pinned: false,
        label: 'notes:specific',
      });

      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner, tier) => {
          if (tier === 'working') {
            return [eligible1];
          }
          if (tier === 'archival') {
            return [eligible2];
          }
          return [];
        },
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toHaveLength(2);
      expect(result.blocks.map(b => b.id).sort()).toEqual([
        'eligible-1',
        'eligible-2',
      ]);
    });

    test('returns ScanResult with scannedAt timestamp', async () => {
      const block = createMockBlock();
      const mockStore: MemoryStore = {
        getBlocksByTier: async () => [block],
      } as MemoryStore;

      const beforeScan = new Date();
      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });
      const afterScan = new Date();

      expect(result.scannedAt.getTime()).toBeGreaterThanOrEqual(
        beforeScan.getTime(),
      );
      expect(result.scannedAt.getTime()).toBeLessThanOrEqual(afterScan.getTime());
    });

    test('returns empty blocks when no blocks eligible', async () => {
      const mockStore: MemoryStore = {
        getBlocksByTier: async () => [],
      } as MemoryStore;

      const result = await scan({
        memoryStore: mockStore,
        owner: 'test-owner',
      });

      expect(result.blocks).toEqual([]);
    });

    test('passes owner to memoryStore.getBlocksByTier', async () => {
      let capturedOwner = '';
      const mockStore: MemoryStore = {
        getBlocksByTier: async (owner) => {
          capturedOwner = owner;
          return [];
        },
      } as MemoryStore;

      await scan({
        memoryStore: mockStore,
        owner: 'specific-owner',
      });

      expect(capturedOwner).toBe('specific-owner');
    });
  });
});
