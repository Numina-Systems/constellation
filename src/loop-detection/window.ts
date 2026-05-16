// pattern: Functional Core

import { tokenBigrams } from './bigrams.js';
import { jaccardSimilarity } from './similarity.js';

export type WindowEntry = {
  readonly text: string;
  readonly bigrams: Set<string>;
};

export type WindowCheckResult = {
  readonly triggered: boolean;
  readonly maxSimilarity: number;
  readonly consecutiveCount: number;
};

export type ResponseWindow = {
  push(response: string): void;
  check(threshold: number, consecutiveTrigger: number): WindowCheckResult;
  reset(): void;
  readonly size: number;
};

export function createResponseWindow(windowSize: number): ResponseWindow {
  const entries: Array<WindowEntry> = [];
  let consecutiveHighCount = 0;

  function push(response: string): void {
    const bigrams = tokenBigrams(response);
    entries.push({ text: response, bigrams });
    if (entries.length > windowSize) {
      entries.shift();
    }
  }

  function check(threshold: number, consecutiveTrigger: number): WindowCheckResult {
    if (entries.length < 2) {
      return { triggered: false, maxSimilarity: 0, consecutiveCount: 0 };
    }

    const latest = entries[entries.length - 1]!;
    let maxSimilarity = 0;

    for (let i = 0; i < entries.length - 1; i++) {
      const similarity = jaccardSimilarity(latest.bigrams, entries[i]!.bigrams);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    if (maxSimilarity >= threshold) {
      consecutiveHighCount++;
    } else {
      consecutiveHighCount = 0;
    }

    return {
      triggered: consecutiveHighCount >= consecutiveTrigger,
      maxSimilarity,
      consecutiveCount: consecutiveHighCount,
    };
  }

  function reset(): void {
    entries.length = 0;
    consecutiveHighCount = 0;
  }

  return {
    push,
    check,
    reset,
    get size() {
      return entries.length;
    },
  };
}
