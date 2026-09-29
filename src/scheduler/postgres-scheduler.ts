// pattern: Imperative Shell

import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { Scheduler, ScheduledTask } from '../extensions/scheduler.ts';
import type { SchedulerRow } from './types.ts';
import {ConstellationError, isConstellationError} from '@/errors/index.js';

export type PostgresScheduler = Scheduler & {
  start(): void;
  stop(): void;
};

function parseScheduledTask(row: SchedulerRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    payload: row.payload,
  };
}

export type PostgresSchedulerOptions = Readonly<{
  /** Delay before the first poll; defaults to immediate polling. */
  readonly pollOffsetMs?: number;
  /** Poll cadence; defaults to 60 seconds. */
  readonly pollIntervalMs?: number;
}>;

export function createPostgresScheduler(
  persistence: PersistenceProvider,
  owner: string,
  options: PostgresSchedulerOptions = {},
): PostgresScheduler {
  let handler: ((task: ScheduledTask) => void | Promise<void>) | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const pollOffsetMs = Math.max(0, options.pollOffsetMs ?? 0);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 60000);
  const inFlightTaskIds = new Set<string>();

  async function tick(): Promise<void> {
    try {
      const rows = await persistence.query<SchedulerRow>(
        `SELECT * FROM scheduled_tasks
         WHERE owner = $1 AND cancelled = FALSE AND next_run_at <= NOW()
         ORDER BY next_run_at ASC`,
        [owner],
      );

      for (const row of rows) {
        if (inFlightTaskIds.has(row.id)) continue;
        inFlightTaskIds.add(row.id);
        try {
          const task = parseScheduledTask(row);

          if (handler) {
            await handler(task);
          }

          const nextRun = new Cron(row.schedule).nextRun();

          if (nextRun === null) {
            await persistence.query(
              `UPDATE scheduled_tasks SET last_run_at = NOW(), cancelled = TRUE
               WHERE id = $1`,
              [row.id],
            );
          } else {
            await persistence.query(
              `UPDATE scheduled_tasks SET last_run_at = NOW(), next_run_at = $1
               WHERE id = $2`,
              [nextRun, row.id],
            );
          }
        } catch (error) {
          console.warn(
            `[scheduler] Error processing task ${row.id}:`,
            isConstellationError(error)
              ? {code: error.code, subsystem: error.subsystem, context: error.context, message: error.message}
              : error instanceof Error ? error.message : error,
          );
        } finally {
          inFlightTaskIds.delete(row.id);
        }
      }
    } catch (error) {
      console.warn(
        '[scheduler] Tick error:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const scheduler: PostgresScheduler = {
    async schedule(task: ScheduledTask): Promise<{ id: string; nextRunAt: Date }> {
      const id = randomUUID();
      let nextRun: Date | null;

      try {
        nextRun = new Cron(task.schedule).nextRun();
      } catch (error) {
        throw new ConstellationError(
          'invalid cron expression',
          'INVALID_CRON_EXPRESSION',
          'scheduler',
          {schedule: task.schedule},
          {cause: error instanceof Error ? error : undefined, suggestion: 'provide a valid cron expression'},
        );
      }

      if (nextRun === null) {
        throw new ConstellationError(
          'cron expression has no future occurrence',
          'INVALID_CRON_EXPRESSION',
          'scheduler',
          {schedule: task.schedule},
          {suggestion: 'provide a cron expression with a future occurrence'},
        );
      }

      await persistence.query(
        `INSERT INTO scheduled_tasks (id, owner, name, schedule, payload, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, owner, task.name, task.schedule, task.payload, nextRun],
      );

      return { id, nextRunAt: nextRun };
    },

    async cancel(taskId: string): Promise<void> {
      await persistence.query(
        `UPDATE scheduled_tasks SET cancelled = TRUE
         WHERE id = $1 AND owner = $2`,
        [taskId, owner],
      );
    },

    onDue(fn: (task: ScheduledTask) => void): void {
      handler = fn;
    },

    start(): void {
      if (intervalId !== null || initialTimeoutId !== null) return;
      const beginPolling = (): void => {
        initialTimeoutId = null;
        void tick();
        intervalId = setInterval(() => {
          void tick();
        }, pollIntervalMs);
      };
      if (pollOffsetMs === 0) beginPolling();
      else initialTimeoutId = setTimeout(beginPolling, pollOffsetMs);
    },

    stop(): void {
      if (initialTimeoutId !== null) {
        clearTimeout(initialTimeoutId);
        initialTimeoutId = null;
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };

  return scheduler;
}
