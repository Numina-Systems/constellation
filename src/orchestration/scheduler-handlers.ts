// pattern: Imperative Shell

import { shouldSkipReview } from '@/reflexion';
import { runContinuationLoop } from '@/subconscious';
import {
  createActivityDispatch,
  createWakeHandler,
  isSleepTask,
  queuedEventToExternal,
  buildCompactionEvent,
  buildPredictionReviewEvent,
  buildPatternAnalysisEvent,
  buildArchivistEvent,
} from '@/activity/index.ts';
import { buildReviewEvent, buildAgentScheduledEvent } from './scheduled-event-builders.ts';
import type {
  SchedulerTask,
  SchedulerTaskHandler,
  SchedulerHandlerDeps,
  ActivityAwareSystemHandlerDeps,
  TransitionHandlerDeps,
  SchedulerRegistrationDeps,
} from './types.ts';

/**
 * System tasks dropped by the activity dispatch during sleep because
 * sleep-specific replacement tasks cover them.
 */
export const SUPPRESS_DURING_SLEEP = ['review-predictions', 'subconscious-impulse', 'subconscious-introspection'] as const;

/** Defense in depth: required deps must be present at the factory boundary. */
function assertRequiredDeps(deps: Readonly<Record<string, unknown>>, names: ReadonlyArray<string>): void {
  for (const name of names) {
    if (deps[name] === undefined || deps[name] === null) {
      throw new Error(`scheduler handler deps missing required field: ${name}`);
    }
  }
}

/**
 * Build the system scheduler onDue handler.
 *
 * Expires stale predictions, gates hourly review jobs on recent agent traces
 * (shouldSkipReview), runs the introspection continuation loop on a budget
 * shared with the impulse path, and routes all other tasks through
 * buildAgentScheduledEvent into the scheduler sink. Fire-and-forget: the
 * handler returns void and never throws into the scheduler tick.
 */
export function createSystemTaskHandler(deps: Readonly<SchedulerHandlerDeps>): SchedulerTaskHandler {
  assertRequiredDeps(deps, ['owner', 'agent', 'predictionStore', 'traceStore', 'interestRegistry', 'schedulerSink']);
  const { owner, agent, predictionStore, traceStore, interestRegistry, schedulerSink, continuationBudget, continuationJudge } = deps;

  return (task: SchedulerTask): void => {
    (async () => {
      try {
        const expiredCount = await predictionStore.expireStalePredictions(
          owner,
          new Date(Date.now() - 24 * 3600_000),
        );
        if (expiredCount > 0) {
          console.log(`review job: expired ${expiredCount} stale predictions`);
        }
      } catch (error) {
        console.warn('review job: failed to expire stale predictions', error);
      }

      // Before building the review event, check if there's been any activity
      if (task.name === 'review-predictions') {
        const recentTraces = await traceStore.queryTraces({
          owner,
          lookbackSince: new Date(Date.now() - 2 * 3600_000),
          limit: 1,
        });

        if (shouldSkipReview(recentTraces.length)) {
          console.log('[review-gate] skipping review-predictions: no agent-initiated traces since last window');
          return;
        }

        continuationBudget?.resetEvent();
        const roundStart = new Date();
        const event = await buildReviewEvent(task, traceStore, owner);
        const responseText = await agent.processEvent(event);

        // Introspection continuation loop (shared budget with impulse — AC5.2)
        if (continuationBudget && continuationJudge) {
          await runContinuationLoop(
            {
              judge: continuationJudge,
              budget: continuationBudget,
              queryTraces: (since) => traceStore.queryTraces({ owner, lookbackSince: since, limit: 20 }),
              queryInterests: () => interestRegistry.listInterests(owner, { status: 'active' }),
              assembleEvent: () => buildReviewEvent(task, traceStore, owner),
              processEvent: (e) => agent.processEvent(e),
              eventType: 'introspection',
              // No onHousekeeping — engagement decay is impulse-specific
            },
            responseText,
            roundStart,
          );
        }
        return;
      }

      const event = await buildAgentScheduledEvent(task, traceStore, owner);

      schedulerSink.queue.push(event);
      schedulerSink.drain().catch((error) => {
        console.error('scheduler event processing error:', error);
      });
    })();
  };
}

