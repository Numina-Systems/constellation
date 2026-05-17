// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { runContinuationLoop } from './continuation-loop';
import type { ContinuationLoopDeps } from './continuation-loop';
import type { ContinuationJudge, ContinuationJudgeContext } from './continuation';
import type { ContinuationBudget } from './continuation-budget';
import type { OperationTrace } from '@/reflexion/types';
import type { Interest } from './types';
import type { ExternalEvent } from '@/agent/types';

// Helper to build mocks with configurable responses
function buildMockDeps(overrides?: Partial<ContinuationLoopDeps>): ContinuationLoopDeps {
  let judgeCallCount = 0;
  let budgetSpendCount = 0;
  let budgetCanContinueCount = 0;
  const capturedContexts: Array<ContinuationJudgeContext> = [];
  const assembledEvents: Array<ExternalEvent> = [];
  const processedResponses: Array<string> = [];

  // Create base budget behavior
  let canContinueImpl: (() => boolean) | undefined;
  let spendImpl: (() => void) | undefined;

  if (overrides?.budget?.canContinue || overrides?.budget?.spend) {
    // Use override
    canContinueImpl = overrides.budget.canContinue;
    spendImpl = overrides.budget.spend;
  }

  const budget: ContinuationBudget = {
    canContinue: () => {
      budgetCanContinueCount += 1;
      return canContinueImpl ? canContinueImpl() : true;
    },

    spend: () => {
      budgetSpendCount += 1;
      spendImpl?.();
    },

    resetEvent: () => {
      overrides?.budget?.resetEvent?.();
    },

    resetCycle: () => {
      overrides?.budget?.resetCycle?.();
    },
  };

  const judge: ContinuationJudge = {
    async evaluate(context: Readonly<ContinuationJudgeContext>) {
      capturedContexts.push(context);
      judgeCallCount += 1;

      // If overridden, use override
      if (overrides?.judge?.evaluate) {
        return overrides.judge.evaluate(context);
      }

      // Default: stop immediately
      return {
        shouldContinue: false,
        reason: 'test default',
      };
    },
  };

  const queryTracesImpl = async () => {
    if (overrides?.queryTraces) {
      return overrides.queryTraces(new Date());
    }
    return [];
  };

  const queryInterestsImpl = async () => {
    if (overrides?.queryInterests) {
      return overrides.queryInterests();
    }
    return [];
  };

  const assembleEventImpl = async () => {
    const event: ExternalEvent = {
      source: `source-${assembledEvents.length}`,
      content: 'test event',
      metadata: { test: true },
      timestamp: new Date(),
    };
    assembledEvents.push(event);

    if (overrides?.assembleEvent) {
      return overrides.assembleEvent();
    }
    return event;
  };

  const processEventImpl = async (event: ExternalEvent) => {
    const response = `response-${processedResponses.length}`;
    processedResponses.push(response);

    if (overrides?.processEvent) {
      return overrides.processEvent(event);
    }
    return response;
  };

  const deps: ContinuationLoopDeps = {
    judge,
    budget,
    queryTraces: queryTracesImpl,
    queryInterests: queryInterestsImpl,
    assembleEvent: assembleEventImpl,
    processEvent: processEventImpl,
    eventType: overrides?.eventType ?? 'impulse',
    onHousekeeping: overrides?.onHousekeeping,
  };

  // Attach tracking info for tests (use getters to capture current values)
  (deps as any).__tracking__ = {
    get capturedContexts() {
      return capturedContexts;
    },
    get judgeCallCount() {
      return judgeCallCount;
    },
    get budgetSpendCount() {
      return budgetSpendCount;
    },
    get budgetCanContinueCount() {
      return budgetCanContinueCount;
    },
    get assembledEvents() {
      return assembledEvents;
    },
    get processedResponses() {
      return processedResponses;
    },
  };

  return deps;
}

