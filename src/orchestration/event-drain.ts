// pattern: Imperative Shell

import { createEventQueue } from '@/extensions/bluesky';
import type { EventQueue } from '@/extensions/bluesky';
import type { Agent } from '@/agent/types';
import type { EventDrain, EventDrainOptions } from './types.ts';

/**
 * Process events from a queue, catching errors so one failed event doesn't crash the loop.
 * Extracted for testability (AC6.5: processEvent errors don't crash listener).
 * Caller provides the event queue and agent; this function drains the queue
 * and ensures errors are logged but don't prevent subsequent events from processing.
 */
export async function processEventQueue(
  eventQueue: EventQueue,
  agent: Agent,
  sourceLabel: string = 'bluesky',
): Promise<void> {
  let event = eventQueue.shift();
  while (event) {
    try {
      const result = await agent.processEvent(event);
      if (result) {
        console.log(`[${sourceLabel}] agent response: ${result}`);
      }
    } catch (error) {
      // AC6.5: Log error but don't crash
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`${sourceLabel} processEvent error: ${errorMsg}`);
    }
    event = eventQueue.shift();
  }
}

/**
 * Create a bounded event queue with a single-flight drain, capturing the
 * external-event and scheduler-event loops previously inlined in main().
 *
 * `drain()` is safe to call from every producer: while a drain is in flight,
 * additional calls return immediately instead of starting a second loop, and
 * the in-flight flag resets in a finally block even when the drain throws.
 */
export function createEventDrain(options: Readonly<EventDrainOptions>): EventDrain {
  const { capacity, agent, sourceLabel } = options;
  const queue = createEventQueue(capacity);
  let processing = false;

  return {
    queue,
    drain: async (): Promise<void> => {
      if (processing) return;
      processing = true;
      try {
        await processEventQueue(queue, agent, sourceLabel);
      } finally {
        processing = false;
      }
    },
  };
}
