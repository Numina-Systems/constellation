// pattern: Imperative Shell

import type { ContinuationJudge, ContinuationJudgeContext } from './continuation';
import type { ContinuationBudget } from './continuation-budget';
import type { OperationTrace } from '@/reflexion/types';
import type { Interest } from './types';
import type { ExternalEvent } from '@/agent/types';

export type ContinuationLoopDeps = {
  readonly judge: ContinuationJudge;
  readonly budget: ContinuationBudget;
  readonly queryTraces: (since: Date) => Promise<ReadonlyArray<OperationTrace>>;
  readonly queryInterests: () => Promise<ReadonlyArray<Interest>>;
  readonly assembleEvent: () => Promise<ExternalEvent>;
  readonly processEvent: (event: ExternalEvent) => Promise<string>;
  readonly onHousekeeping?: () => Promise<void>;
  readonly eventType: 'impulse' | 'introspection';
  readonly log?: (message: string) => void;
};

export async function runContinuationLoop(
  deps: Readonly<ContinuationLoopDeps>,
  initialResponse: string,
  roundStart: Date,
): Promise<void> {
  const log = deps.log ?? console.log;

  try {
    let agentResponse = initialResponse;
    let currentRoundStart = roundStart;

    while (deps.budget.canContinue()) {
      // Query traces and interests for current state
      const traces = await deps.queryTraces(currentRoundStart);
      const interests = await deps.queryInterests();

      // Build judge context with current response and state
      const context: ContinuationJudgeContext = {
        agentResponse,
        traces,
        interests,
        eventType: deps.eventType,
      };

      // Ask judge whether to continue
      const decision = await deps.judge.evaluate(context);

      if (!decision.shouldContinue) {
        log(`[continuation] ${deps.eventType} continuation stopped: ${decision.reason}`);
        break;
      }

      // Spend budget and log decision
      deps.budget.spend();
      log(`[continuation] ${deps.eventType} continuation round (reason: ${decision.reason})`);

      // Update round start for next query
      currentRoundStart = new Date();

      // Assemble new event and process it
      const event = await deps.assembleEvent();
      agentResponse = await deps.processEvent(event);

      // Run post-impulse housekeeping if provided
      await deps.onHousekeeping?.();
    }
  } catch (error) {
    const errorMessage = error instanceof Error
      ? `${error.message}\n${error.stack}`
      : String(error);
    log(`[continuation] loop error: ${errorMessage}`);
    // Loop exits on error — per-round recovery is a future enhancement (see AC4.4 design notes)
  }
}