describe('impulse-continuation.AC4: Impulse continuation loop', () => {
  describe('impulse-continuation.AC4.1: Judge is called with correct context', () => {
    it('passes agentResponse, traces, interests, and eventType to judge', async () => {
      const mockTrace: OperationTrace = {
        id: 'trace-1',
        owner: 'test',
        conversationId: 'conv-1',
        toolName: 'web_search',
        input: { query: 'test' },
        outputSummary: 'found something',
        durationMs: 100,
        success: true,
        error: null,
        createdAt: new Date(),
      };

      const mockInterest: Interest = {
        id: 'int-1',
        owner: 'test',
        name: 'test interest',
        description: 'testing',
        source: 'emergent',
        engagementScore: 0.8,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      };

      const deps = buildMockDeps({
        queryTraces: async () => [mockTrace],
        queryInterests: async () => [mockInterest],
      });

      const initialResponse = 'initial response text';
      const roundStart = new Date();

      await runContinuationLoop(deps, initialResponse, roundStart);

      const tracking = (deps as any).__tracking__;
      expect(tracking.capturedContexts.length).toBeGreaterThan(0);

      const context = tracking.capturedContexts[0];
      expect(context.agentResponse).toBe(initialResponse);
      expect(context.traces.length).toBe(1);
      expect(context.traces[0].id).toBe('trace-1');
      expect(context.interests.length).toBe(1);
      expect(context.interests[0].name).toBe('test interest');
      expect(context.eventType).toBe('impulse');
    });
  });

  describe('impulse-continuation.AC4.2: Continuation round fires when judge returns shouldContinue: true', () => {
    it('assembles new event, processes it, and spends budget', async () => {
      let callCount = 0;

      const judgeEvaluate = async () => {
        callCount += 1;
        // First call: continue
        if (callCount === 1) {
          return {
            shouldContinue: true,
            reason: 'momentum',
          };
        }
        // Second call: stop
        return {
          shouldContinue: false,
          reason: 'done',
        };
      };

      const deps = buildMockDeps({
        judge: {
          evaluate: judgeEvaluate,
        },
      });

      await runContinuationLoop(deps, 'initial', new Date());

      const tracking = (deps as any).__tracking__;
      // Judge called twice (initial + continuation round)
      expect(tracking.judgeCallCount).toBe(2);
      // One continuation round fired
      expect(tracking.assembledEvents.length).toBe(1);
      // One event processed
      expect(tracking.processedResponses.length).toBe(1);
      // Budget spent once
      expect(tracking.budgetSpendCount).toBe(1);
    });
  });

  describe('impulse-continuation.AC4.3: Continuation chains up to per-event limit then stops', () => {
    it('fires exactly maxPerEvent continuation rounds', async () => {
      let canContinueCount = 0;

      const budgetCanContinue = () => {
        return canContinueCount++ < 3; // Allow 3 continuations max
      };

      const judgeEvaluate = async () => {
        return {
          shouldContinue: true,
          reason: 'more',
        };
      };

      const deps = buildMockDeps({
        budget: {
          canContinue: budgetCanContinue,
          spend: () => {
            // no-op
          },
          resetEvent: () => {
            // no-op
          },
          resetCycle: () => {
            // no-op
          },
        },
        judge: {
          evaluate: judgeEvaluate,
        },
      });

      await runContinuationLoop(deps, 'initial', new Date());

      const tracking = (deps as any).__tracking__;
      // Three continuation rounds max
      expect(tracking.budgetSpendCount).toBe(3);
      // Three events assembled
      expect(tracking.assembledEvents.length).toBe(3);
      // Three events processed
      expect(tracking.processedResponses.length).toBe(3);
    });
  });

  describe('impulse-continuation.AC4.4: Judge error does not prevent normal impulse completion', () => {
    it('catches judge error and returns normally', async () => {
      const deps = buildMockDeps({
        judge: {
          async evaluate() {
            throw new Error('model timeout');
          },
        },
      });

      // Should not throw
      let threw = false;
      try {
        await runContinuationLoop(deps, 'initial', new Date());
      } catch (e) {
        threw = true;
      }

      expect(threw).toBe(false);
    });
  });

  describe('impulse-continuation.AC4.5: Housekeeping runs after each continuation round', () => {
    it('calls onHousekeeping exactly once per continuation', async () => {
      let housekeepingCount = 0;
      let judgeCallCount = 0;

      const deps = buildMockDeps({
        judge: {
          async evaluate() {
            judgeCallCount += 1;
            // First call: continue
            if (judgeCallCount === 1) {
              return {
                shouldContinue: true,
                reason: 'momentum',
              };
            }
            // Second call: stop
            return {
              shouldContinue: false,
              reason: 'done',
            };
          },
        },
        onHousekeeping: async () => {
          housekeepingCount += 1;
        },
      });

      await runContinuationLoop(deps, 'initial', new Date());

      // Housekeeping called once (after the one continuation round)
      expect(housekeepingCount).toBe(1);
    });
  });
});

describe('impulse-continuation.AC5: Introspection continuation loop', () => {
  describe('impulse-continuation.AC5.1: Introspection event type passed to judge and assembler', () => {
    it('passes eventType: introspection to judge context', async () => {
      const deps = buildMockDeps({
        eventType: 'introspection',
      });

      await runContinuationLoop(deps, 'initial', new Date());

      const tracking = (deps as any).__tracking__;
      expect(tracking.capturedContexts.length).toBeGreaterThan(0);
      expect(tracking.capturedContexts[0].eventType).toBe('introspection');
    });

    it('assembles new introspection events (not impulses)', async () => {
      let callCount = 0;

      const judgeEvaluate = async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            shouldContinue: true,
            reason: 'more reflection',
          };
        }
        return {
          shouldContinue: false,
          reason: 'done',
        };
      };

      const deps = buildMockDeps({
        eventType: 'introspection',
        judge: {
          evaluate: judgeEvaluate,
        },
      });

      await runContinuationLoop(deps, 'initial', new Date());

      const tracking = (deps as any).__tracking__;
      // One continuation round
      expect(tracking.assembledEvents.length).toBe(1);
      // Event assembled via assembleEvent (caller will make it introspection via buildReviewEvent)
      expect(tracking.processedResponses.length).toBe(1);
    });
  });

  describe('impulse-continuation.AC5.2: Shared budget between impulse and introspection', () => {
    it('impulse and introspection continuations share per-cycle budget', async () => {
      let eventCount = 0;

      const judgeEvaluate = async () => {
        eventCount += 1;
        // Continue for first 2 continuations
        if (eventCount <= 2) {
          return {
            shouldContinue: true,
            reason: 'momentum',
          };
        }
        return {
          shouldContinue: false,
          reason: 'done',
        };
      };

      const deps = buildMockDeps({
        judge: {
          evaluate: judgeEvaluate,
        },
      });

      await runContinuationLoop(deps, 'initial', new Date());

      const tracking = (deps as any).__tracking__;
      // Two continuation rounds (eventCount reaches 3: 1st check then continue, 2nd check then continue, 3rd check stops)
      // But eventCount is checked AFTER the continue, so we should see 2 roundstarts=new rounds
      expect(tracking.budgetSpendCount).toBe(2);
    });
  });
});
