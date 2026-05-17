// pattern: Functional Core (barrel export)

// Phase 1: Base
export { ConstellationError } from './base.js';
export { isConstellationError, wrapError } from './utils.js';

// Phase 2: Memory and Model
export { MemoryError } from './memory.js';
export type { MemoryErrorCode } from './memory.js';
export { ModelError } from './model.js';
export type { ModelErrorCode } from './model.js';

// Phase 3: Persistence, Agent, Config
export { PersistenceError, sanitizeQuery } from './persistence.js';
export type { PersistenceErrorCode } from './persistence.js';
export { AgentError } from './agent.js';
export type { AgentErrorCode } from './agent.js';
export { ConfigError } from './config.js';
export type { ConfigErrorCode } from './config.js';

// Phase 3 (arch-hardening): Shell
export { ShellError } from './shell.js';
export type { ShellErrorCode } from './shell.js';

// Phase 4: Trace integration
export { traceError } from './trace.js';

// Phase 5: Secrets
export { SecretsError } from './secrets.js';
export type { SecretsErrorCode } from './secrets.js';
