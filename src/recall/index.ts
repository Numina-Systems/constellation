// pattern: Functional Core (barrel export)

export type { DecompositionResult, RecallFragment, RecallResult } from './types.js';
export { parseDecompositionResponse } from './decompose.js';
export { decomposeMessage } from './decomposer.js';
export { retrieveContext } from './retrieve.js';
export type { RetrieveOptions } from './retrieve.js';
export { performRecall } from './orchestrator.js';
export type { RecallDeps } from './orchestrator.js';
