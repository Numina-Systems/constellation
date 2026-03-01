// pattern: Functional Core

/**
 * Compaction module barrel export.
 * Re-exports all public types and utilities for the context compression system.
 */

export type { SummaryBatch, CompactionResult, CompactionConfig, Compactor, ImportanceScoringConfig } from './types.js';
export { DEFAULT_SCORING_CONFIG } from './types.js';
export type { BuildSummarizationRequestOptions, BuildResummarizationRequestOptions } from './prompt.js';
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_DIRECTIVE, buildSummarizationRequest, buildResummarizationRequest } from './prompt.js';
export { scoreMessage } from './scoring.js';
export type { CreateCompactorOptions } from './compactor.js';
export { createCompactor } from './compactor.js';
