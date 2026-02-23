// pattern: Functional Core (types only)

/**
 * Scheduler manages deferred and periodic tasks.
 * Enables "sleep time compute" — the agent performing background work between conversations.
 *
 * Use cases: periodic memory consolidation, scheduled data source polling,
 * deferred message delivery, background learning tasks.
 */
export type ScheduledTask = {
  readonly id: string;
  readonly name: string;
  readonly schedule: string; // cron expression or ISO timestamp
  readonly payload: Record<string, unknown>;
};

export type Scheduler = {
  schedule(task: ScheduledTask): Promise<void>;
  cancel(taskId: string): Promise<void>;
  onDue(handler: (task: ScheduledTask) => void): void;
};
