// pattern: Functional Core

import { ConstellationError } from './base.js';

export type ModelErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT';

export class ModelError extends ConstellationError {
  readonly retryable: boolean;

  constructor(
    code: ModelErrorCode,
    message: string,
    retryable: boolean = false,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'model', context ?? {}, options);
    this.name = 'ModelError';
    this.retryable = retryable;
  }
}
