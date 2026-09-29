import {describe, expect, it, mock} from 'bun:test';
import type {MemoryBlock} from '@/memory/types.js';
import type {MemoryStoreWithMaintenance} from '@/memory/store.js';
import type {MemoryManager} from '@/memory/manager.js';
import type {PersistenceProvider} from '@/persistence/types.js';
import {createArchivistPipeline} from './pipeline.js';

const OWNER = 'atomic-prune-test';

function block(id: string, content: string): MemoryBlock {
  return {
    id,
    owner: OWNER,
    tier: 'working',
    label: `block-${id}`,
    content,
    embedding: null,
    permission: 'readwrite',
    pinned: false,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
}

describe('Archivist prune transaction', () => {
  it('leaves the pre-prune state intact when a later delete fails', async () => {
    const blocks = new Map<string, MemoryBlock>([
      ['empty-a', block('empty-a', '')],
      ['empty-b', block('empty-b', '  ')],
    ]);
    let deleteAttempts = 0;
    const memoryStore = {
      async getBlocksByTier(owner: string, tier: MemoryBlock['tier']) {
        return [...blocks.values()].filter(item => item.owner === owner && item.tier === tier);
      },
      async getBlockByLabel(owner: string, label: string) {
        return [...blocks.values()].find(item => item.owner === owner && item.label === label) ?? null;
      },
      async deleteForMaintenance(_owner: string, id: string) {
        deleteAttempts++;
        if (deleteAttempts === 2) throw new Error('injected mid-prune failure');
        blocks.delete(id);
      },
    } as unknown as MemoryStoreWithMaintenance;
    const state = {content: ''};
    const memoryManager = {
      async write(label: string, content: string) {
        if (label === 'archivist:state') state.content = content;
        return {applied: false as const, error: 'unused'};
      },
    } as unknown as MemoryManager;
    const persistence = {
      async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
        const blocksBefore = new Map(blocks);
        const stateBefore = state.content;
        try {
          return await operation();
        } catch (error) {
          blocks.clear();
          for (const [id, item] of blocksBefore) blocks.set(id, item);
          state.content = stateBefore;
          throw error;
        }
      },
    } as unknown as PersistenceProvider;
    const pipeline = createArchivistPipeline({
      memoryStore,
      memoryManager,
      embedding: null,
      summarizationModel: null,
      persistence,
      owner: OWNER,
      modelName: 'unused',
      dedupThreshold: 0.9,
      crossrefThreshold: 0.8,
      tokenBudget: 1000,
    });
    const originalError = console.error;
    console.error = mock(() => {});
    try {
      await expect(pipeline.runIncremental()).rejects.toThrow('injected mid-prune failure');
    } finally {
      console.error = originalError;
    }

    expect([...blocks.keys()].sort()).toEqual(['empty-a', 'empty-b']);
    expect(state.content).toBe('');
  });

  it('reports zero pruned blocks when full-mode prune transaction rolls back', async () => {
    const blocks = new Map<string, MemoryBlock>([['empty', block('empty', '')]]);
    const memoryStore = {
      async getBlocksByTier(owner: string, tier: MemoryBlock['tier']) {
        return [...blocks.values()].filter(item => item.owner === owner && item.tier === tier);
      },
      async deleteForMaintenance() { throw new Error('injected full-mode rollback'); },
    } as unknown as MemoryStoreWithMaintenance;
    const memoryManager = {
      async write() { return {applied: false as const, error: 'unused'}; },
    } as unknown as MemoryManager;
    const persistence = {
      async withTransaction<T>(operation: () => Promise<T>): Promise<T> { return operation(); },
    } as unknown as PersistenceProvider;
    const pipeline = createArchivistPipeline({
      memoryStore, memoryManager, embedding: null, summarizationModel: null, persistence,
      owner: OWNER, modelName: 'unused', dedupThreshold: 0.9, crossrefThreshold: 0.8, tokenBudget: 1000,
    });
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    try {
      const result = await pipeline.runFull();
      expect(result.pruned).toBe(0);
    } finally {
      console.warn = originalWarn;
    }
  });
});
