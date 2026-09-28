/**
 * Tests for the scheduler onDue handler factories extracted from main().
 * Verifies sleep-task routing, archivist routing, the review gate, budget
 * reset points, continuation wiring, branch sequencing, sleep/wake
 * transitions, and the asymmetric activity-aware registration wiring.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  createSystemTaskHandler,
  createAgentTaskHandler,
  createSleepTaskHandler,
  createPostImpulseHousekeeping,
  createActivityAwareSystemHandler,
  createTransitionHandler,
  registerSchedulerHandlers,
} from './scheduler-handlers.ts';
import { createEventDrain } from './event-drain.ts';
import type { EventDrain, SchedulerHandlerDeps, SchedulerTask } from './types.ts';
import type { Agent, ExternalEvent } from '@/agent/types';
import type { TraceStore, PredictionStore, OperationTrace } from '@/reflexion';
import type {
  InterestRegistry,
  Interest,
  ImpulseAssembler,
  IntrospectionAssembler,
  ContinuationBudget,
  ContinuationJudge,
} from '@/subconscious';
import type { ActivityManager, ActivityMode, QueuedEvent, NewQueuedEvent } from '@/activity/types';
import type { ArchivistPipeline, PipelineResult } from '@/archivist';
import type { Scheduler, ScheduledTask } from '@/scheduler';

/** Quiet console mocks so handler logging does not flood test output. */
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
let quietLog: ReturnType<typeof mock>;
let quietWarn: ReturnType<typeof mock>;
let quietError: ReturnType<typeof mock>;

beforeEach(() => {
  quietLog = mock((_msg?: unknown) => {});
  quietWarn = mock((_msg?: unknown) => {});
  quietError = mock((_msg?: unknown) => {});
  console.log = quietLog;
  console.warn = quietWarn;
  console.error = quietError;
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

const flush = async (ms = 25): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock agent for testing (same shape as src/index.test.ts).
 */
function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    processMessage: mock(async (_message: string) => 'mock response'),
    processEvent: mock(async () => 'mock response'),
    getConversationHistory: mock(async () => []),
    getCheckpointState: mock(() => null),
    conversationId: 'test-conv-123',
    ...overrides,
  };
}

function externalEvent(source: string): ExternalEvent {
  return { source, content: `event from ${source}`, metadata: {}, timestamp: new Date() };
}

function testTrace(): OperationTrace {
  return {
    id: 'trace-1',
    owner: 'test-owner',
    conversationId: 'conv-1',
    toolName: 'memory_read',
    input: {},
    outputSummary: 'ok',
    durationMs: 5,
    success: true,
    error: null,
    createdAt: new Date(),
  };
}

function task(name: string, payload: Record<string, unknown> = {}): SchedulerTask {
  return { id: `task-${name}`, name, schedule: '0 * * * *', payload };
}

function queuedEvent(source: string, prompt?: string): QueuedEvent {
  return {
    id: `queued-${source}`,
    source,
    payload: prompt === undefined ? {} : { prompt },
    priority: 'normal',
    enqueuedAt: new Date(),
    flagged: false,
  };
}

/** Throws when called; assignable to any registry member (never return). */
const unusedMember = () => {
  throw new Error('test double: member not used by these tests');
};

function createMockTraceStore(traces: ReadonlyArray<OperationTrace> = []): TraceStore {
  return {
    record: mock(async () => {}),
    queryTraces: mock(async () => traces),
  };
}

function createMockPredictionStore(): PredictionStore {
  return {
    createPrediction: unusedMember,
    listPredictions: mock(async () => []),
    createEvaluation: unusedMember,
    markEvaluated: mock(async () => {}),
    expireStalePredictions: mock(async () => 0),
    getLastReviewTimestamp: mock(async () => null),
  };
}

function createMockInterestRegistry(overrides?: {
  applyEngagementDecay?: InterestRegistry['applyEngagementDecay'];
  enforceActiveInterestCap?: InterestRegistry['enforceActiveInterestCap'];
}): InterestRegistry {
  return {
    createInterest: unusedMember,
    getInterest: unusedMember,
    updateInterest: unusedMember,
    listInterests: mock(async () => [] as ReadonlyArray<Interest>),
    createCuriosityThread: unusedMember,
    getCuriosityThread: unusedMember,
    updateCuriosityThread: unusedMember,
    listCuriosityThreads: unusedMember,
    findDuplicateCuriosityThread: unusedMember,
    logExploration: unusedMember,
    listExplorationLog: unusedMember,
    applyEngagementDecay: overrides?.applyEngagementDecay ?? mock(async () => 0),
    enforceActiveInterestCap: overrides?.enforceActiveInterestCap ?? mock(async () => [] as ReadonlyArray<Interest>),
    bumpEngagement: unusedMember,
  };
}

