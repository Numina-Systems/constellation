// pattern: Imperative Shell

import type { EventQueue } from '@/extensions/bluesky';
import type { Agent } from '@/agent/types';
import type { PredictionStore, TraceStore } from '@/reflexion';
import type {
  InterestRegistry,
  ImpulseAssembler,
  IntrospectionAssembler,
  ContinuationBudget,
  ContinuationJudge,
} from '@/subconscious';
import type { ActivityManager } from '@/activity/index.ts';
import type { ArchivistPipeline } from '@/archivist';
import type { Scheduler } from '@/scheduler';

/**
 * Bounded event queue and its drain operation. Concurrent drain calls share
 * one processing loop, and a failed drain does not leave the queue locked.
 */
export type EventDrain = {
  readonly queue: EventQueue;
  drain(): Promise<void>;
};

/** Dependencies for createEventDrain. `sourceLabel` labels drain log lines. */
export type EventDrainOptions = {
  readonly capacity: number;
  readonly agent: Agent;
  readonly sourceLabel: string;
};

/** Task shape delivered to scheduler onDue handlers. */
export type SchedulerTask = {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly payload: Record<string, unknown>;
};

/**
 * Handler registered on a scheduler. Must return void: the scheduler tick
 * invokes handlers without awaiting them, so async work stays fire-and-forget.
 */
export type SchedulerTaskHandler = (task: SchedulerTask) => void;

/**
 * Dependencies for the scheduler onDue handler factories, mirroring the
 * closures these handlers previously captured in main(). Optional members
 * mirror the composition root's opt-in configurations (subconscious,
 * archivist, activity): each may be absent, and the corresponding task
 * branches then fall through to the next handler.
 */
export type SchedulerHandlerDeps = {
  /** Owner string for agent-scoped queries (AGENT_OWNER at the composition root). */
  readonly owner: string;
  /** Main agent that processes review and queued scheduler events. */
  readonly agent: Agent;
  readonly predictionStore: PredictionStore;
  readonly traceStore: TraceStore;
  readonly interestRegistry: InterestRegistry;
  /** Drain that serializes scheduler-event processing for the main agent. */
  readonly schedulerSink: EventDrain;
  readonly subconsciousAgent?: Agent;
  readonly archivistAgent?: Agent | null;
  readonly archivistPipeline?: ArchivistPipeline | null;
  readonly impulseAssembler?: ImpulseAssembler;
  readonly introspectionAssembler?: IntrospectionAssembler;
  readonly continuationBudget?: ContinuationBudget;
  readonly continuationJudge?: ContinuationJudge;
  readonly activityManager?: ActivityManager | null;
  /** Engagement decay half-life in days applied by post-impulse housekeeping. */
  readonly engagementHalfLifeDays: number;
  /** Active-interest cap enforced by post-impulse housekeeping. */
  readonly maxActiveInterests: number;
};

/** Deps for the activity-aware system handler; falls back to systemHandler. */
export type ActivityAwareSystemHandlerDeps = SchedulerHandlerDeps & {
  /** Fallback for tasks that are neither sleep, impulse, introspection, nor archivist. */
  readonly systemHandler: SchedulerTaskHandler;
};

/** Deps for the sleep/wake transition handler. */
export type TransitionHandlerDeps = SchedulerHandlerDeps & {
  /** Wake drain to run after the transition-to-wake morning agenda. */
  readonly wakeHandler: () => Promise<void>;
};

/** Deps for registerSchedulerHandlers. */
export type SchedulerRegistrationDeps = SchedulerHandlerDeps & {
  readonly systemScheduler: Scheduler;
  readonly agentScheduler: Scheduler;
  /** Trickle delay between events during the wake drain. */
  readonly trickleDelayMs: number;
};
