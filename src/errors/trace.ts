// pattern: Imperative Shell

import type { TraceRecorder } from '@/reflexion/types.js';
import type { ConstellationError } from './base.js';

/**
 * Record a ConstellationError as an operation trace.
 * Fire-and-forget — errors from the recorder itself are caught and logged.
 */
export function traceError(
  error: ConstellationError,
  recorder: TraceRecorder,
  owner: string,
  conversationId: string,
): void {
  const displayString = error.toDisplayString();
  const truncatedOutput = displayString.length > 500
    ? displayString.slice(0, 497) + '...'
    : displayString;

  recorder.record({
    owner,
    conversationId,
    toolName: error.subsystem,
    input: { errorCode: error.code, subsystem: error.subsystem, context: error.context },
    outputSummary: truncatedOutput,
    durationMs: 0,
    success: false,
    error: displayString,
  }).catch((recordError) => {
    console.warn('traceError: failed to record error trace', recordError);
  });
}
