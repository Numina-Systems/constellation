// pattern: Imperative Shell (barrel export)

export type {
  EventDrain,
  EventDrainOptions,
  SchedulerTask,
  SchedulerTaskHandler,
  SchedulerHandlerDeps,
  ActivityAwareSystemHandlerDeps,
  TransitionHandlerDeps,
  SchedulerRegistrationDeps,
} from './types.ts';
export { processEventQueue, createEventDrain } from './event-drain.ts';
export { buildReviewEvent, buildAgentScheduledEvent } from './scheduled-event-builders.ts';
export {
  SUPPRESS_DURING_SLEEP,
  createSystemTaskHandler,
  createAgentTaskHandler,
  createSleepTaskHandler,
  createPostImpulseHousekeeping,
  createActivityAwareSystemHandler,
  createTransitionHandler,
  registerSchedulerHandlers,
} from './scheduler-handlers.ts';
export type { PreStartTaskRegistrationDeps, PostStartTaskRegistrationDeps } from './task-registration.ts';
export { registerPreStartSystemTasks, registerPostStartSystemTasks } from './task-registration.ts';
