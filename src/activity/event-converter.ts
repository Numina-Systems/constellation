// pattern: Functional Core

import type { QueuedEvent } from './types.ts';

type ExternalEventLike = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export function queuedEventToExternal(event: Readonly<QueuedEvent>): ExternalEventLike {
  // payload is unknown; cast to object|null for property access, guarded below
  const payload = event.payload as Record<string, unknown> | null;
  const content = typeof payload?.['prompt'] === 'string'
    // safe: typeof guard above confirms string
    ? (payload['prompt'] as string)
    : `Queued event from ${event.source} (enqueued at ${event.enqueuedAt.toISOString()})`;

  return {
    source: event.source,
    content,
    metadata: {
      queuedEventId: event.id,
      priority: event.priority,
      flagged: event.flagged,
      enqueuedAt: event.enqueuedAt.toISOString(),
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    },
    timestamp: event.enqueuedAt,
  };
}
