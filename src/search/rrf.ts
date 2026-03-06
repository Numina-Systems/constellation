// pattern: Functional Core

import { type DomainSearchResult, type SearchResult } from './types.ts';

/**
 * Merges multiple ranked result lists using Reciprocal Rank Fusion (RRF).
 *
 * RRF score formula: for each result, sum of `1 / (k + rank)` across all lists the result appears in.
 * Results are identified by their `id` field.
 *
 * Results appearing in multiple lists (e.g., keyword and vector search, or results from different domains)
 * have their scores summed, resulting in higher overall scores.
 * Results appearing in only one list still receive a score and appear in output.
 *
 * @param domainLists - Array of pre-sorted result lists from different search modes/domains
 * @param k - Smoothing constant (default: 60). Higher k reduces the impact of rank position.
 * @returns Unified results sorted by RRF score descending, with each result's score field set to its RRF score
 */
export function mergeWithRRF(
  domainLists: ReadonlyArray<ReadonlyArray<DomainSearchResult>>,
  k: number = 60,
): ReadonlyArray<SearchResult> {
  // Map from result ID to { result data, accumulated RRF score }
  const resultMap = new Map<
    string,
    { result: DomainSearchResult; rrfScore: number }
  >();

  // Process each domain list: assign ranks (1-based) and accumulate RRF scores
  for (const list of domainLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const result = list[rank]!;
      const rrfScore = 1 / (k + rank + 1); // rank is 0-based, convert to 1-based

      if (resultMap.has(result.id)) {
        // Result already seen in another list: sum the scores
        const existing = resultMap.get(result.id)!;
        existing.rrfScore += rrfScore;
      } else {
        // New result: store it
        resultMap.set(result.id, { result, rrfScore });
      }
    }
  }

  // Convert to array and sort by RRF score descending
  const merged = Array.from(resultMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ result, rrfScore }): SearchResult => ({
      domain: result.domain,
      id: result.id,
      content: result.content,
      score: rrfScore,
      metadata: result.metadata,
      createdAt: result.createdAt,
    }));

  return merged;
}
