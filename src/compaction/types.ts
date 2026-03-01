// pattern: Functional Core

/**
 * Compaction types define the domain model for context compression.
 * These types represent the port interface for the compaction pipeline,
 * configuration structures, and result values produced by compression.
 */

import type { ConversationMessage } from '../agent/types.js';

export type SummaryBatch = {
  readonly content: string;
  readonly depth: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly messageCount: number;
};

export type CompactionResult = {
  readonly history: ReadonlyArray<ConversationMessage>;
  readonly batchesCreated: number;
  readonly messagesCompressed: number;
  readonly tokensEstimateBefore: number;
  readonly tokensEstimateAfter: number;
};

export type ImportanceScoringConfig = {
  readonly roleWeightSystem: number;
  readonly roleWeightUser: number;
  readonly roleWeightAssistant: number;
  readonly recencyDecay: number;
  readonly questionBonus: number;
  readonly toolCallBonus: number;
  readonly keywordBonus: number;
  readonly importantKeywords: ReadonlyArray<string>;
  readonly contentLengthWeight: number;
};

export const DEFAULT_SCORING_CONFIG: ImportanceScoringConfig = {
  roleWeightSystem: 10.0,
  roleWeightUser: 5.0,
  roleWeightAssistant: 3.0,
  recencyDecay: 0.95,
  questionBonus: 2.0,
  toolCallBonus: 4.0,
  keywordBonus: 1.5,
  importantKeywords: ['error', 'fail', 'bug', 'fix', 'decision', 'agreed', 'constraint', 'requirement'],
  contentLengthWeight: 1.0,
};

export type CompactionConfig = {
  readonly chunkSize: number;
  readonly keepRecent: number;
  readonly maxSummaryTokens: number;
  readonly clipFirst: number;
  readonly clipLast: number;
  readonly prompt: string | null;
  readonly scoring?: ImportanceScoringConfig;
};

export type Compactor = {
  compress(
    history: ReadonlyArray<ConversationMessage>,
    conversationId: string,
  ): Promise<CompactionResult>;
};
