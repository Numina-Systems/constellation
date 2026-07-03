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
} from './types.ts';

export type { MemoryStore } from './store.ts';

export type { MemoryManager } from './manager.ts';

export type { WorkingMemoryContextState } from './context.ts';

export { createMemoryManager } from './manager.ts';

export { createPostgresMemoryStore } from './postgres-store.ts';

export { formatWorkingMemorySection, createWorkingMemoryContextProvider } from './context.ts';
