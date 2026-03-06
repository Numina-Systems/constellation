// pattern: Functional Core

import type { SearchParams, SearchResult, SearchDomain } from './types.js';

export interface SearchStore {
  search(params: SearchParams): Promise<ReadonlyArray<SearchResult>>;
  registerDomain(domain: SearchDomain): void;
}
