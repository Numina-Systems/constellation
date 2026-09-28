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

export type { WorkingMemoryContextState } from './context.ts';

export { createMemoryManager } from './manager.ts';

export { createPostgresMemoryStore } from './postgres-store.ts';

export { formatWorkingMemorySection, createWorkingMemoryContextProvider } from './context.ts';
