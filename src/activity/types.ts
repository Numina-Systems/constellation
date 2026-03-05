// pattern: Functional Core

export type ActivityMode = 'active' | 'sleeping';

export type ActivityState = {
  readonly mode: ActivityMode;
  readonly transitionedAt: Date;
  readonly nextTransitionAt: Date | null;
  readonly queuedEventCount: number;
  readonly flaggedEventCount: number;
};

export type QueuedEvent = {
  readonly id: string;
  readonly source: string;
  readonly payload: unknown;
  readonly priority: 'normal' | 'high';
  readonly enqueuedAt: Date;
  readonly flagged: boolean;
};

export type NewQueuedEvent = {
  readonly source: string;
  readonly payload: unknown;
  readonly priority: 'normal' | 'high';
  readonly flagged: boolean;
};

export interface ActivityManager {
  getState(): Promise<ActivityState>;
  isActive(): Promise<boolean>;
  transitionTo(mode: ActivityMode): Promise<void>;
  queueEvent(event: NewQueuedEvent): Promise<void>;
  flagEvent(eventId: string): Promise<void>;
  drainQueue(): AsyncGenerator<QueuedEvent>;
  getFlaggedEvents(): Promise<ReadonlyArray<QueuedEvent>>;
}

export type ActivityStateRow = {
  readonly owner: string;
  readonly mode: string;
  readonly transitioned_at: Date;
  readonly next_transition_at: Date | null;
  readonly updated_at: Date;
};

export type EventQueueRow = {
  readonly id: string;
  readonly owner: string;
  readonly source: string;
  readonly payload: unknown;
  readonly priority: string;
  readonly flagged: boolean;
  readonly enqueued_at: Date;
  readonly processed_at: Date | null;
};
