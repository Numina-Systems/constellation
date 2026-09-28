// pattern: Functional Core

import { ConstellationError } from './base.js';

export type AgentErrorCode =
  | 'TOOL_DISPATCH_FAILED'
  | 'COMPACTION_FAILED'
  | 'RECALL_FAILED'
  | 'CHECKPOINT_FAILED'
  | 'RECOVERY_REQUIRED'
  | 'CONTEXT_UNFITTABLE'
  | 'TURN_CANCELLED'
  | 'INTEGRITY_FAILED'
  | 'REENTRANT_INGRESS'
  | 'EXCHANGE_CORRUPT';

export class AgentError extends ConstellationError {
  constructor(
    code: AgentErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'agent', context ?? {}, options);
    this.name = 'AgentError';
  }
}