/**
 * Build the agent scheduler onDue handler: every due task becomes an
 * agent-scheduled event queued into the scheduler sink. Fire-and-forget.
 */
export function createAgentTaskHandler(deps: Readonly<SchedulerHandlerDeps>): SchedulerTaskHandler {
  assertRequiredDeps(deps, ['owner', 'traceStore', 'schedulerSink']);
  const { owner, traceStore, schedulerSink } = deps;

  return (task: SchedulerTask): void => {
    (async () => {
      try {
        const event = await buildAgentScheduledEvent(task, traceStore, owner);
        schedulerSink.queue.push(event);
        schedulerSink.drain().catch((error) => {
          console.error('agent scheduler event processing error:', error);
        });
      } catch (error) {
        console.error('agent scheduler onDue error:', error);
      }
    })();
  };
}

/**
 * Build the sleep task handler: routes sleep tasks to the correct event
 * builder using flagged events, and routes sleep-archivist to the archivist
 * sub-agent when one exists. Fire-and-forget.
 */
export function createSleepTaskHandler(deps: Readonly<SchedulerHandlerDeps>): SchedulerTaskHandler {
  assertRequiredDeps(deps, ['schedulerSink']);
  const activityManager = deps.activityManager;
  if (!activityManager) {
    throw new Error('scheduler handler deps missing required field: activityManager');
  }
  const { archivistAgent, schedulerSink } = deps;

  return (task: SchedulerTask): void => {
    (async () => {
      const flaggedEvents = await activityManager.getFlaggedEvents();
      let event;

      switch (task.name) {
        case 'sleep-compaction':
          event = buildCompactionEvent(flaggedEvents, new Date());
          break;
        case 'sleep-prediction-review':
          event = buildPredictionReviewEvent(flaggedEvents, new Date());
          break;
        case 'sleep-pattern-analysis':
          event = buildPatternAnalysisEvent(flaggedEvents, new Date());
          break;
        case 'sleep-archivist':
          event = buildArchivistEvent(flaggedEvents, new Date());
          if (archivistAgent) {
            // Route to archivist sub-agent
            archivistAgent.processEvent(event).catch((error) => {
              console.error('[archivist] full pipeline event error:', error);
            });
            return; // Don't queue to main agent
          }
          break;
        default:
          console.warn(`[activity] unknown sleep task: ${task.name}`);
          return;
      }

      schedulerSink.queue.push(event);
      schedulerSink.drain().catch((error) => {
        console.error(`sleep task event processing error (${task.name}):`, error);
      });
    })().catch((error) => {
      console.error(`[activity] sleep task error (${task.name}):`, error);
    });
  };
}

/**
 * Build the post-impulse housekeeping routine: engagement decay plus the
 * active-interest cap. Errors are logged, never propagated.
 */
export function createPostImpulseHousekeeping(deps: Readonly<SchedulerHandlerDeps>): () => Promise<void> {
  assertRequiredDeps(deps, ['owner', 'interestRegistry']);
  const { interestRegistry, owner, engagementHalfLifeDays, maxActiveInterests } = deps;

  return async function runPostImpulseHousekeeping(): Promise<void> {
    try {
      await interestRegistry.applyEngagementDecay(owner, engagementHalfLifeDays);

      const dormanted = await interestRegistry.enforceActiveInterestCap(owner, maxActiveInterests);

      if (dormanted.length > 0) {
        console.log(`[subconscious] ${dormanted.length} interest(s) transitioned to dormant (cap: ${maxActiveInterests})`);
      }
    } catch (error) {
      console.error('[subconscious] housekeeping error:', error);
    }
  };
}

