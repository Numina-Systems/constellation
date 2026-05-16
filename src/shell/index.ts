// pattern: Imperative Shell

export type { ShellConfig, ShellResult, ShellSession } from './types';
export { stripAnsi } from './ansi';
export { truncateOutput } from './truncate';
export { createShellSession, ShellCreationError } from './session';
