// pattern: Functional Core

export type { Scheduler, ScheduledTask } from '../extensions/scheduler.ts';

export type SchedulerRow = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
  readonly next_run_at: Date;
  readonly last_run_at: Date | null;
  readonly cancelled: boolean;
  readonly created_at: Date;
};
