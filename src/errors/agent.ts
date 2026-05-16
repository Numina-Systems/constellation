// pattern: Functional Core

import { ConstellationError } from './base.js';

export type AgentErrorCode =
  | 'TOOL_DISPATCH_FAILED'
  | 'COMPACTION_FAILED'
  | 'RECALL_FAILED'
  | 'CHECKPOINT_FAILED';

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
