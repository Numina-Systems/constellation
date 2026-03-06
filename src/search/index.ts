// pattern: Functional Core

export type {
  SearchMode,
  SearchDomainName,
  SearchParams,
  DomainSearchParams,
  SearchResultMetadata,
  DomainSearchResult,
  SearchResult,
  SearchDomain,
} from './types.ts';

export type { SearchStore } from './store.ts';

export { mergeWithRRF } from './rrf.ts';

export { createMemorySearchDomain } from './domains/memory.ts';
export { createConversationSearchDomain } from './domains/conversations.ts';
