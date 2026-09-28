// pattern: Imperative Shell

import type { EventQueue } from '@/extensions/bluesky';
import type { Agent } from '@/agent/types';

/**
 * Port for a bounded event queue plus its single-flight drain loop.
 *
 * Producers push onto `queue`; consumers call `drain()`, which serializes
 * `agent.processEvent` calls. At most one drain loop runs per EventDrain:
 * concurrent `drain()` calls coalesce, and the in-flight flag always resets
 * (finally), so a failing drain cannot wedge the queue.
 */
export type EventDrain = {
  readonly queue: EventQueue;
  drain(): Promise<void>;
};

/** Dependencies for createEventDrain. `sourceLabel` labels drain log lines. */
export type EventDrainOptions = {
  readonly capacity: number;
  readonly agent: Agent;
  readonly sourceLabel: string;
};
