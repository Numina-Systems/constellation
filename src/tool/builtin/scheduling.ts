// pattern: Imperative Shell (tool handlers have side effects; validation is pure but co-located)

import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { Scheduler, ScheduledTask } from '../../extensions/scheduler.ts';
import type { PersistenceProvider } from '../../persistence/types.ts';
import type { Tool } from '../types.ts';

const MIN_INTERVAL_MINUTES = 10;

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

type SchedulingToolDeps = {
  readonly scheduler: Scheduler;
  readonly owner: string;
  readonly persistence: PersistenceProvider;
};

export function createSchedulingTools(deps: SchedulingToolDeps): Array<Tool> {
  const schedule_task: Tool = {
    definition: {
      name: 'schedule_task',
      description:
        'Schedule a task to run at a specific time (one-shot) or on a recurring schedule (cron). The task will execute your self-instruction prompt when due.',
      parameters: [
        {
          name: 'name',
          type: 'string',
          description: 'Human-readable name for the task',
          required: true,
        },
        {
          name: 'schedule',
          type: 'string',
          description:
            'Cron expression (e.g., "0 */2 * * *" for every 2 hours) or ISO 8601 timestamp for one-shot scheduling',
          required: true,
        },
        {
          name: 'prompt',
          type: 'string',
          description: 'Self-instruction prompt that will execute when the task is due',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      try {
        const name = params['name'] as string;
        const schedule = params['schedule'] as string;
        const prompt = params['prompt'] as string;

        // Try to parse the schedule string as a cron expression
        let cron: Cron;
        try {
          cron = new Cron(schedule);
        } catch (error) {
          return {
            success: false,
            output: '',
            error: `Invalid schedule format: ${schedule}. Use a cron expression (e.g., "0 */2 * * *") or ISO 8601 timestamp.`,
          };
        }

        // Check if it's a recurring cron (has 2+ future runs)
        const runs = cron.nextRuns(2);
        if (runs.length >= 2) {
          // Recurring cron: validate minimum interval
          if (!validateMinimumInterval(schedule, MIN_INTERVAL_MINUTES)) {
            return {
              success: false,
              output: '',
              error: `Cron expression interval is too frequent. Minimum interval is ${MIN_INTERVAL_MINUTES} minutes.`,
            };
          }
        } else {
          // One-shot schedule: check that next run is in the future
          const nextRun = cron.nextRun();
          if (nextRun === null || nextRun.getTime() <= Date.now()) {
            return {
              success: false,
              output: '',
              error: `Schedule timestamp must be in the future. Got: ${schedule}`,
            };
          }
        }

        // Create the scheduled task
        const id = randomUUID();
        const task: ScheduledTask = {
          id,
          name,
          schedule,
          payload: { type: 'agent-scheduled', prompt },
        };

        // Schedule the task
        const result = await deps.scheduler.schedule(task);

        return {
          success: true,
          output: JSON.stringify(
            {
              id: result.id,
              name,
              schedule,
              next_run_at: result.nextRunAt.toISOString(),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `schedule_task failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return [schedule_task];
}
