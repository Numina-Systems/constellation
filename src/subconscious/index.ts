// pattern: Functional Core (barrel export)

export type {
  InterestSource,
  InterestStatus,
  CuriosityStatus,
  Interest,
  CuriosityThread,
  ExplorationLogEntry,
  InterestRegistryConfig,
  InterestRegistry,
} from './types.ts';

export { createInterestRegistry } from './persistence.ts';
