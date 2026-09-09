// pattern: Functional Core

/**
 * Compaction types define the domain model for context compression.
 * These types represent the port interface for the compaction pipeline,
 * configuration structures, and result values produced by compression.
 */

import type { ConversationMessage } from '../agent/types.js';
import type { ConversationHistoryStore } from '../persistence/conversation-history-store.js';
import type { BreakerStatus } from './breaker.js';

export type CompactionFailureCode =
  | 'unfittable'
  | 'summary_empty'
  | 'deadline_exceeded'
  | 'cancelled'
  | 'history_stale_revision'
  | 'history_stale_membership'
  | 'history_state_unknown'
  | 'intervention_required'
  | 'breaker_open'
  | 'durability_required'
  | 'transient';

export class CompactionDurabilityRequiredError extends Error {
  readonly code = 'durability_required' as const;
  constructor(message = 'durable history store is required for compaction') {
    super(message);
    this.name = 'CompactionDurabilityRequiredError';
  }
}

export class CompactionUnfittableError extends Error {
  readonly code = 'unfittable' as const;
  constructor(message = 'compaction summary request is unfittable') {
    super(message);
    this.name = 'CompactionUnfittableError';
  }
}

export class CompactionSummaryEmptyError extends Error {
  readonly code = 'summary_empty' as const;
  constructor(message = 'compaction summary output was empty or contained no text') {
    super(message);
    this.name = 'CompactionSummaryEmptyError';
  }
}

export type SummaryBatch = {
  readonly content: string;
  readonly depth: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly messageCount: number;
  readonly sourceMessageIds?: ReadonlyArray<string>;
  readonly provenanceRef?: string | null;
};

export type CompactionResult = {
  readonly history: ReadonlyArray<ConversationMessage>;
  readonly batchesCreated: number;
  readonly messagesCompressed: number;
  readonly tokensEstimateBefore: number;
  readonly tokensEstimateAfter: number;
  readonly failed?: boolean;
  readonly failureCode?: CompactionFailureCode;
  readonly operationId?: string | null;
  readonly archiveIds?: ReadonlyArray<string>;
  readonly provenanceRefs?: ReadonlyArray<string>;
  readonly revision?: number;
  readonly recoveryNote?: string | null;
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
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly backoffBaseMs?: number;
  readonly maxChunkTokens?: number;
  readonly maxConsecutiveFailures?: number;
  readonly cooldownMs?: number;
  readonly contextWindow?: number;
  readonly safetyMargin?: number;
  readonly continuationMaxChars?: number;
};

export type CompactionRequestOptions = Readonly<{
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}>;

export type CompactionPreparationOptions = Readonly<{
  readonly request?: CompactionRequestOptions;
}>;

export type CompactorStatus = Readonly<{
  readonly breaker: BreakerStatus;
  readonly consecutiveFailures: number;
}>;

export type Compactor = {
  compress(
    history: ReadonlyArray<ConversationMessage>,
    conversationId: string,
    options?: CompactionPreparationOptions,
  ): Promise<CompactionResult>;
  readonly consecutiveFailures: number;
  readonly status?: () => CompactorStatus;
  readonly reset?: () => void;
};

export type CompactionStore = ConversationHistoryStore;
