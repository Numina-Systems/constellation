import {describe, expect, it} from 'bun:test';
import {createMemoryManager} from './manager.ts';
import {evaluatePublicMemoryDeletion} from './deletion-policy.ts';
import type {MemoryBlock} from './types.ts';
import type {MemoryStore} from './store.ts';

function makeBlock(): MemoryBlock {
  return {
    id: 'race-block', owner: 'owner-a', tier: 'working', label: 'race', content: 'content',
    embedding: null, permission: 'readwrite', pinned: false,
    created_at: new Date(0), updated_at: new Date(0),
  };
}

describe('memory_delete_permission_race', () => {
  it('rechecks the authoritative row after permission changes', async () => {
    const block = makeBlock();
    let deleted = false;
    let events = 0;
    const store = {
      getBlock: async () => block,
      deleteBlock: async (_id: string, owner?: string) => {
        block.permission = 'familiar';
        const decision = evaluatePublicMemoryDeletion(owner ?? '', block);
        if (!decision.allowed) throw new Error(decision.message);
        deleted = true;
      },
      logEvent: async () => { events += 1; return {} as never; },
      getBlocksByTier: async () => [],
      getBlockByLabel: async () => null,
      getBlocksByLabelPrefix: async () => [],
      createBlock: async () => block,
      updateBlock: async () => block,
      updateBlockTier: async () => block,
      searchByEmbedding: async () => [],
      getEvents: async () => [],
      createMutation: async () => ({} as never),
      getPendingMutations: async () => [],
      resolveMutation: async () => ({} as never),
    } as unknown as MemoryStore;
    const manager = createMemoryManager(store, {
      embed: async () => [],
      embedBatch: async () => [],
      dimensions: 0,
    }, 'owner-a');

    await expect(manager.deleteBlock(block.id)).rejects.toThrow('familiar');
    expect(deleted).toBe(false);
    expect(events).toBe(0);
  });
});
