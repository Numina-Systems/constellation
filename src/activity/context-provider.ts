// pattern: Imperative Shell

/**
 * Activity context provider for agent system prompt injection.
 * Provides cached activity state and circadian guidance showing sleep/wake mode,
 * queue statistics, and flagged high-priority events during sleep.
 */

import type { ActivityManager, QueuedEvent } from './types.ts';
import type { ContextProvider } from '../agent/types.ts';

export function createActivityContextProvider(
  activityManager: ActivityManager,
): ContextProvider {
  const CACHE_TTL = 60_000; // 60 seconds, matching scheduler tick interval
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    Promise.all([activityManager.getState(), activityManager.getFlaggedEvents()])
      .then(([state, flaggedEvents]) => {
        const result = formatActivityContext(state, flaggedEvents);
        cached = { result, timestamp: Date.now() };
      })
      .catch((error) => {
        console.warn('activity context provider: failed to refresh', error);
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return () => {
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
      refresh();
    }
    return cached?.result;
  };
}

function formatActivityContext(
  state: Awaited<ReturnType<import('./types.ts').ActivityManager['getState']>>,
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): string | undefined {
  if (state.mode === 'active') {
    const nextSleepTime =
      state.nextTransitionAt !== null
        ? state.nextTransitionAt.toISOString()
        : 'unknown';
    return `[Activity] Status: active | Next sleep: ${nextSleepTime}`;
  }

  if (state.mode === 'sleeping') {
    const nextWakeTime =
      state.nextTransitionAt !== null
        ? state.nextTransitionAt.toISOString()
        : 'unknown';

    let result = `[Activity] Status: sleeping | Next wake: ${nextWakeTime}\n`;
    result += `Queued events: ${state.queuedEventCount} | Flagged: ${state.flaggedEventCount}\n\n`;
    result += `[Circadian Guidance]\n`;
    result += `You are in sleep mode. Focus on reflective, contemplative processing:\n`;
    result += `- Review and consolidate memories rather than acquiring new information\n`;
    result += `- Evaluate pending predictions and past decisions\n`;
    result += `- Identify patterns across recent interactions\n`;
    result += `- Prefer depth of thought over breadth of action\n`;

    if (flaggedEvents.length > 0) {
      result += `\n[Flagged Events]\n`;
      result += `These high-priority events arrived during sleep. Review and decide if action is needed:\n`;
      for (const event of flaggedEvents) {
        result += `- [${event.source}] at ${event.enqueuedAt.toISOString()}\n`;
      }
    }

    return result;
  }

  return undefined;
}
