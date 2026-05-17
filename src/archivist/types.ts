// pattern: Functional Core

import type { MemoryTier } from '@/memory/types.js';

export type BlockSnapshot = {
  readonly id: string;
  readonly label: string;
  readonly tier: MemoryTier;
  readonly content: string;
  readonly contentHash: string;
  readonly embedding: ReadonlyArray<number> | null;
};

export type ScanResult = {
  readonly blocks: ReadonlyArray<BlockSnapshot>;
  readonly scannedAt: Date;
};

export type DedupGroup = {
  readonly canonical: BlockSnapshot;
  readonly duplicates: ReadonlyArray<BlockSnapshot>;
  readonly similarity: number;
};

export type DedupResult = {
  readonly groups: ReadonlyArray<DedupGroup>;
  readonly skipped: boolean;
};

export type ConsolidateAction = {
  readonly group: DedupGroup;
  readonly mergedContent: string;
};

export type ConsolidateResult = {
  readonly actions: ReadonlyArray<ConsolidateAction>;
  readonly tokensUsed: number;
  readonly skipped: boolean;
};

export type CrossrefAction = {
  readonly blockId: string;
  readonly relatedLabels: ReadonlyArray<string>;
};

export type CrossrefResult = {
  readonly actions: ReadonlyArray<CrossrefAction>;
  readonly skipped: boolean;
};

export type PruneResult = {
  readonly prunedIds: ReadonlyArray<string>;
};

export type ReflectResult = {
  readonly reflection: string;
  readonly tokensUsed: number;
  readonly skipped: boolean;
};

export type PipelineMode = 'incremental' | 'full';

export type PipelineResult = {
  readonly mode: PipelineMode;
  readonly scanned: number;
  readonly deduped: number;
  readonly consolidated: number;
  readonly crossreffed: number;
  readonly pruned: number;
  readonly reflected: boolean;
  readonly totalTokensUsed: number;
};
