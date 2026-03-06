// pattern: Functional Core

/**
 * Shared types for hybrid search + multi-domain memory retrieval.
 * These types define the domain model for the SearchStore port interface.
 */

export type SearchMode = 'semantic' | 'keyword' | 'hybrid';

export type SearchDomainName = 'memory' | 'conversations';

export type SearchParams = {
  query: string;
  mode: SearchMode;
  domains: ReadonlyArray<SearchDomainName>;
  embedding: ReadonlyArray<number> | null;
  limit: number;
  startTime: Date | null;
  endTime: Date | null;
  role: string | null;
  tier: string | null;
};

export type DomainSearchParams = {
  query: string;
  mode: SearchMode;
  domains: ReadonlyArray<SearchDomainName>;
  embedding: ReadonlyArray<number> | null;
  limit: number;
  startTime: Date | null;
  endTime: Date | null;
  role: string | null;
  tier: string | null;
};

export type SearchResultMetadata = {
  tier: string | null;
  label: string | null;
  role: string | null;
  conversationId: string | null;
};

export type DomainSearchResult = {
  id: string;
  domain: SearchDomainName;
  content: string;
  score: number;
  metadata: SearchResultMetadata;
  createdAt: Date;
};

export type SearchResult = {
  domain: SearchDomainName;
  id: string;
  content: string;
  score: number;
  metadata: SearchResultMetadata;
  createdAt: Date;
};

export type SearchDomain = {
  readonly name: SearchDomainName;
  search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>>;
};