function createMockActivityManager(overrides?: {
  isActive?: boolean;
  flaggedEvents?: ReadonlyArray<QueuedEvent>;
  drainedEvents?: ReadonlyArray<QueuedEvent>;
}): ActivityManager & { transitions: Array<ActivityMode>; queued: Array<NewQueuedEvent> } {
  const transitions: Array<ActivityMode> = [];
  const queued: Array<NewQueuedEvent> = [];
  return {
    transitions,
    queued,
    getState: mock(async () => ({
      mode: 'active' as const,
      transitionedAt: new Date(),
      nextTransitionAt: null,
      queuedEventCount: 0,
      flaggedEventCount: 0,
    })),
    isActive: mock(async () => overrides?.isActive ?? true),
    transitionTo: mock(async (mode: ActivityMode) => {
      transitions.push(mode);
    }),
    queueEvent: mock(async (event: NewQueuedEvent) => {
      queued.push(event);
    }),
    flagEvent: mock(async () => {}),
    drainQueue: async function* () {
      yield* overrides?.drainedEvents ?? [];
    },
    getFlaggedEvents: mock(async () => overrides?.flaggedEvents ?? []),
  };
}

function createMockScheduler(): { scheduler: Scheduler; state: { handler: ((task: ScheduledTask) => void) | null } } {
  const state: { handler: ((task: ScheduledTask) => void) | null } = { handler: null };
  const scheduler: Scheduler = {
    schedule: mock(async (scheduled: ScheduledTask) => ({ id: scheduled.id, nextRunAt: new Date() })),
    cancel: mock(async () => {}),
    onDue: (fn: (task: ScheduledTask) => void) => {
      state.handler = fn;
    },
  };
  return { scheduler, state };
}

/**
 * Assembles the full SchedulerHandlerDeps closure with order-tracking mocks.
 * The scheduler sink uses the real single-flight drain wired to the main
 * agent mock, so queued-event assertions see processed events.
 */
function createHarness(options?: {
  traces?: ReadonlyArray<OperationTrace>;
  subconscious?: boolean;
  archivistAgent?: Agent | null;
  archivistPipeline?: boolean;
  activityManager?: ActivityManager | null;
}) {
  const order: Array<string> = [];
  const agent = createMockAgent({
    processEvent: mock(async (event: ExternalEvent) => {
      order.push(`agent:${event.source}`);
      return 'agent response';
    }),
  });
  const subconsciousAgent = createMockAgent({
    processEvent: mock(async (event: ExternalEvent) => {
      order.push(`subconscious:${event.source}`);
      return 'subconscious response';
    }),
  });
  const archivistAgent = createMockAgent({
    processEvent: mock(async (event: ExternalEvent) => {
      order.push(`archivist:${event.source}`);
      return 'archivist response';
    }),
  });
  const schedulerSink: EventDrain = createEventDrain({ capacity: 10, agent, sourceLabel: 'scheduler' });
  const predictionStore = createMockPredictionStore();
  const traceStore = createMockTraceStore(options?.traces ?? []);
  const interestRegistry = createMockInterestRegistry({
    applyEngagementDecay: mock(async () => {
      order.push('decay');
      return 0;
    }),
  });
  const impulseAssembler: ImpulseAssembler = {
    assembleImpulse: mock(async () => {
      order.push('assembleImpulse');
      return externalEvent('impulse-event');
    }),
    assembleMorningAgenda: mock(async () => {
      order.push('assembleMorningAgenda');
      return externalEvent('morning-agenda-event');
    }),
    assembleWrapUp: mock(async () => {
      order.push('assembleWrapUp');
      return externalEvent('wrap-up-event');
    }),
  };
  const introspectionAssembler: IntrospectionAssembler = {
    assembleIntrospection: mock(async () => {
      order.push('assembleIntrospection');
      return externalEvent('introspection-event');
    }),
  };
  const continuationBudget: ContinuationBudget = {
    canContinue: mock(() => true),
    spend: mock(() => {
      order.push('spend');
    }),
    resetEvent: mock(() => {
      order.push('resetEvent');
    }),
    resetCycle: mock(() => {
      order.push('resetCycle');
    }),
  };
  const continuationJudge: ContinuationJudge = {
    evaluate: mock(async () => {
      order.push('evaluate');
      return { shouldContinue: false, reason: 'test stop' };
    }),
  };
  const archivistPipeline: ArchivistPipeline = {
    runIncremental: mock(async (): Promise<PipelineResult> => {
      order.push('runIncremental');
      return { mode: 'incremental', scanned: 3, deduped: 1, consolidated: 0, crossreffed: 0, pruned: 1, reflected: false, totalTokensUsed: 0 };
    }),
    runFull: mock(async (): Promise<PipelineResult> => {
      return { mode: 'full', scanned: 3, deduped: 1, consolidated: 0, crossreffed: 0, pruned: 1, reflected: true, totalTokensUsed: 10 };
    }),
  };
  const hasSubconscious = options?.subconscious !== false;
  const deps: SchedulerHandlerDeps = {
    owner: 'test-owner',
    agent,
    predictionStore,
    traceStore,
    interestRegistry,
    schedulerSink,
    subconsciousAgent: hasSubconscious ? subconsciousAgent : undefined,
    archivistAgent: options?.archivistAgent === undefined ? archivistAgent : options.archivistAgent,
    archivistPipeline: options?.archivistPipeline === false ? null : archivistPipeline,
    impulseAssembler: hasSubconscious ? impulseAssembler : undefined,
    introspectionAssembler: hasSubconscious ? introspectionAssembler : undefined,
    continuationBudget: hasSubconscious ? continuationBudget : undefined,
    continuationJudge: hasSubconscious ? continuationJudge : undefined,
    activityManager: options?.activityManager ?? null,
    engagementHalfLifeDays: 7,
    maxActiveInterests: 10,
  };
  return {
    deps,
    order,
    agent,
    subconsciousAgent,
    archivistAgent,
    schedulerSink,
    predictionStore,
    traceStore,
    interestRegistry,
    impulseAssembler,
    introspectionAssembler,
    continuationBudget,
    continuationJudge,
    archivistPipeline,
  };
}

