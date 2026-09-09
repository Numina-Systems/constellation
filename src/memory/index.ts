// pattern: Functional Core

export type {
  MemoryTier,
  MemoryPermission,
  MemoryBlock,
  MemoryEvent,
  PendingMutation,
  MemorySearchResult,
  MemoryStats,
  MemoryWriteResult,
  WorkingMemoryReplacementBlock,
} from './types.ts';

export type {MemoryMaintenanceStore, MemoryStore, MemoryStoreWithMaintenance} from './store.ts';
export {evaluateMaintenanceMemoryMutation, evaluatePublicMemoryDeletion} from './deletion-policy.ts';
export type {MaintenanceMemoryConstraints, MemoryDeletionDecision, MemoryDeletionRejection, MaintenanceMemoryDecision} from './deletion-policy.ts';

export type { MemoryManager } from './manager.ts';

export { createMemoryManager } from './manager.ts';

export { createPostgresMemoryStore } from './postgres-store.ts';
