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
