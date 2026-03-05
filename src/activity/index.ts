// pattern: Functional Core (barrel export)

export type {
  ActivityManager,
  ActivityState,
  QueuedEvent,
  NewQueuedEvent,
  ActivityMode,
} from './types.ts';
export { createActivityManager } from './postgres-activity-manager.ts';
export { currentMode, nextTransitionTime, validateCron, sleepTaskCron, isSleepTask, isTransitionTask, SLEEP_TASK_NAMES, TRANSITION_TASK_NAMES } from './schedule.ts';
export type { ScheduleConfig } from './schedule.ts';
export { createActivityContextProvider } from './context-provider.ts';
export { createActivityDispatch } from './dispatch.ts';
export type { DispatchOptions, ScheduledTaskLike } from './dispatch.ts';
export { buildCompactionEvent, buildPredictionReviewEvent, buildPatternAnalysisEvent } from './sleep-events.ts';
export type { SleepTaskEvent } from './sleep-events.ts';