describe('createSystemTaskHandler', () => {
  it('expires stale predictions, resets the budget, and processes the review event when the gate passes', async () => {
    const harness = createHarness({ traces: [testTrace()] });
    const handler = createSystemTaskHandler(harness.deps);

    handler(task('review-predictions', { type: 'prediction-review' }));
    await flush();

    expect(harness.predictionStore.expireStalePredictions).toHaveBeenCalledWith('test-owner', expect.any(Date));
    expect(harness.order).toContain('resetEvent');
    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'review-job' }),
    );
  });

  it('skips review-predictions when no recent traces exist and does not reset the budget', async () => {
    const harness = createHarness({ traces: [] });
    const handler = createSystemTaskHandler(harness.deps);

    handler(task('review-predictions', { type: 'prediction-review' }));
    await flush();

    expect(quietLog).toHaveBeenCalledWith('[review-gate] skipping review-predictions: no agent-initiated traces since last window');
    expect(harness.order).not.toContain('resetEvent');
    expect(harness.agent.processEvent).not.toHaveBeenCalled();
  });

  it('runs the continuation loop once (judge stops) after the review event', async () => {
    const harness = createHarness({ traces: [testTrace()] });
    const handler = createSystemTaskHandler(harness.deps);

    handler(task('review-predictions', { type: 'prediction-review' }));
    await flush();

    expect(harness.continuationJudge.evaluate).toHaveBeenCalledTimes(1);
    expect(harness.order).not.toContain('spend');
  });

  it('routes non-review tasks through the scheduler sink as agent-scheduled events', async () => {
    const harness = createHarness();
    const handler = createSystemTaskHandler(harness.deps);

    handler(task('custom-agent-task', { prompt: 'do a thing' }));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'agent-scheduled' }),
    );
  });

  it('triggers the scheduler sink drain itself after queueing', async () => {
    const harness = createHarness();
    const realDrain = harness.schedulerSink.drain.bind(harness.schedulerSink);
    let drainCalls = 0;
    harness.schedulerSink.drain = async (): Promise<void> => {
      drainCalls += 1;
      return realDrain();
    };
    const handler = createSystemTaskHandler(harness.deps);

    handler(task('custom-agent-task', { prompt: 'do a thing' }));
    await flush();

    // Pins the production wiring: the handler (not the test) drains the sink.
    expect(drainCalls).toBeGreaterThanOrEqual(1);
  });

  it('AC.7: catches async failures and logs them instead of an unhandled rejection', async () => {
    const harness = createHarness();
    const traceStore = createMockTraceStore();
    traceStore.queryTraces = mock(async () => {
      throw new Error('trace store unavailable');
    });
    const handler = createSystemTaskHandler({ ...harness.deps, traceStore });

    handler(task('review-predictions', { type: 'prediction-review' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Without the .catch on the fire-and-forget IIFE, the rejected promise
    // is unhandled and Bun treats it as fatal, failing the whole file.
    expect(quietError).toHaveBeenCalledWith('system scheduler onDue error:', expect.any(Error));
    expect(harness.agent.processEvent).not.toHaveBeenCalled();
  });
});

describe('createAgentTaskHandler', () => {
  it('queues an agent-scheduled event into the scheduler sink and drains it', async () => {
    const harness = createHarness();
    const handler = createAgentTaskHandler(harness.deps);

    handler(task('agent-task', { prompt: 'hello' }));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'agent-scheduled' }),
    );
  });

  it('triggers the scheduler sink drain itself after queueing', async () => {
    const harness = createHarness();
    const realDrain = harness.schedulerSink.drain.bind(harness.schedulerSink);
    let drainCalls = 0;
    harness.schedulerSink.drain = async (): Promise<void> => {
      drainCalls += 1;
      return realDrain();
    };
    const handler = createAgentTaskHandler(harness.deps);

    handler(task('agent-task', { prompt: 'hello' }));
    await flush();

    // Pins the production wiring: the handler (not the test) drains the sink.
    expect(drainCalls).toBeGreaterThanOrEqual(1);
  });

  it('logs and swallows trace store failures', async () => {
    const harness = createHarness();
    const traceStore = createMockTraceStore();
    traceStore.queryTraces = mock(async () => {
      throw new Error('db down');
    });
    const handler = createAgentTaskHandler({ ...harness.deps, traceStore });

    handler(task('agent-task'));
    await flush();

    expect(quietError).toHaveBeenCalledWith('agent scheduler onDue error:', expect.any(Error));
    expect(harness.agent.processEvent).not.toHaveBeenCalled();
  });
});

