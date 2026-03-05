// pattern: Functional Core

import { Cron } from 'croner';
import type { ActivityMode } from './types.ts';

export type ScheduleConfig = {
  readonly sleepSchedule: string;
  readonly wakeSchedule: string;
  readonly timezone: string;
};

/**
 * Determine the current activity mode based on which cron expression
 * fired most recently. If sleep fired after wake, we're sleeping.
 * If wake fired after sleep (or both are null), we're active.
 */
export function currentMode(config: Readonly<ScheduleConfig>): ActivityMode {
  const lastSleep = new Cron(config.sleepSchedule, { timezone: config.timezone }).previousRun();
  const lastWake = new Cron(config.wakeSchedule, { timezone: config.timezone }).previousRun();

  if (lastSleep === null) return 'active';
  if (lastWake === null) return 'sleeping';

  return lastSleep > lastWake ? 'sleeping' : 'active';
}

/**
 * Compute the next transition time: if currently sleeping, next wake time;
 * if currently active, next sleep time.
 */
export function nextTransitionTime(
  mode: ActivityMode,
  config: Readonly<ScheduleConfig>,
): Date | null {
  const schedule = mode === 'active' ? config.sleepSchedule : config.wakeSchedule;
  return new Cron(schedule, { timezone: config.timezone }).nextRun();
}

/**
 * Validate a cron expression. Returns null if valid, error message if invalid.
 */
export function validateCron(expression: string): string | null {
  try {
    new Cron(expression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression';
  }
}

/**
 * Compute a cron expression that fires at a fixed offset after the sleep schedule.
 * E.g., if sleep is "0 22 * * *" (10 PM) and offset is 2, returns "0 0 * * *" (midnight).
 */
export function sleepTaskCron(sleepSchedule: string, offsetHours: number, timezone: string): string {
  const nextSleep = new Cron(sleepSchedule, { timezone }).nextRun();
  if (nextSleep === null) {
    throw new Error(`No future occurrence for sleep schedule: ${sleepSchedule}`);
  }

  const offsetMs = offsetHours * 3600_000;
  const taskTime = new Date(nextSleep.getTime() + offsetMs);

  // Extract hour and minute in the given timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(taskTime);

  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';

  const hour = String(parseInt(hourStr, 10));
  const minute = String(parseInt(minuteStr, 10));

  return `${minute} ${hour} * * *`;
}

export const SLEEP_TASK_NAMES = ['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis'] as const;

export const TRANSITION_TASK_NAMES = ['transition-to-sleep', 'transition-to-wake'] as const;

export function isSleepTask(taskName: string): boolean {
  return (SLEEP_TASK_NAMES as ReadonlyArray<string>).includes(taskName);
}

export function isTransitionTask(taskName: string): boolean {
  return (TRANSITION_TASK_NAMES as ReadonlyArray<string>).includes(taskName);
}
