// pattern: Functional Core

import type {Message, ToolDefinition} from "./types.js";

export type BudgetParts = {
  readonly system?: string | null;
  readonly diary?: ReadonlyArray<string>;
  readonly recall?: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<string>;
  readonly snapshots?: ReadonlyArray<unknown>;
  readonly messages: ReadonlyArray<Message>;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly outputReserve: number;
  readonly contextWindow: number;
  readonly safetyMargin?: number;
};
export type RequestBudget = {readonly estimatedInputTokens: number; readonly outputReserve: number; readonly safetyMargin: number; readonly totalReservedTokens: number; readonly contextWindow: number; readonly fits: boolean; readonly estimatesAreHeuristic: true};
export type BudgetValidation = {readonly ok: true; readonly budget: RequestBudget} | {readonly ok: false; readonly code: "invalid_window" | "invalid_reserve" | "context_unfittable"; readonly message: string};

function serializedTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const serialized = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
  return Math.ceil((serialized?.length ?? 0) / 4);
}

export function defaultSafetyMargin(contextWindow: number): number {
  return Math.max(256, Math.ceil(contextWindow * 0.02));
}

export function estimateRequestTokens(parts: Readonly<BudgetParts>): number {
  const providerRelevant = {
    system: parts.system ?? null,
    diary: parts.diary ?? [],
    recall: parts.recall ?? [],
    skills: parts.skills ?? [],
    snapshots: parts.snapshots ?? [],
    messages: parts.messages,
    tools: parts.tools ?? [],
  };
  return serializedTokens(providerRelevant);
}

export function buildRequestBudget(parts: Readonly<BudgetParts>): BudgetValidation {
  if (!Number.isSafeInteger(parts.contextWindow) || parts.contextWindow <= 0) return {ok: false, code: "invalid_window", message: "context window must be a positive safe integer"};
  if (!Number.isSafeInteger(parts.outputReserve) || parts.outputReserve <= 0) return {ok: false, code: "invalid_reserve", message: "output reserve must be a positive safe integer"};
  const safetyMargin = parts.safetyMargin ?? defaultSafetyMargin(parts.contextWindow);
  if (!Number.isSafeInteger(safetyMargin) || safetyMargin < 0) return {ok: false, code: "invalid_reserve", message: "safety margin must be a non-negative safe integer"};
  if (parts.outputReserve + safetyMargin > parts.contextWindow) return {ok: false, code: "invalid_reserve", message: "output reserve plus safety margin exceeds the context window"};
  const estimatedInputTokens = estimateRequestTokens(parts);
  const totalReservedTokens = estimatedInputTokens + parts.outputReserve + safetyMargin;
  const budget: RequestBudget = {estimatedInputTokens, outputReserve: parts.outputReserve, safetyMargin, totalReservedTokens, contextWindow: parts.contextWindow, fits: totalReservedTokens <= parts.contextWindow, estimatesAreHeuristic: true};
  return budget.fits ? {ok: true, budget} : {ok: false, code: "context_unfittable", message: "mandatory request context plus output reserve and safety margin exceeds the context window"};
}

export function resolveContextWindow(options: Readonly<{explicit?: number; legacyMaxContextTokens?: number; isSummarizer?: boolean; inferenceWindow?: number; sameModel?: boolean}>): {readonly window: number | null; readonly warning: string | null; readonly diagnostic: string | null} {
  if (options.explicit !== undefined) return {window: options.explicit, warning: null, diagnostic: null};
  if (options.isSummarizer && !options.sameModel) return {window: null, warning: null, diagnostic: "summarization.context_window is required for a separately configured summarizer"};
  if (options.sameModel && options.inferenceWindow !== undefined) return {window: options.inferenceWindow, warning: null, diagnostic: null};
  if (options.legacyMaxContextTokens !== undefined) return {window: options.legacyMaxContextTokens, warning: "using operator-configured agent.max_context_tokens; provider context capability is not verified", diagnostic: null};
  return {window: null, warning: null, diagnostic: "a verified model context window or legacy agent.max_context_tokens is required"};
}