describe('createSleepTaskHandler', () => {
  const flagged = [queuedEvent('scheduler:queued', 'flagged prompt')];

  function sleepHarness(): ReturnType<typeof createHarness> {
    const manager = createMockActivityManager({ flaggedEvents: flagged });
    const harness = createHarness({ activityManager: manager });
    return harness;
  }

  it.each(['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis'] as const)(
    'routes %s to its builder with flagged events and queues the result',
    async (taskName) => {
      const harness = sleepHarness();
      const handler = createSleepTaskHandler(harness.deps);

      handler(task(taskName));
      await flush();
      await harness.schedulerSink.drain();

      const expectedTaskType = taskName === 'sleep-compaction'
        ? 'compaction'
        : taskName === 'sleep-prediction-review'
          ? 'prediction-review'
          : 'pattern-analysis';
      expect(harness.agent.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'sleep-task',
          metadata: expect.objectContaining({ taskType: expectedTaskType }),
        }),
      );
    },
  );

  it('routes sleep-archivist to the archivist sub-agent when present', async () => {
    const harness = sleepHarness();
    const handler = createSleepTaskHandler(harness.deps);

    handler(task('sleep-archivist'));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.archivistAgent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'sleep-task',
        metadata: expect.objectContaining({ taskType: 'archivist' }),
      }),
    );
    expect(harness.agent.processEvent).not.toHaveBeenCalled();
  });

  it('queues sleep-archivist to the main agent when no archivist sub-agent exists', async () => {
    const manager = createMockActivityManager({ flaggedEvents: flagged });
    const harness = createHarness({ activityManager: manager, archivistAgent: null });
    const handler = createSleepTaskHandler(harness.deps);

    handler(task('sleep-archivist'));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ taskType: 'archivist' }),
      }),
    );
  });

  it('warns and drops unknown sleep tasks', async () => {
    const harness = sleepHarness();
    const handler = createSleepTaskHandler(harness.deps);

    handler(task('sleep-nonsense'));
    await flush();
    await harness.schedulerSink.drain();

    expect(quietWarn).toHaveBeenCalledWith('[activity] unknown sleep task: sleep-nonsense');
    expect(harness.agent.processEvent).not.toHaveBeenCalled();
  });
});

