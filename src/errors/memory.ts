// pattern: Functional Core

import { ConstellationError } from './base.js';

export type MemoryErrorCode =
  | 'BLOCK_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MUTATION_REJECTED'
  | 'MUTATION_NOT_FOUND'
  | 'EMBEDDING_FAILED';

export class MemoryError extends ConstellationError {
  constructor(
    code: MemoryErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'memory', context ?? {}, options);
    this.name = 'MemoryError';
  }
}
