// pattern: Imperative Shell
// Coordinates multiple async search calls, deduplicates results, applies budget constraints.
// Performs I/O (SearchStore.search()) and orchestrates the retrieval pipeline.

import type { SearchStore } from '@/search/store.js';
import type { SearchResult } from '@/search/types.js';
import type { DecompositionResult, RecallFragment, RecallResult } from './types.js';
import { estimateTokens } from '@/agent/context.js';

export type RetrieveOptions = {
  readonly decomposition: DecompositionResult;
  readonly searchStore: SearchStore;
  readonly tokenBudget: number;
  readonly coreLabels?: ReadonlyArray<string>;
};

type TaggedResult = SearchResult & { source: 'semantic' | 'entity' };

export async function retrieveContext(options: RetrieveOptions): Promise<RecallResult> {
  const { decomposition, searchStore, tokenBudget, coreLabels = [] } = options;

  // AC4.3: If no queries and no entities, return empty immediately
  if (decomposition.queries.length === 0 && decomposition.entities.length === 0) {
    return {
      fragments: [],
      totalTokens: 0,
      queryCount: 0,
      elapsed: 0,
    };
  }

  // Prepare all search calls
  const searchPromises: Array<Promise<TaggedResult[]>> = [];

  // AC2.1: Semantic queries (mode: hybrid, limit: 5)
  for (const query of decomposition.queries) {
    const promise = searchStore
      .search({
        query,
        mode: 'hybrid',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 5,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      })
      .then((results) =>
        results.map((r) => ({
          ...r,
          source: 'semantic' as const,
        }))
      );
    searchPromises.push(promise);
  }

  // AC2.2: Entity queries (mode: keyword, limit: 3)
  for (const entity of decomposition.entities) {
    const promise = searchStore
      .search({
        query: entity,
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 3,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      })
      .then((results) =>
        results.map((r) => ({
          ...r,
          source: 'entity' as const,
        }))
      );
    searchPromises.push(promise);
  }

  // Run all searches concurrently
  const allResults = await Promise.all(searchPromises);
  const flatResults = allResults.flat();

  // AC2.3: Deduplicate by id, keeping highest score
  const deduplicated = new Map<string, TaggedResult>();
  for (const result of flatResults) {
    const existing = deduplicated.get(result.id);
    if (!existing || result.score > existing.score) {
      deduplicated.set(result.id, result);
    } else if (result.score === existing.score && result.source === 'semantic') {
      // Prefer semantic source when scores are equal
      deduplicated.set(result.id, result);
    }
  }

  // Convert to array and sort by score descending
  const sortedResults = Array.from(deduplicated.values()).sort((a, b) => b.score - a.score);

  // AC3.3: Filter out results with labels in coreLabels
  const coreLabelsSet = new Set(coreLabels);
  const filtered = sortedResults.filter((result) => !coreLabelsSet.has(result.metadata.label ?? ''));

  // AC4: Apply token budget with truncation support
  const fragments: RecallFragment[] = [];
  let remainingBudget = tokenBudget;

  for (const result of filtered) {
    if (remainingBudget <= 0) {
      break;
    }

    const tokens = estimateTokens(result.content);

    if (tokens <= remainingBudget) {
      // Fragment fits fully
      fragments.push({
        id: result.id,
        label: result.metadata.label ?? 'unknown',
        domain: result.domain,
        content: result.content,
        score: result.score,
        source: result.source,
        tier: result.metadata.tier,
      });
      remainingBudget -= tokens;
    } else if (remainingBudget > 0) {
      // AC4.2: Truncate content to fit remaining budget
      const charEstimate = remainingBudget * 4;
      const truncated = result.content.substring(0, charEstimate);

      fragments.push({
        id: result.id,
        label: result.metadata.label ?? 'unknown',
        domain: result.domain,
        content: truncated,
        score: result.score,
        source: result.source,
        tier: result.metadata.tier,
      });
      remainingBudget = 0;
    }
  }

  // Calculate total tokens
  const totalTokens = fragments.reduce((sum, f) => sum + estimateTokens(f.content), 0);

  return {
    fragments,
    totalTokens,
    queryCount: decomposition.queries.length + decomposition.entities.length,
    elapsed: 0, // Timing handled by orchestrator in Phase 3
  };
}
