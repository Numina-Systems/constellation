// pattern: Functional Core (barrel export)

export { ConstellationError } from './base.js';
export { isConstellationError, wrapError } from './utils.js';
export { MemoryError } from './memory.js';
export type { MemoryErrorCode } from './memory.js';
export { ModelError } from './model.js';
export type { ModelErrorCode } from './model.js';
