// pattern: Imperative Shell

import type { TraceRecorder } from '@/reflexion/types.js';
import type {
  LoopDetectionConfig,
  LoopDetectionResult,
  LoopDetector,
} from './types.js';
import { createResponseWindow } from './window.js';

export type CreateLoopDetectorOptions = {
  readonly config: LoopDetectionConfig;
  readonly traceRecorder?: TraceRecorder;
  readonly owner?: string;
  readonly conversationId?: string;
};

export function createLoopDetector(
  options: CreateLoopDetectorOptions,
): LoopDetector {
  const {
    config,
    traceRecorder,
    owner = 'spirit',
    conversationId = '',
  } = options;
  const window = createResponseWindow(config.windowSize);

  function check(response: string): LoopDetectionResult {
    if (!config.enabled) {
      return {
        triggered: false,
        similarity: 0,
        consecutiveCount: 0,
        action: null,
      };
    }

    window.push(response);
    const result = window.check(
      config.similarityThreshold,
      config.consecutiveTrigger,
    );

    if (result.triggered) {
      if (traceRecorder) {
        traceRecorder
          .record({
            owner,
            conversationId,
            toolName: 'loop_detection',
            input: {
              similarity: result.maxSimilarity,
              consecutiveCount: result.consecutiveCount,
              threshold: config.similarityThreshold,
              consecutiveTrigger: config.consecutiveTrigger,
              action: config.action,
            },
            outputSummary: `Loop detected: ${result.consecutiveCount} consecutive similar responses (similarity: ${(result.maxSimilarity * 100).toFixed(0)}%). Action: ${config.action}`,
            durationMs: 0,
            success: false,
            error: `Circuit breaker triggered: ${config.action}`,
          })
          .catch(() => {});
      }

      return {
        triggered: true,
        similarity: result.maxSimilarity,
        consecutiveCount: result.consecutiveCount,
        action: config.action,
      };
    }

    return {
      triggered: false,
      similarity: result.maxSimilarity,
      consecutiveCount: result.consecutiveCount,
      action: null,
    };
  }

  function reset(): void {
    window.reset();
  }

  return { check, reset };
}
