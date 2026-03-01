// pattern: Functional Core

/**
 * Shared types for web tools (search and fetch).
 * These types define the port interfaces that all search provider adapters normalise to
 * and the fetch pipeline result shape.
 */

export type SearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
};

export type SearchResponse = {
  readonly results: ReadonlyArray<SearchResult>;
  readonly provider: string;
};

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResponse>;
}

export type FetchResult = {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly total_length: number;
  readonly offset: number;
  readonly has_more: boolean;
};

export type FetchCacheEntry = {
  readonly url: string;
  readonly title: string;
  readonly markdown: string;
  readonly timestamp: number;
};
