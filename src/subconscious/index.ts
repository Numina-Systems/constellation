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
export { createSubconsciousContextProvider } from './context.ts';

export { buildContinuationPrompt, parseContinuationResponse } from './continuation.ts';
export type { ContinuationDecision, ContinuationJudgeContext, ContinuationJudge } from './continuation.ts';
export { createContinuationBudget } from './continuation-budget.ts';
export type { ContinuationBudget, ContinuationBudgetConfig } from './continuation-budget.ts';
export { createContinuationJudge } from './continuation-judge.ts';
export type { ContinuationJudgeDeps } from './continuation-judge.ts';
export { runContinuationLoop } from './continuation-loop.ts';
export type { ContinuationLoopDeps } from './continuation-loop.ts';
