// pattern: Functional Core

/**
 * MemoryStore port interface.
 * Implementations provide owner-scoped public deletion and narrow maintenance
 * operations. Public callers must supply the owning agent identity.
 */
import type {
  MemoryBlock,
  MemoryEvent,
  MemorySearchResult,
  MemoryTier,
  PendingMutation,
  WorkingMemoryReplacementBlock,
} from './types.ts';
import type {MaintenanceMemoryConstraints} from './deletion-policy.ts';

export interface MemoryStore {
  getBlock(id: string): Promise<MemoryBlock | null>;
  getBlocksByTier(owner: string, tier: MemoryTier): Promise<Array<MemoryBlock>>;
  getBlockByLabel(owner: string, label: string): Promise<MemoryBlock | null>;
  getBlocksByLabelPrefix(owner: string, prefix: string, tier?: MemoryTier): Promise<ReadonlyArray<MemoryBlock>>;
  createBlock(block: Omit<MemoryBlock, 'created_at' | 'updated_at'>): Promise<MemoryBlock>;
  updateBlock(id: string, content: string, embedding: ReadonlyArray<number> | null): Promise<MemoryBlock>;
  updateBlockTier(id: string, tier: MemoryTier): Promise<MemoryBlock>;

  /**
   * Delete a block for an owner after rechecking authorization under a row lock.
   */
  deleteBlock(id: string, owner: string): Promise<void>;

  searchByEmbedding(owner: string, embedding: ReadonlyArray<number>, limit: number, tier?: MemoryTier): Promise<Array<MemorySearchResult>>;
  logEvent(event: Omit<MemoryEvent, 'id' | 'created_at'>): Promise<MemoryEvent>;
  getEvents(blockId: string): Promise<Array<MemoryEvent>>;
  createMutation(mutation: Omit<PendingMutation, 'id' | 'created_at' | 'resolved_at'>): Promise<PendingMutation>;
  getPendingMutations(owner: string): Promise<Array<PendingMutation>>;
  resolveMutation(id: string, status: 'approved' | 'rejected', feedback?: string): Promise<PendingMutation>;

  /** Optional until restore wiring is completed in Phase 3. */
  replaceWorkingMemory?(owner: string, blocks: ReadonlyArray<WorkingMemoryReplacementBlock>): Promise<Array<MemoryBlock>>;
}

/** Narrow port held only by trusted ingest/archivist maintenance callers. */
export interface MemoryMaintenanceStore {
  deleteForMaintenance(owner: string, id: string, constraints: Readonly<MaintenanceMemoryConstraints>): Promise<void>;
  updateForMaintenance(
    owner: string,
    id: string,
    content: string,
    embedding: ReadonlyArray<number> | null,
    constraints: Readonly<MaintenanceMemoryConstraints>,
  ): Promise<MemoryBlock>;
}

export type MemoryStoreWithMaintenance = MemoryStore & MemoryMaintenanceStore;
