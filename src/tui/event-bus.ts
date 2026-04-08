// pattern: Functional Core

import type { AgentEvent, AgentEventBus, AgentEventListener, AgentEventFilter } from './types.ts';

type Subscription = {
  listener: AgentEventListener;
  filter?: AgentEventFilter;
};

/**
 * Creates an event bus for publishing and subscribing to agent events.
 * Fire-and-forget pub/sub with optional filtering.
 */
export function createAgentEventBus(): AgentEventBus {
  const subscriptions = new Set<Subscription>();

  function publish(event: AgentEvent): void {
    for (const subscription of subscriptions) {
      const { listener, filter } = subscription;
      if (filter === undefined || filter(event)) {
        try {
          listener(event);
        } catch {
          // Silently ignore listener errors to prevent one failure from affecting others
        }
      }
    }
  }

  function subscribe(listener: AgentEventListener, filter?: AgentEventFilter): () => void {
    const subscription: Subscription = { listener, filter };
    subscriptions.add(subscription);

    // Return unsubscribe function
    return () => {
      subscriptions.delete(subscription);
    };
  }

  function clear(): void {
    subscriptions.clear();
  }

  return {
    publish,
    subscribe,
    clear,
  };
}
