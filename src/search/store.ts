// pattern: Functional Core

/**
 * SearchStore port interface.
 * This is the abstraction boundary for hybrid search and multi-domain memory retrieval.
 * Implementations must provide search across registered domains with RRF merging.
 */

import type {
  SearchDomain,
  SearchParams,
  SearchResult,
} from './types.ts';

export interface SearchStore {
  /**
   * Execute a search across registered domains with optional RRF merging.
   * Supports semantic, keyword, and hybrid modes.
   */
  search(params: SearchParams): Promise<ReadonlyArray<SearchResult>>;

  /**
   * Register a domain to be included in search operations.
   * Domains define their own search logic and filtering.
   */
  registerDomain(domain: SearchDomain): void;
}
