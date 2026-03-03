// pattern: Functional Core

/**
 * Scheduling context provider for agent system prompt injection.
 * Injects DID authority information (watched vs schedule-only) into the agent's system prompt.
 */

import type { ContextProvider } from './types.ts';

export function createSchedulingContextProvider(
  scheduleDids: ReadonlyArray<string>,
  watchedDids: ReadonlyArray<string>,
): ContextProvider {
  return () => {
    if (scheduleDids.length === 0 && watchedDids.length === 0) {
      return undefined;
    }

    const lines: Array<string> = ['[DID Authority]'];

    if (watchedDids.length > 0) {
      lines.push(`Watched DIDs (full interaction): ${watchedDids.join(', ')}`);
    }

    if (scheduleDids.length > 0) {
      lines.push(`Schedule DIDs (scheduling only): ${scheduleDids.join(', ')}`);
    }

    const scheduleOnlyDids = scheduleDids.filter((d) => !watchedDids.includes(d));
    if (scheduleOnlyDids.length > 0) {
      lines.push('');
      lines.push('When a message comes from a schedule-only DID, process only scheduling requests. Do not engage in general conversation.');
    }

    return lines.join('\n');
  };
}
