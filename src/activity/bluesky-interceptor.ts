// pattern: Imperative Shell

import type { ActivityManager, NewQueuedEvent } from './types.ts';

type IncomingMessageLike = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type BlueskyInterceptorOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (message: IncomingMessageLike) => void;
  readonly highPriorityDids?: ReadonlyArray<string>;
};

export function createBlueskyInterceptor(
  options: Readonly<BlueskyInterceptorOptions>,
): (message: IncomingMessageLike) => void {
  const { activityManager, originalHandler, highPriorityDids = [] } = options;
  const highPrioritySet = new Set(highPriorityDids);

  return (message: IncomingMessageLike) => {
    (async () => {
      const isActive = await activityManager.isActive();

      if (isActive) {
        originalHandler(message);
        return;
      }

      // Sleeping: queue the event
      const authorDid = message.metadata['authorDid'] as string | undefined;
      const isHighPriority = authorDid !== undefined && highPrioritySet.has(authorDid);

      const event: NewQueuedEvent = {
        source: `bluesky:${message.source}`,
        payload: {
          content: message.content,
          metadata: message.metadata,
          originalTimestamp: message.timestamp.toISOString(),
        },
        priority: isHighPriority ? 'high' : 'normal',
        flagged: isHighPriority,
      };

      await activityManager.queueEvent(event);
      console.log(`[activity] queued bluesky event during sleep (priority: ${event.priority})`);
    })().catch((error) => {
      console.error('[activity] bluesky interceptor error, falling through to original handler:', error);
      originalHandler(message);
    });
  };
}
