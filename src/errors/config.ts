// pattern: Functional Core

import { ConstellationError } from './base.js';

export type ConfigErrorCode =
  | 'VALIDATION_FAILED'
  | 'MISSING_REQUIRED';

export class ConfigError extends ConstellationError {
  constructor(
    code: ConfigErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'config', context ?? {}, options);
    this.name = 'ConfigError';
  }
}
