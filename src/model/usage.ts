// pattern: Functional Core

import type {UsageStats} from "./types.js";

export type UsageSubsets = UsageStats & {readonly reasoning_output_tokens?: number | null};
export type AnthropicUsage = {readonly input_tokens?: number; readonly output_tokens?: number; readonly cache_creation_input_tokens?: number | null; readonly cache_read_input_tokens?: number | null};
export type OpenAIUsage = {readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly prompt_tokens_details?: {readonly cached_tokens?: number | null}; readonly completion_tokens_details?: {readonly reasoning_tokens?: number | null}};

function positive(value: number | null | undefined): number | null { return value === null || value === undefined ? null : Math.max(0, value); }

export function normalizeAnthropicUsage(usage: Readonly<AnthropicUsage> | null | undefined): UsageSubsets | null {
  if (!usage || (usage.input_tokens === undefined && usage.output_tokens === undefined && usage.cache_creation_input_tokens === undefined && usage.cache_read_input_tokens === undefined)) return null;
  const creation = positive(usage.cache_creation_input_tokens) ?? 0;
  const read = positive(usage.cache_read_input_tokens) ?? 0;
  return {input_tokens: (positive(usage.input_tokens) ?? 0) + creation + read, output_tokens: positive(usage.output_tokens) ?? 0, cache_creation_input_tokens: creation, cache_read_input_tokens: read};
}

export function normalizeOpenAIUsage(usage: Readonly<OpenAIUsage> | null | undefined): UsageSubsets | null {
  if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) return null;
  const cached = positive(usage.prompt_tokens_details?.cached_tokens);
  const reasoning = positive(usage.completion_tokens_details?.reasoning_tokens);
  return {input_tokens: positive(usage.prompt_tokens) ?? 0, output_tokens: positive(usage.completion_tokens) ?? 0, cache_read_input_tokens: cached, reasoning_output_tokens: reasoning};
}

export function normalizeOllamaUsage(promptTokens: number | null | undefined, outputTokens: number | null | undefined): UsageSubsets | null {
  if (promptTokens === undefined && outputTokens === undefined) return null;
  return {input_tokens: positive(promptTokens) ?? 0, output_tokens: positive(outputTokens) ?? 0};
}

/** Converts cumulative stream usage to a replacement, never an increment. */
export function replaceCumulativeUsage(previous: UsageSubsets | null, next: UsageSubsets | null): UsageSubsets | null {
  return next ?? previous;
}
