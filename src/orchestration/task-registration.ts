// pattern: Imperative Shell

import { buildImpulseCron, buildIntrospectionCron } from '@/subconscious';
import { sleepTaskCron } from '@/activity/index.ts';
import type { ScheduleConfig } from '@/activity/index.ts';
import type { PersistenceProvider } from '@/persistence/types';
import type { Scheduler } from '@/scheduler';

type EnsureScheduledTaskOptions = {
  readonly persistence: PersistenceProvider;
  readonly scheduler: Scheduler;
  /** Task-row owner to query (always 'system' for these default tasks). */
  readonly owner: string;
  readonly task: {
    readonly name: string;
    readonly schedule: string;
    readonly payload: Record<string, unknown>;
  };
  readonly scheduledMessage: string;
  readonly alreadyScheduledMessage?: string;
};

/** Schedule only when no uncancelled row exists for the owner and name; call sites keep their exact log lines. */
async function ensureScheduledTask(options: Readonly<EnsureScheduledTaskOptions>): Promise<void> {
  const existing = await options.persistence.query<{ id: string }>(
    `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
    [options.owner, options.task.name],
  );

  if (existing.length > 0) {
    if (options.alreadyScheduledMessage) {
      console.log(options.alreadyScheduledMessage);
    }
    return;
  }

  await options.scheduler.schedule({
    id: crypto.randomUUID(),
    name: options.task.name,
    schedule: options.task.schedule,
    payload: options.task.payload,
  });
  console.log(options.scheduledMessage);
}

/** Deps for the default tasks registered before the schedulers start. */
export type PreStartTaskRegistrationDeps = {
  readonly persistence: PersistenceProvider;
  readonly systemScheduler: Scheduler;
  readonly owner: string;
  /** subconsciousAgent && impulseAssembler at the composition root. */
  readonly hasImpulse: boolean;
  /** subconsciousAgent && introspectionAssembler at the composition root. */
  readonly hasIntrospection: boolean;
  readonly impulseIntervalMinutes?: number;
  readonly introspectionOffsetMinutes?: number;
};

/**
 * Register the default pre-start system tasks: the hourly review job and,
 * when the subconscious is configured, the impulse and introspection tasks.
 * Must run before scheduler.start().
 */
export async function registerPreStartSystemTasks(deps: Readonly<PreStartTaskRegistrationDeps>): Promise<void> {
  await ensureScheduledTask({
    persistence: deps.persistence,
    scheduler: deps.systemScheduler,
    owner: deps.owner,
    task: { name: 'review-predictions', schedule: '0 * * * *', payload: { type: 'prediction-review' } },
    scheduledMessage: 'review job scheduled (hourly)',
    alreadyScheduledMessage: 'review job already scheduled',
  });

  if (deps.hasImpulse && deps.impulseIntervalMinutes) {
    const impulseMinutes = deps.impulseIntervalMinutes;
    const impulseCron = buildImpulseCron(impulseMinutes);

    await ensureScheduledTask({
      persistence: deps.persistence,
      scheduler: deps.systemScheduler,
      owner: deps.owner,
      task: { name: 'subconscious-impulse', schedule: impulseCron, payload: { taskType: 'impulse' } },
      scheduledMessage: `impulse task scheduled (every ${impulseMinutes} minutes)`,
      alreadyScheduledMessage: 'impulse task already scheduled',
    });
  }

  if (deps.hasIntrospection && deps.impulseIntervalMinutes) {
    const impulseMinutes = deps.impulseIntervalMinutes;
    const offsetMinutes = deps.introspectionOffsetMinutes ?? 3;
    const introspectionCron = buildIntrospectionCron(impulseMinutes, offsetMinutes);

    await ensureScheduledTask({
      persistence: deps.persistence,
      scheduler: deps.systemScheduler,
      owner: deps.owner,
      task: { name: 'subconscious-introspection', schedule: introspectionCron, payload: { taskType: 'introspection' } },
      scheduledMessage: `introspection task scheduled (cron: ${introspectionCron}, offset: ${offsetMinutes}m from impulse)`,
      alreadyScheduledMessage: 'introspection task already scheduled',
    });
  }
}

/** Deps for the default tasks registered after the schedulers start. */
export type PostStartTaskRegistrationDeps = {
  readonly persistence: PersistenceProvider;
  readonly systemScheduler: Scheduler;
  readonly owner: string;
  /** config.archivist?.enabled !== false at the composition root. */
  readonly archivistEnabled: boolean;
  readonly incrementalCron?: string;
  readonly sleepOffsetHours?: number;
  /**
   * Null when the activity manager is absent (both are created together);
   * archivist sleep and activity tasks are skipped without it.
   */
  readonly activityScheduleConfig: ScheduleConfig | null;
};

/**
 * Register the default post-start system tasks: the archivist incremental
 * and sleep tasks (archivist first), then the five activity transition and
 * sleep tasks. Must run after scheduler.start().
 */
export async function registerPostStartSystemTasks(deps: Readonly<PostStartTaskRegistrationDeps>): Promise<void> {
  // --- Archivist task registration (before activity tasks) ---
  if (deps.archivistEnabled) {
    const archivistIncrementalCron = deps.incrementalCron ?? '0 */3 * * *';

    await ensureScheduledTask({
      persistence: deps.persistence,
      scheduler: deps.systemScheduler,
      owner: deps.owner,
      task: { name: 'archivist-incremental', schedule: archivistIncrementalCron, payload: { type: 'archivist-incremental' } },
      scheduledMessage: `archivist incremental task scheduled (${archivistIncrementalCron})`,
      alreadyScheduledMessage: 'archivist incremental task already scheduled',
    });

    if (deps.activityScheduleConfig) {
      const offsetHours = deps.sleepOffsetHours ?? 3;
      const archivistSleepCron = sleepTaskCron(deps.activityScheduleConfig.sleepSchedule, offsetHours, deps.activityScheduleConfig.timezone);

      await ensureScheduledTask({
        persistence: deps.persistence,
        scheduler: deps.systemScheduler,
        owner: deps.owner,
        task: { name: 'sleep-archivist', schedule: archivistSleepCron, payload: { type: 'sleep-archivist' } },
        scheduledMessage: `archivist sleep task scheduled (${archivistSleepCron})`,
        alreadyScheduledMessage: 'archivist sleep task already scheduled',
      });
    }
  }

  // --- Activity task registration (after schedulers started) ---
  if (deps.activityScheduleConfig) {
    const { sleepSchedule, wakeSchedule, timezone } = deps.activityScheduleConfig;

    const activityTasks = [
      { name: 'transition-to-sleep', schedule: sleepSchedule },
      { name: 'transition-to-wake', schedule: wakeSchedule },
      { name: 'sleep-compaction', schedule: sleepTaskCron(sleepSchedule, 2, timezone) },
      { name: 'sleep-prediction-review', schedule: sleepTaskCron(sleepSchedule, 4, timezone) },
      { name: 'sleep-pattern-analysis', schedule: sleepTaskCron(sleepSchedule, 6, timezone) },
    ];

    for (const activityTask of activityTasks) {
      await ensureScheduledTask({
        persistence: deps.persistence,
        scheduler: deps.systemScheduler,
        owner: deps.owner,
        task: { name: activityTask.name, schedule: activityTask.schedule, payload: { type: 'activity', sleepTask: true } },
        scheduledMessage: `[activity] registered task: ${activityTask.name} (${activityTask.schedule})`,
      });
    }

    console.log('[activity] all activity tasks registered');
  }
}
