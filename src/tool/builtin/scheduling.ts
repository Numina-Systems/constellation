// pattern: Imperative Shell (tool handlers have side effects; validation is pure but co-located)

import { Cron } from 'croner';

/**
 * Validates that a cron expression has a minimum interval between executions.
 * One-shot schedules (ISO 8601 timestamps) automatically pass validation.
 */
export function validateMinimumInterval(schedule: string, minMinutes: number): boolean {
  const cron = new Cron(schedule);
  const runs = cron.nextRuns(2);

  if (runs.length < 2) {
    return true;
  }

  const intervalMs = runs[1]!.getTime() - runs[0]!.getTime();
  return intervalMs >= minMinutes * 60_000;
}
