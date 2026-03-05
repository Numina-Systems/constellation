// pattern: Imperative Shell

import type { ActivityManager, NewQueuedEvent } from './types.ts';
import { isSleepTask, isTransitionTask } from './schedule.ts';

export type ScheduledTaskLike = {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
};

export type DispatchOptions = {
  readonly activityManager: ActivityManager;
  readonly originalHandler: (task: ScheduledTaskLike) => void;
  readonly onTransition: (task: ScheduledTaskLike) => void;
  readonly suppressDuringSleep?: ReadonlyArray<string>;
};

export function createActivityDispatch(options: Readonly<DispatchOptions>): (task: ScheduledTaskLike) => void {
  const { activityManager, originalHandler, onTransition, suppressDuringSleep = [] } = options;
  const suppressedSet = new Set(suppressDuringSleep);

  return (task: ScheduledTaskLike) => {
    (async () => {
      // Transition tasks always execute
      if (isTransitionTask(task.name)) {
        onTransition(task);
        return;
      }

      // Sleep tasks always execute (even during sleep)
      if (isSleepTask(task.name)) {
        originalHandler(task);
        return;
      }

      // Check activity state for everything else
      const isActive = await activityManager.isActive();

      if (isActive) {
        // Active mode: dispatch normally
        originalHandler(task);
      } else if (suppressedSet.has(task.name)) {
        // Suppressed during sleep: drop silently (covered by sleep-specific tasks)
        console.log(`[activity] suppressed task "${task.name}" during sleep`);
      } else {
        // Sleeping: queue the event instead of dispatching
        const event: NewQueuedEvent = {
          source: `scheduler:${task.name}`,
          payload: task.payload,
          priority: 'normal',
          flagged: false,
        };
        await activityManager.queueEvent(event);
        console.log(`[activity] queued scheduler task "${task.name}" during sleep`);
      }
    })().catch((error) => {
      console.error(`[activity] dispatch error for task ${task.name}:`, error);
      // Fall through to original handler on error to avoid losing events
      originalHandler(task);
    });
  };
}
