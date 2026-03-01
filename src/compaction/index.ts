// pattern: Functional Core

/**
 * Compaction module barrel export.
 * Re-exports all public types and utilities for the context compression system.
 */

export type { SummaryBatch, CompactionResult, CompactionConfig, Compactor } from './types.js';
export type { BuildSummarizationRequestOptions, BuildResummarizationRequestOptions } from './prompt.js';
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_DIRECTIVE, buildSummarizationRequest, buildResummarizationRequest } from './prompt.js';
export type { CreateCompactorOptions } from './compactor.js';
export { createCompactor } from './compactor.js';
