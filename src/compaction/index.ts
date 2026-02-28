// pattern: Functional Core

/**
 * Compaction module barrel export.
 * Re-exports all public types and utilities for the context compression system.
 */

export type { SummaryBatch, CompactionResult, CompactionConfig, Compactor } from './types.js';
export type { InterpolatePromptOptions } from './prompt.js';
export { DEFAULT_SUMMARIZATION_PROMPT, interpolatePrompt } from './prompt.js';
