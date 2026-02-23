// pattern: Functional Core

/**
 * MemoryStore port interface.
 * This is the abstraction boundary for memory persistence operations.
 * Implementations (e.g., PostgreSQL) must provide these methods.
 */

import type {
  MemoryBlock,
  MemoryEvent,
  MemoryTier,
  PendingMutation,
  MemorySearchResult,
} from './types.ts';

export interface MemoryStore {
  // CRUD operations
  getBlock(id: string): Promise<MemoryBlock | null>;
  getBlocksByTier(
    owner: string,
    tier: MemoryTier,
  ): Promise<Array<MemoryBlock>>;
  getBlockByLabel(owner: string, label: string): Promise<MemoryBlock | null>;
  createBlock(
    block: Omit<MemoryBlock, 'created_at' | 'updated_at'>,
  ): Promise<MemoryBlock>;
  updateBlock(
    id: string,
    content: string,
    embedding: ReadonlyArray<number> | null,
  ): Promise<MemoryBlock>;
  deleteBlock(id: string): Promise<void>;

  // Semantic search
  searchByEmbedding(
    owner: string,
    embedding: ReadonlyArray<number>,
    limit: number,
    tier?: MemoryTier,
  ): Promise<Array<MemorySearchResult>>;

  // Event sourcing
  logEvent(
    event: Omit<MemoryEvent, 'id' | 'created_at'>,
  ): Promise<MemoryEvent>;
  getEvents(blockId: string): Promise<Array<MemoryEvent>>;

  // Pending mutations
  createMutation(
    mutation: Omit<PendingMutation, 'id' | 'created_at' | 'resolved_at'>,
  ): Promise<PendingMutation>;
  getPendingMutations(owner?: string): Promise<Array<PendingMutation>>;
  resolveMutation(
    id: string,
    status: 'approved' | 'rejected',
    feedback?: string,
  ): Promise<PendingMutation>;
}
