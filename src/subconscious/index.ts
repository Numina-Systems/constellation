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
export { buildImpulseEvent, buildImpulseCron } from './impulse.ts';
export type { ImpulseContext } from './impulse.ts';
export { createImpulseAssembler } from './impulse-assembler.ts';
export type { ImpulseAssembler } from './impulse-assembler.ts';