describe('createPostImpulseHousekeeping', () => {
  it('applies engagement decay and enforces the active-interest cap', async () => {
    const harness = createHarness();
    const housekeeping = createPostImpulseHousekeeping(harness.deps);

    await housekeeping();

    expect(harness.interestRegistry.applyEngagementDecay).toHaveBeenCalledWith('test-owner', 7);
    expect(harness.interestRegistry.enforceActiveInterestCap).toHaveBeenCalledWith('test-owner', 10);
  });

  it('logs housekeeping errors without propagating them', async () => {
    const harness = createHarness();
    const interestRegistry = createMockInterestRegistry({
      applyEngagementDecay: mock(async () => {
        throw new Error('decay failed');
      }),
    });
    const housekeeping = createPostImpulseHousekeeping({ ...harness.deps, interestRegistry });

    await expect(housekeeping()).resolves.toBeUndefined();

    expect(quietError).toHaveBeenCalledWith('[subconscious] housekeeping error:', expect.any(Error));
  });

  it('throws at the boundary when required numeric deps are missing', () => {
    const harness = createHarness();

    expect(() =>
      createPostImpulseHousekeeping({ ...harness.deps, engagementHalfLifeDays: undefined as unknown as number }),
    ).toThrow('scheduler handler deps missing required field: engagementHalfLifeDays');
    expect(() =>
      createPostImpulseHousekeeping({ ...harness.deps, maxActiveInterests: undefined as unknown as number }),
    ).toThrow('scheduler handler deps missing required field: maxActiveInterests');
  });
});

