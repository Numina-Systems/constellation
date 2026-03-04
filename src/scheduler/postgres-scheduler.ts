// pattern: Imperative Shell

import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { Scheduler, ScheduledTask } from '../extensions/scheduler.ts';
import type { SchedulerRow } from './types.ts';

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

export function createPostgresScheduler(
  persistence: PersistenceProvider,
  owner: string,
): PostgresScheduler {
  let handler: ((task: ScheduledTask) => void) | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    try {
      const rows = await persistence.query<SchedulerRow>(
        `SELECT * FROM scheduled_tasks
         WHERE owner = $1 AND cancelled = FALSE AND next_run_at <= NOW()
         ORDER BY next_run_at ASC`,
        [owner],
      );

      for (const row of rows) {
        try {
          const task = parseScheduledTask(row);

          if (handler) {
            handler(task);
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
            error instanceof Error ? error.message : error,
          );
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
        throw new Error(`Invalid cron expression: ${task.schedule}`);
      }

      if (nextRun === null) {
        throw new Error(
          `Invalid cron expression or no future occurrence: ${task.schedule}`,
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
      void tick();

      if (intervalId === null) {
        intervalId = setInterval(() => {
          void tick();
        }, 60000);
      }
    },

    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };

  return scheduler;
}
