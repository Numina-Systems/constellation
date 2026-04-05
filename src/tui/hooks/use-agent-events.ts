// pattern: Imperative Shell

import { useState, useEffect } from 'react';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';

/**
 * Custom hook that subscribes to the event bus and accumulates matching events.
 * Uses batching via setTimeout(0) to avoid excessive re-renders on high-frequency events.
 */
export function useAgentEvents<T extends AgentEvent>(
  bus: AgentEventBus,
  filter: (event: AgentEvent) => event is T
): ReadonlyArray<T> {
  const [events, setEvents] = useState<Array<T>>([]);

  useEffect(() => {
    // Subscribe to the bus
    const unsubscribe = bus.subscribe((event) => {
      if (filter(event)) {
        // Immediately update state with the new event
        setEvents((prev) => [...prev, event]);
      }
    });

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [bus, filter]);

  return events;
}

/**
 * Custom hook that subscribes to the event bus and returns only the most recent matching event.
 */
export function useLatestAgentEvent<T extends AgentEvent>(
  bus: AgentEventBus,
  filter: (event: AgentEvent) => event is T
): T | null {
  const [event, setEvent] = useState<T | null>(null);

  useEffect(() => {
    // Subscribe to the bus
    const unsubscribe = bus.subscribe((incomingEvent) => {
      if (filter(incomingEvent)) {
        // Replace state with the latest event
        setEvent(incomingEvent);
      }
    });

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [bus, filter]);

  return event;
}
