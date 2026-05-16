// pattern: Functional Core (barrel export)

export { ConstellationError } from './base.js';
export { isConstellationError, wrapError } from './utils.js';
export { MemoryError } from './memory.js';
export type { MemoryErrorCode } from './memory.js';
export { ModelError } from './model.js';
export type { ModelErrorCode } from './model.js';
export { PersistenceError, sanitizeQuery } from './persistence.js';
export type { PersistenceErrorCode } from './persistence.js';
export { AgentError } from './agent.js';
export type { AgentErrorCode } from './agent.js';
export { ConfigError } from './config.js';
export type { ConfigErrorCode } from './config.js';