describe('createActivityAwareSystemHandler', () => {
  function activityHarness(): { harness: ReturnType<typeof createHarness>; manager: ReturnType<typeof createMockActivityManager>; fallback: ReturnType<typeof mock> } {
    const manager = createMockActivityManager();
    const harness = createHarness({ activityManager: manager });
    const fallback = mock((_task: SchedulerTask) => {});
    return { harness, manager, fallback };
  }

  function buildHandler(harness: ReturnType<typeof createHarness>, fallback: ReturnType<typeof mock>) {
    return createActivityAwareSystemHandler({ ...harness.deps, systemHandler: fallback });
  }

  it('routes sleep tasks to the sleep task handler', async () => {
    const { harness, manager, fallback } = activityHarness();
    manager.getFlaggedEvents = mock(async () => [queuedEvent('scheduler:queued')]);
    const handler = buildHandler(harness, fallback);

    handler(task('sleep-compaction'));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'compaction' }) }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('sequences the impulse branch: resetEvent, assembleImpulse, processEvent, housekeeping, continuation', async () => {
    const { harness, fallback } = activityHarness();
    const handler = buildHandler(harness, fallback);

    handler(task('subconscious-impulse'));
    await flush();

    expect(harness.order).toEqual([
      'resetEvent',
      'assembleImpulse',
      'subconscious:impulse-event',
      'decay',
      'evaluate',
    ]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('sequences the introspection branch: assembleIntrospection then processEvent (no budget reset, no housekeeping)', async () => {
    const { harness, fallback } = activityHarness();
    const handler = buildHandler(harness, fallback);

    handler(task('subconscious-introspection'));
    await flush();

    expect(harness.order).toEqual(['assembleIntrospection', 'subconscious:introspection-event']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs the archivist incremental pipeline for archivist-incremental', async () => {
    const { harness, fallback } = activityHarness();
    const handler = buildHandler(harness, fallback);

    handler(task('archivist-incremental'));
    await flush();

    expect(harness.order).toEqual(['runIncremental']);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to the system handler for every other task', () => {
    const { harness, fallback } = activityHarness();
    const handler = buildHandler(harness, fallback);
    const other = task('review-predictions');

    handler(other);

    expect(fallback).toHaveBeenCalledWith(other);
  });
});

describe('createTransitionHandler', () => {
  function transitionHarness(options?: { subconscious?: boolean }) {
    const manager = createMockActivityManager();
    const harness = createHarness({ activityManager: manager, subconscious: options?.subconscious });
    const wakeHandler = mock(async () => {
      harness.order.push('wake');
    });
    const handler = createTransitionHandler({ ...harness.deps, wakeHandler });
    return { harness, manager, wakeHandler, handler };
  }

  it('transition-to-sleep: wrap-up, housekeeping, then transitionTo(sleeping)', async () => {
    const { harness, manager, wakeHandler, handler } = transitionHarness();

    handler({ name: 'transition-to-sleep' });
    await flush();

    expect(harness.order).toEqual(['assembleWrapUp', 'subconscious:wrap-up-event', 'decay']);
    expect(manager.transitions).toEqual(['sleeping']);
    expect(wakeHandler).not.toHaveBeenCalled();
  });

  it('transition-to-sleep without subconscious still transitions to sleeping', async () => {
    const { harness, manager, handler } = transitionHarness({ subconscious: false });

    handler({ name: 'transition-to-sleep' });
    await flush();

    expect(harness.order).toEqual([]);
    expect(manager.transitions).toEqual(['sleeping']);
  });

  it('transition-to-wake: resetCycle, morning agenda, housekeeping, then the wake drain', async () => {
    const { harness, manager, wakeHandler, handler } = transitionHarness();

    handler({ name: 'transition-to-wake' });
    await flush();

    expect(harness.order).toEqual(['resetCycle', 'assembleMorningAgenda', 'subconscious:morning-agenda-event', 'decay', 'wake']);
    expect(manager.transitions).toEqual([]);
    expect(wakeHandler).toHaveBeenCalledTimes(1);
  });

  it('throws at the boundary when wakeHandler is missing', () => {
    const harness = createHarness({ activityManager: createMockActivityManager() });

    expect(() =>
      createTransitionHandler({ ...harness.deps, wakeHandler: undefined as unknown as () => Promise<void> }),
    ).toThrow('scheduler handler deps missing required field: wakeHandler');
  });
});

describe('registerSchedulerHandlers', () => {
  it('wraps both schedulers in the activity dispatch; only the system side suppresses during sleep', async () => {
    const manager = createMockActivityManager({ isActive: false });
    const harness = createHarness({ activityManager: manager });
    const system = createMockScheduler();
    const agent = createMockScheduler();

    registerSchedulerHandlers({
      ...harness.deps,
      systemScheduler: system.scheduler,
      agentScheduler: agent.scheduler,
      trickleDelayMs: 0,
    });

    expect(system.state.handler).not.toBeNull();
    expect(agent.state.handler).not.toBeNull();

    system.state.handler!(task('review-predictions'));
    await flush();

    // Suppressed on the system side during sleep: dropped silently.
    expect(manager.queued.length).toBe(0);
    expect(quietLog).toHaveBeenCalledWith('[activity] suppressed task "review-predictions" during sleep');

    agent.state.handler!(task('review-predictions'));
    await flush();

    // Not suppressed on the agent side: queued for the wake drain.
    expect(manager.queued.length).toBe(1);
    expect(manager.queued[0]!.source).toBe('scheduler:review-predictions');
  });

  it('activity branch dispatches through the activity-aware system handler and shared transition handler', async () => {
    const drained = queuedEvent('scheduler:queued', 'drained prompt');
    const manager = createMockActivityManager({ isActive: true, drainedEvents: [drained] });
    const harness = createHarness({ activityManager: manager });
    const system = createMockScheduler();
    const agent = createMockScheduler();

    registerSchedulerHandlers({
      ...harness.deps,
      systemScheduler: system.scheduler,
      agentScheduler: agent.scheduler,
      trickleDelayMs: 5,
    });

    // System side routes impulse tasks through the activity-aware handler.
    system.state.handler!(task('subconscious-impulse'));
    await flush();
    expect(harness.order.slice(0, 3)).toEqual(['resetEvent', 'assembleImpulse', 'subconscious:impulse-event']);

    // Agent side shares the same transition handler (wake drain runs it).
    harness.order.length = 0;
    agent.state.handler!(task('transition-to-wake'));
    await flush(60);

    expect(harness.order).toContain('resetCycle');
    expect(harness.order).toContain('assembleMorningAgenda');
    expect(manager.transitions).toContain('active');
    // The drained queued event reached the main agent through the sink.
    await harness.schedulerSink.drain();
    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'drained prompt' }),
    );
  });

  it('no-activity branch registers the raw handlers directly', async () => {
    const harness = createHarness({ activityManager: null });
    const system = createMockScheduler();
    const agent = createMockScheduler();

    registerSchedulerHandlers({
      ...harness.deps,
      systemScheduler: system.scheduler,
      agentScheduler: agent.scheduler,
      trickleDelayMs: 0,
    });

    system.state.handler!(task('custom-agent-task'));
    await flush();
    await harness.schedulerSink.drain();

    expect(harness.agent.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'agent-scheduled' }),
    );
  });
});
