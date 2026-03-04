// pattern: Functional Core

/**
 * Scheduled task context formatting.
 * Converts OperationTrace records into compact, readable summaries
 * for enriching scheduled task event content.
 */

import type { OperationTrace } from '@/reflexion';

/**
 * Formats operation traces into a compact [Recent Activity] section.
 *
 * Returns a string starting with "[Recent Activity]\n" followed by formatted trace lines.
 * If traces is empty, shows "No recent activity recorded."
 *
 * Each trace is formatted as: [HH:MM] toolName ✓|✗ truncatedOutput
 * - Timestamp in local time (HH:MM format)
 * - Tool name from the trace
 * - Status: ✓ for success, ✗ for failure
 * - Output summary truncated to 80 characters with … appended if truncated
 *
 * Traces are expected to be ordered newest-first (from queryTraces).
 */
export function formatTraceSummary(traces: ReadonlyArray<OperationTrace>): string {
  if (traces.length === 0) {
    return '[Recent Activity]\nNo recent activity recorded.';
  }

  const lines = traces.map((trace) => {
    const time = trace.createdAt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const status = trace.success ? '✓' : '✗';

    const maxOutputLength = 80;
    const output =
      trace.outputSummary.length > maxOutputLength
        ? trace.outputSummary.slice(0, maxOutputLength) + '…'
        : trace.outputSummary;

    return `[${time}] ${trace.toolName} ${status} ${output}`;
  });

  return '[Recent Activity]\n' + lines.join('\n');
}
