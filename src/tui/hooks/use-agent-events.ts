// pattern: Imperative Shell

import { useState, useEffect, useRef } from 'react';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';

/**
 * Custom hook that subscribes to the event bus and accumulates matching events.
 * Uses batching via setTimeout(0) to avoid excessive re-renders on high-frequency events.
 */
export function useAgentEvents<T extends AgentEvent>(
  bus: AgentEventBus,
  filter: (event: AgentEvent) => event is T
): ReadonlyArray<T> {
  const [events, setEvents] = useState<T[]>([]);
  const bufferRef = useRef<T[]>([]);
  const pendingFlushRef = useRef<boolean>(false);

  useEffect(() => {
    // Subscribe to the bus
    const unsubscribe = bus.subscribe((event) => {
      if (filter(event)) {
        // Add to buffer
        bufferRef.current.push(event);

        // Schedule a flush if not already pending
        if (!pendingFlushRef.current) {
          pendingFlushRef.current = true;
          setTimeout(() => {
            // Flush buffer to state
            if (bufferRef.current.length > 0) {
              setEvents((prev) => [...prev, ...bufferRef.current]);
              bufferRef.current = [];
            }
            pendingFlushRef.current = false;
          }, 0);
        }
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
