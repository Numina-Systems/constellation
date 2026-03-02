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

  const cancel_task: Tool = {
    definition: {
      name: 'cancel_task',
      description: 'Cancel a scheduled task by ID. Only the agent that owns the task can cancel it.',
      parameters: [
        {
          name: 'task_id',
          type: 'string',
          description: 'The ID of the task to cancel',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      try {
        const taskId = params['task_id'] as string;

        // Verify the task exists and belongs to this owner
        const rows = await deps.persistence.query(
          'SELECT id FROM scheduled_tasks WHERE id = $1 AND owner = $2',
          [taskId, deps.owner],
        );

        if (rows.length === 0) {
          return {
            success: false,
            output: '',
            error: 'Task not found or not owned by this agent',
          };
        }

        // Cancel the task
        await deps.scheduler.cancel(taskId);

        return {
          success: true,
          output: JSON.stringify(
            {
              id: taskId,
              status: 'cancelled',
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `cancel_task failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const list_tasks: Tool = {
    definition: {
      name: 'list_tasks',
      description:
        'List all scheduled tasks owned by this agent. By default, only active (non-cancelled) tasks are shown.',
      parameters: [
        {
          name: 'include_cancelled',
          type: 'boolean',
          description: 'Whether to include cancelled tasks (default false)',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const includeCancelled = params['include_cancelled'] as boolean | undefined;
        const showCancelled = includeCancelled === true;

        let sql =
          'SELECT id, name, schedule, payload, next_run_at, last_run_at, cancelled FROM scheduled_tasks WHERE owner = $1';
        const queryParams: readonly unknown[] = [deps.owner];

        if (!showCancelled) {
          sql += ' AND cancelled = FALSE';
        }

        sql += ' ORDER BY next_run_at ASC';

        const rows = await deps.persistence.query<{
          readonly id: string;
          readonly name: string;
          readonly schedule: string;
          readonly payload: { type: string; prompt?: string };
          readonly next_run_at: Date;
          readonly last_run_at: Date | null;
          readonly cancelled: boolean;
        }>(sql, queryParams);

        const tasks = rows.map((row) => {
          const taskInfo: Record<string, unknown> = {
            id: row.id,
            name: row.name,
            schedule: row.schedule,
            prompt: row.payload.prompt || '',
            next_run_at: row.next_run_at instanceof Date ? row.next_run_at.toISOString() : row.next_run_at,
            last_run_at:
              row.last_run_at === null
                ? null
                : row.last_run_at instanceof Date
                  ? row.last_run_at.toISOString()
                  : row.last_run_at,
          };

          if (showCancelled) {
            taskInfo['cancelled'] = row.cancelled;
          }

          return taskInfo;
        });

        return {
          success: true,
          output: JSON.stringify(tasks, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `list_tasks failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return [schedule_task, cancel_task, list_tasks];
}
