// pattern: Imperative Shell (barrel export)

export type { EventDrain, EventDrainOptions } from './types.ts';
export { processEventQueue, createEventDrain } from './event-drain.ts';
export { buildReviewEvent, buildAgentScheduledEvent } from './scheduled-event-builders.ts';
