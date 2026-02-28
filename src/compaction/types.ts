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

export type CompactionConfig = {
  readonly chunkSize: number;
  readonly keepRecent: number;
  readonly maxSummaryTokens: number;
  readonly clipFirst: number;
  readonly clipLast: number;
  readonly prompt: string | null;
};

export type Compactor = {
  compress(
    history: ReadonlyArray<ConversationMessage>,
    conversationId: string,
  ): Promise<CompactionResult>;
};
