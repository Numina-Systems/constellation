// pattern: Functional Core

const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[A-Za-z]|\].*?(?:\x07|\x1b\\)|\([A-Za-z])/g;

export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_PATTERN, '');
}
