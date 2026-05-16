// pattern: Functional Core

import { ConstellationError } from './base.js';

export type ShellErrorCode =
  | 'SHELL_CREATION_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'MARKER_NOT_FOUND'
  | 'SESSION_CLOSED';

const SUGGESTIONS: Record<ShellErrorCode, string> = {
  SHELL_CREATION_FAILED: 'verify shell binary exists and user has permissions to spawn processes',
  COMMAND_TIMEOUT: 'increase timeout or check for commands that block on stdin/confirmation',
  MARKER_NOT_FOUND: 'shell process may have died or produced unexpected output that consumed the marker',
  SESSION_CLOSED: 'create a new shell session — the previous one exited or was killed',
};

export class ShellError extends ConstellationError {
  constructor(
    code: ShellErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { cause?: Error },
  ) {
    super(message, code, 'shell', context ?? {}, {
      suggestion: SUGGESTIONS[code],
      cause: options?.cause,
    });
    this.name = 'ShellError';
  }
}
