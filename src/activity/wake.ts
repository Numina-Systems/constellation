// pattern: Imperative Shell

import type { ActivityManager, QueuedEvent } from './types.ts';

export type WakeHandlerOptions = {
  readonly activityManager: ActivityManager;
  readonly onEvent: (event: QueuedEvent) => Promise<void>;
  readonly trickleDelayMs: number;
};

export function createWakeHandler(options: Readonly<WakeHandlerOptions>): () => Promise<void> {
  const { activityManager, onEvent, trickleDelayMs } = options;

  return async (): Promise<void> => {
    // 1. Transition to active
    await activityManager.transitionTo('active');
    console.log('[activity] transitioned to active mode');

    // 2. Drain queued events with trickle delay
    // drainQueue() yields events in priority order (high first, then normal, FIFO within)
    let count = 0;
    for await (const event of activityManager.drainQueue()) {
      try {
        await onEvent(event);
        count++;
      } catch (error) {
        console.error(`[activity] error processing queued event ${event.id}:`, error);
      }

      // Trickle delay between events
      if (trickleDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, trickleDelayMs));
      }
    }

    if (count > 0) {
      console.log(`[activity] drained ${count} queued events`);
    }
  };
}
