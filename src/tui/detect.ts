// pattern: Functional Core

/**
 * Pure function to detect whether TUI mode should be enabled.
 *
 * Returns an object indicating whether to use TUI and any warnings
 * that should be displayed if the mode was requested but unavailable.
 */

export type TuiDetectionResult = {
  useTui: boolean;
  warning: string | null;
};

export function detectTuiMode(
  argv: ReadonlyArray<string>,
  isTty: boolean,
): TuiDetectionResult {
  const hasTuiFlag = argv.includes('--tui');

  if (!hasTuiFlag) {
    return { useTui: false, warning: null };
  }

  if (!isTty) {
    return {
      useTui: false,
      warning: '--tui flag ignored: not running in a TTY environment, falling back to REPL',
    };
  }

  return { useTui: true, warning: null };
}
