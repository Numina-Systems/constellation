// pattern: Functional Core

import { ConstellationError } from './base.js';

export type SecretsErrorCode =
  | 'STORE_FAILED'
  | 'RESOLVE_FAILED';

export class SecretsError extends ConstellationError {
  constructor(
    code: SecretsErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'secrets', context ?? {}, options);
    this.name = 'SecretsError';
  }
}
