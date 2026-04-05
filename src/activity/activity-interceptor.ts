// pattern: Imperative Shell

import type { IncomingMessage } from '../extensions/data-source.ts';
import type { ActivityManager, NewQueuedEvent } from './types.ts';

export type ActivityInterceptorOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (message: IncomingMessage) => void;
  readonly sourcePrefix: string;
  readonly highPriorityFilter?: (message: IncomingMessage) => boolean;
};

export function createActivityInterceptor(
  options: Readonly<ActivityInterceptorOptions>,
): (message: IncomingMessage) => void {
  const { activityManager, originalHandler, sourcePrefix, highPriorityFilter } = options;

  return (message: IncomingMessage) => {
    (async () => {
      const isActive = await activityManager.isActive();

      if (isActive) {
        originalHandler(message);
        return;
      }

      const isHighPriority = highPriorityFilter !== undefined && highPriorityFilter(message);

      const event: NewQueuedEvent = {
        source: `${sourcePrefix}:${message.source}`,
        payload: {
          content: message.content,
          metadata: message.metadata,
          originalTimestamp: message.timestamp.toISOString(),
        },
        priority: isHighPriority ? 'high' : 'normal',
        flagged: isHighPriority,
      };

      await activityManager.queueEvent(event);
      console.log(`[activity] queued ${sourcePrefix} event during sleep (priority: ${event.priority})`);
    })().catch((error) => {
      console.error(`[activity] ${sourcePrefix} interceptor error, falling through to original handler:`, error);
      originalHandler(message);
    });
  };
}
