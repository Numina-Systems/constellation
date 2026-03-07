// pattern: Functional Core

/**
 * Determines whether the review-predictions task should be skipped
 * based on whether any agent-initiated traces exist in the lookback window.
 *
 * Returns true when there are zero traces — meaning no agent activity
 * occurred and the review would be a wasted LLM call.
 *
 * Extracted as a named predicate for testability and readability.
 * If the gate logic grows (e.g., checking trace types, minimum thresholds),
 * this function is the single point of change.
 */
export function shouldSkipReview(traceCount: number): boolean {
  return traceCount === 0;
}