/**
 * Build the activity-aware system handler: routes sleep tasks to the sleep
 * task handler, subconscious-impulse through the impulse assembler with the
 * shared continuation budget, subconscious-introspection through the
 * introspection assembler, archivist-incremental to the pipeline, and
 * everything else to the fallback system handler. Fire-and-forget.
 */
export function createActivityAwareSystemHandler(deps: Readonly<ActivityAwareSystemHandlerDeps>): SchedulerTaskHandler {
  assertRequiredDeps(deps, ['owner', 'traceStore', 'interestRegistry', 'schedulerSink', 'systemHandler']);
  const activityManager = deps.activityManager;
  if (!activityManager) {
    throw new Error('scheduler handler deps missing required field: activityManager');
  }
  const {
    owner,
    subconsciousAgent,
    impulseAssembler,
    introspectionAssembler,
    archivistPipeline,
    continuationBudget,
    continuationJudge,
    traceStore,
    interestRegistry,
    systemHandler,
  } = deps;
  const sleepTaskHandler = createSleepTaskHandler(deps);
  const runPostImpulseHousekeeping = createPostImpulseHousekeeping(deps);

  return (task: SchedulerTask): void => {
    if (isSleepTask(task.name)) {
      sleepTaskHandler(task);
    } else if (task.name === 'subconscious-impulse' && subconsciousAgent && impulseAssembler) {
      (async () => {
        try {
          continuationBudget?.resetEvent();
          const roundStart = new Date();
          const event = await impulseAssembler.assembleImpulse();
          const responseText = await subconsciousAgent.processEvent(event);
          await runPostImpulseHousekeeping();

          // Continuation loop (best-effort, errors don't break normal flow)
          if (continuationBudget && continuationJudge) {
            await runContinuationLoop(
              {
                judge: continuationJudge,
                budget: continuationBudget,
                queryTraces: (since) => traceStore.queryTraces({ owner, lookbackSince: since, limit: 20 }),
                queryInterests: () => interestRegistry.listInterests(owner, { status: 'active' }),
                assembleEvent: () => impulseAssembler.assembleImpulse(),
                processEvent: (e) => subconsciousAgent.processEvent(e),
                onHousekeeping: runPostImpulseHousekeeping,
                eventType: 'impulse',
              },
              responseText,
              roundStart,
            );
          }
        } catch (error) {
          console.error('impulse event processing error:', error);
        }
      })().catch((error) => {
        console.error('impulse task error:', error);
      });
    } else if (task.name === 'subconscious-introspection' && subconsciousAgent && introspectionAssembler) {
      (async () => {
        try {
          const event = await introspectionAssembler.assembleIntrospection();
          await subconsciousAgent.processEvent(event);
        } catch (error) {
          console.error('introspection event processing error:', error);
        }
      })().catch((error) => {
        console.error('introspection task error:', error);
      });
    } else if (task.name === 'archivist-incremental' && archivistPipeline) {
      (async () => {
        try {
          console.log('[archivist] running incremental pipeline');
          const result = await archivistPipeline.runIncremental();
          console.log(`[archivist] incremental complete: scanned=${result.scanned}, deduped=${result.deduped}, pruned=${result.pruned}`);
        } catch (error) {
          console.error('[archivist] incremental pipeline error:', error);
        }
      })().catch((error) => {
        console.error('[archivist] incremental task error:', error);
      });
    } else {
      systemHandler(task);
    }
  };
}

/**
 * Build the sleep/wake transition handler registered as onTransition on the
 * activity dispatch: transition-to-sleep dispatches the subconscious wrap-up
 * and housekeeping, then transitions to sleeping; transition-to-wake resets
 * the continuation budget cycle, dispatches the morning agenda, then runs
 * the wake drain. Fire-and-forget.
 */
