// pattern: Imperative Shell

/**
 * MemoryManager orchestrates the three-tier memory system.
 * Enforces permission-based write access, generates embeddings on mutation,
 * and manages pending mutations for Familiar-permissioned blocks.
 */

import type { EmbeddingProvider } from '../embedding/types.ts';
import type { MemoryStore } from './store.ts';
import type {
  MemoryBlock,
  MemorySearchResult,
  MemoryTier,
  MemoryWriteResult,
  PendingMutation,
} from './types.ts';

export interface MemoryManager {
  // Context building
  getCoreBlocks(): Promise<Array<MemoryBlock>>;
  getWorkingBlocks(): Promise<Array<MemoryBlock>>;
  buildSystemPrompt(): Promise<string>;

  // Memory operations (permission-enforced)
  read(
    query: string,
    limit?: number,
    tier?: MemoryTier,
  ): Promise<Array<MemorySearchResult>>;
  write(
    label: string,
    content: string,
    tier?: MemoryTier,
    reason?: string,
  ): Promise<MemoryWriteResult>;
  list(tier?: MemoryTier): Promise<Array<MemoryBlock>>;

  // Mutation management
  getPendingMutations(): Promise<Array<PendingMutation>>;
  approveMutation(mutationId: string): Promise<MemoryBlock>;
  rejectMutation(mutationId: string, feedback: string): Promise<PendingMutation>;
}

export function createMemoryManager(
  store: MemoryStore,
  embedding: EmbeddingProvider,
  owner: string,
): MemoryManager {
  async function getCoreBlocks(): Promise<Array<MemoryBlock>> {
    return store.getBlocksByTier(owner, 'core');
  }

  async function getWorkingBlocks(): Promise<Array<MemoryBlock>> {
    return store.getBlocksByTier(owner, 'working');
  }

  async function buildSystemPrompt(): Promise<string> {
    const coreBlocks = await getCoreBlocks();
    const lines = coreBlocks.map((block) => `## ${block.label}\n${block.content}`);
    return lines.join('\n\n');
  }

  async function generateEmbedding(text: string): Promise<Array<number> | null> {
    try {
      return await embedding.embed(text);
    } catch (error) {
      console.warn(
        'embedding provider failed, storing block with null embedding',
        error,
      );
      return null;
    }
  }

  async function read(
    query: string,
    limit: number = 10,
    tier?: MemoryTier,
  ): Promise<Array<MemorySearchResult>> {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }
    return store.searchByEmbedding(owner, queryEmbedding, limit, tier);
  }

  async function write(
    label: string,
    content: string,
    tier: MemoryTier = 'working',
    reason?: string,
  ): Promise<MemoryWriteResult> {
    const existing = await store.getBlockByLabel(owner, label);

    if (existing) {
      // Check permission
      if (existing.permission === 'readonly') {
        return {
          applied: false,
          error: 'block is read-only',
        };
      }

      if (existing.permission === 'familiar') {
        // Queue a pending mutation
        const mutation = await store.createMutation({
          block_id: existing.id,
          proposed_content: content,
          reason: reason || null,
          status: 'pending',
          feedback: null,
        });
        return {
          applied: false,
          mutation,
        };
      }

      // For append or readwrite, update the block
      const newContent =
        existing.permission === 'append'
          ? `${existing.content}\n${content}`
          : content;

      const newEmbedding = await generateEmbedding(newContent);
      const updatedBlock = await store.updateBlock(
        existing.id,
        newContent,
        newEmbedding,
      );

      // Log the update event
      await store.logEvent({
        block_id: existing.id,
        event_type: 'update',
        old_content: existing.content,
        new_content: newContent,
      });

      return {
        applied: true,
        block: updatedBlock,
      };
    }

    // Create a new block
    const newEmbedding = await generateEmbedding(content);
    const newBlock = await store.createBlock({
      id: crypto.randomUUID(),
      owner,
      tier,
      label,
      content,
      embedding: newEmbedding,
      permission: 'readwrite',
      pinned: false,
    });

    // Log the create event
    await store.logEvent({
      block_id: newBlock.id,
      event_type: 'create',
      old_content: null,
      new_content: content,
    });

    return {
      applied: true,
      block: newBlock,
    };
  }

  async function list(tier?: MemoryTier): Promise<Array<MemoryBlock>> {
    if (tier) {
      return store.getBlocksByTier(owner, tier);
    }

    // Return all blocks for the owner - fetch in parallel
    const [core, working, archival] = await Promise.all([
      store.getBlocksByTier(owner, 'core'),
      store.getBlocksByTier(owner, 'working'),
      store.getBlocksByTier(owner, 'archival'),
    ]);

    return [...core, ...working, ...archival];
  }

  async function getPendingMutations(): Promise<Array<PendingMutation>> {
    return store.getPendingMutations(owner);
  }

  async function approveMutation(mutationId: string): Promise<MemoryBlock> {
    // Load the mutation
    const mutations = await store.getPendingMutations(owner);
    const mutation = mutations.find((m) => m.id === mutationId);

    if (!mutation) {
      throw new Error(`mutation not found: ${mutationId}`);
    }

    if (mutation.status !== 'pending') {
      throw new Error(`mutation is not pending: ${mutation.status}`);
    }

    // Load the block
    const block = await store.getBlock(mutation.block_id);
    if (!block) {
      throw new Error(`block not found: ${mutation.block_id}`);
    }

    // Update the block with the proposed content
    const newEmbedding = await generateEmbedding(mutation.proposed_content);
    const updatedBlock = await store.updateBlock(
      block.id,
      mutation.proposed_content,
      newEmbedding,
    );

    // Mark mutation as approved
    await store.resolveMutation(mutationId, 'approved');

    // Log the update event
    await store.logEvent({
      block_id: block.id,
      event_type: 'update',
      old_content: block.content,
      new_content: mutation.proposed_content,
    });

    return updatedBlock;
  }

  async function rejectMutation(
    mutationId: string,
    feedback: string,
  ): Promise<PendingMutation> {
    // Load the mutation
    const mutations = await store.getPendingMutations(owner);
    const mutation = mutations.find((m) => m.id === mutationId);

    if (!mutation) {
      throw new Error(`mutation not found: ${mutationId}`);
    }

    if (mutation.status !== 'pending') {
      throw new Error(`mutation is not pending: ${mutation.status}`);
    }

    // Mark mutation as rejected with feedback
    return store.resolveMutation(mutationId, 'rejected', feedback);
  }

  return {
    getCoreBlocks,
    getWorkingBlocks,
    buildSystemPrompt,
    read,
    write,
    list,
    getPendingMutations,
    approveMutation,
    rejectMutation,
  };
}
