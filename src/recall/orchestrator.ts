// pattern: Imperative Shell

/**
 * Orchestrator for the recall pipeline.
 * Coordinates decomposition, retrieval, tracing, and fallback behavior.
 * Implements guard conditions and fallback cascade per AC5 and AC6.
 */

import type { ModelProvider } from '@/model/types.js';
import type { SearchStore } from '@/search/store.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { TraceRecorder } from '@/reflexion/types.js';
import type { ExecutionOptions } from '@/contracts/execution.ts';
import type { RecallResult } from './types.js';
import { decomposeMessage } from './decomposer.js';
import { retrieveContext } from './retrieve.js';
import type { DecompositionResult } from './types.js';

export type RecallDeps = {
  readonly searchStore: SearchStore;
  readonly embedding: EmbeddingProvider | null;
  readonly model: ModelProvider | null;
  readonly modelName: string | null;
  readonly tokenBudget: number;
  readonly traceRecorder?: TraceRecorder;
  readonly owner?: string;
  readonly conversationId?: string;
  readonly coreLabels?: ReadonlyArray<string>;
  /** Caller-owned cancellation/deadline forwarded to decomposition. */
  readonly executionOptions?: ExecutionOptions;
};

/**
 * Main entry point for reflexive recall.
 * Implements guard conditions, decomposition with fallback, retrieval, and tracing.
 * Returns null if guard conditions fail or if retrieval produces no results.
 */
export async function performRecall(
  message: string,
  deps: RecallDeps,
): Promise<RecallResult | null> {
  const startTime = performance.now();

  // AC6.3: Guard condition — no embedding provider means no recall
  if (!deps.embedding) {
    return null;
  }

  // AC6.2: Guard condition — message too short
  if (message.length < 10) {
    return null;
  }

  // Decomposition with fallback
  let decomposition: DecompositionResult;

  if (deps.model && deps.modelName) {
    // Try to decompose message using model
    const modelDecomposition = await decomposeMessage(message, deps.model, deps.modelName, deps.executionOptions);

    // Check if decomposition signals failure (empty queries AND entities)
    if (modelDecomposition.queries.length === 0 && modelDecomposition.entities.length === 0) {
      // AC5.1, AC5.2: Fall back to raw message as query
      decomposition = {
        queries: [message],
        entities: [],
      };
    } else {
      decomposition = modelDecomposition;
    }
  } else {
    // AC6.4: No model available, skip decomposition and use raw message
    decomposition = {
      queries: [message],
      entities: [],
    };
  }

  // Retrieval
  const result = await retrieveContext({
    decomposition,
    searchStore: deps.searchStore,
    tokenBudget: deps.tokenBudget,
    coreLabels: deps.coreLabels,
  });

  // Calculate elapsed time
  const elapsed = performance.now() - startTime;

  // Trace recording (fire-and-forget, before null check)
  if (deps.traceRecorder && deps.owner && deps.conversationId) {
    deps.traceRecorder.record({
      owner: deps.owner,
      conversationId: deps.conversationId,
      toolName: 'recall',
      input: { message: message.slice(0, 100), queryCount: result.queryCount },
      outputSummary: `${result.fragments.length} fragments, ${result.totalTokens} tokens`,
      durationMs: elapsed,
      success: true,
      error: null,
    });
  }

  // Set elapsed time on result
  const finalResult: RecallResult = {
    ...result,
    elapsed,
  };

  // Return null if no fragments found
  if (finalResult.fragments.length === 0) {
    return null;
  }

  return finalResult;
}