export function createTransitionHandler(deps: Readonly<TransitionHandlerDeps>): (task: { name: string }) => void {
  const activityManager = deps.activityManager;
  if (!activityManager) {
    throw new Error('scheduler handler deps missing required field: activityManager');
  }
  const { subconsciousAgent, impulseAssembler, continuationBudget, wakeHandler } = deps;
  const runPostImpulseHousekeeping = createPostImpulseHousekeeping(deps);

  return (task: { name: string }): void => {
    (async () => {
      if (task.name === 'transition-to-sleep') {
        // Dispatch wrap-up to subconscious before sleep
        if (subconsciousAgent && impulseAssembler) {
          try {
            const wrapUpEvent = await impulseAssembler.assembleWrapUp();
            await subconsciousAgent.processEvent(wrapUpEvent);
            await runPostImpulseHousekeeping();
          } catch (error) {
            console.error('[subconscious] wrap-up error:', error);
          }
        }
        await activityManager.transitionTo('sleeping');
        console.log('[activity] transitioned to sleeping mode');
      } else if (task.name === 'transition-to-wake') {
        // Reset continuation budget for new wake cycle
        continuationBudget?.resetCycle();

        // Dispatch morning agenda to subconscious before queue drain
        if (subconsciousAgent && impulseAssembler) {
          try {
            const morningEvent = await impulseAssembler.assembleMorningAgenda();
            await subconsciousAgent.processEvent(morningEvent);
            await runPostImpulseHousekeeping();
          } catch (error) {
            console.error('[subconscious] morning agenda error:', error);
          }
        }
        await wakeHandler();
      }
    })().catch((error) => {
      console.error('[activity] transition error:', error);
    });
  };
}

/**
 * Register scheduler onDue handlers on both schedulers, replicating the
 * composition root's registration wiring.
 *
 * With an activity manager, both schedulers are wrapped in the activity
 * dispatch (createActivityDispatch) and only the system side suppresses
 * SUPPRESS_DURING_SLEEP tasks during sleep; the agent side passes no
 * suppress list, so unsuppressed tasks queue instead. Without an activity
 * manager, the raw handlers are registered directly.
 *
 * Registration must complete before scheduler.start().
 */
export function registerSchedulerHandlers(deps: Readonly<SchedulerRegistrationDeps>): void {
  assertRequiredDeps(
    deps,
    ['owner', 'agent', 'predictionStore', 'traceStore', 'interestRegistry', 'schedulerSink', 'systemScheduler', 'agentScheduler', 'trickleDelayMs'],
  );
  const { systemScheduler, agentScheduler } = deps;

  const systemTaskHandler = createSystemTaskHandler(deps);
  const agentTaskHandler = createAgentTaskHandler(deps);

  if (deps.activityManager) {
    // Capture narrowed reference for use in closures (avoids non-null assertions)
    const am = deps.activityManager;

    // Activity-aware dispatch: wraps original handlers
    const wakeHandler = createWakeHandler({
      activityManager: am,
      onEvent: async (event) => {
        const externalEvent = queuedEventToExternal(event);
        deps.schedulerSink.queue.push(externalEvent);
        deps.schedulerSink.drain().catch((error) => {
          console.error('wake drain event processing error:', error);
        });
      },
      trickleDelayMs: deps.trickleDelayMs,
    });

    const handleTransition = createTransitionHandler({ ...deps, activityManager: am, wakeHandler });

    // Register activity-aware handlers BEFORE scheduler.start()
    systemScheduler.onDue(createActivityDispatch({
      activityManager: am,
      originalHandler: createActivityAwareSystemHandler({ ...deps, activityManager: am, systemHandler: systemTaskHandler }),
      onTransition: handleTransition,
      suppressDuringSleep: SUPPRESS_DURING_SLEEP,
    }));

    agentScheduler.onDue(createActivityDispatch({
      activityManager: am,
      originalHandler: agentTaskHandler,
      onTransition: handleTransition,
    }));
  } else {
    // No activity: register original handlers directly
    systemScheduler.onDue(systemTaskHandler);
    agentScheduler.onDue(agentTaskHandler);
  }
}
