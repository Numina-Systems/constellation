// pattern: Functional Core

/**
 * Compaction module barrel export.
 * Re-exports all public types and utilities for the context compression system.
 */

export type { SummaryBatch, CompactionResult, CompactionConfig, Compactor, ImportanceScoringConfig, CompactionFailureCode, CompactionRequestOptions, CompactionPreparationOptions, CompactorStatus, CompactionStore } from './types.js';
export { CompactionDurabilityRequiredError, CompactionSummaryEmptyError, CompactionUnfittableError } from './types.js';
export type { Breaker, BreakerClock, BreakerFault, BreakerOptions, BreakerState, BreakerStatus } from './breaker.js';
export { createCompactionBreaker } from './breaker.js';
export type { Continuation } from './continuation.js';
export { deriveContinuation } from './continuation.js';
export type { ExchangeGroup, GroupingResult, ProjectedExchange } from './grouping.js';
export { groupConversationExchanges, orderSelectedGroups, projectExchangeGroup, selectCompactionGroups } from './grouping.js';
export { DEFAULT_SCORING_CONFIG } from './types.js';
export type { BuildSummarizationRequestOptions, BuildResummarizationRequestOptions } from './prompt.js';
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_DIRECTIVE, buildSummarizationRequest, buildResummarizationRequest } from './prompt.js';
export { scoreMessage } from './scoring.js';
export type { CreateCompactorOptions } from './compactor.js';
export { createCompactor, chunkMessagesByTokenBudget, computeSummarizationOverhead } from './compactor.js';
export type { DurableCompactorOptions } from './durable.js';
export { runDurableCompaction } from './durable.js';
