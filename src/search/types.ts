// pattern: Functional Core

export type SearchMode = 'semantic' | 'keyword' | 'hybrid';

export type SearchDomainName = 'memory' | 'conversations';

export type SearchParams = {
  readonly query: string;
  readonly mode: SearchMode;
  readonly domains: ReadonlyArray<SearchDomainName>;
  readonly embedding: ReadonlyArray<number> | null;
  readonly limit: number;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
  readonly role: string | null;
  readonly tier: string | null;
};

export type DomainSearchParams = SearchParams;

export type SearchResultMetadata = {
  readonly tier: string | null;
  readonly label: string | null;
  readonly role: string | null;
  readonly conversationId: string | null;
};

export type DomainSearchResult = {
  readonly id: string;
  readonly domain: SearchDomainName;
  readonly content: string;
  readonly score: number;
  readonly metadata: SearchResultMetadata;
  readonly createdAt: Date;
};

export type SearchResult = {
  readonly domain: SearchDomainName;
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: SearchResultMetadata;
  readonly createdAt: Date;
};

export type SearchDomain = {
  readonly name: SearchDomainName;
  search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>>;
};
