// pattern: Functional Core

export type {
  MemoryTier,
  MemoryPermission,
  MemoryBlock,
  MemoryEvent,
  PendingMutation,
  MemorySearchResult,
  MemoryWriteResult,
} from './types.ts';

export type { MemoryStore } from './store.ts';

export type { MemoryManager } from './manager.ts';

export { createMemoryManager } from './manager.ts';

export { createPostgresMemoryStore } from './postgres-store.ts';
