// pattern: Functional Core

/**
 * Recall types define the domain model for reflexive recall.
 * These types represent decomposition results and recall fragments
 * produced by the decomposition and recall pipelines.
 */

import type { SearchDomainName } from '@/search/types.js';

export type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};

export type RecallFragment = {
  readonly id: string;
  readonly label: string;
  readonly domain: SearchDomainName;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
  readonly tier: string | null;
};

export type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};
