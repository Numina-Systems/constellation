// pattern: Functional Core

import { ConstellationError } from './base.js';

export function isConstellationError(
  error: unknown,
): error is ConstellationError {
  return error instanceof ConstellationError;
}

export function wrapError(
  error: unknown,
  code: string,
  subsystem: string,
  context?: Record<string, unknown>,
): ConstellationError {
  const cause = error instanceof Error ? error : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  return new ConstellationError(message, code, subsystem, context ?? {}, {
    cause,
  });
}
