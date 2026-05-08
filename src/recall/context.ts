// pattern: Functional Core

/**
 * Context provider for reflexive recall.
 * Formats recalled fragments into system prompt sections.
 */

import type { ContextProvider } from '@/agent/types.js';
import type { RecallResult } from './types.js';

export type RecallContextState = {
  setResult(result: RecallResult | null): void;
};

/**
 * Formats a recall result into a system prompt section.
 * Returns a markdown-formatted section with header and fragments.
 *
 * @param result - The recall result containing fragments to format
 * @returns Formatted section as markdown string
 */
export function formatRecallSection(result: RecallResult): string {
  let output = '## Recalled Context\n\n';

  for (const fragment of result.fragments) {
    output += `### ${fragment.label} | ${fragment.domain}\n`;
    output += fragment.content;
    output += '\n\n';
  }

  return output;
}

/**
 * Creates a context provider for recall results.
 * Returns a provider function that can be called during system prompt building,
 * plus a setResult method for updating the current recall result.
 *
 * The provider returns undefined when no result is set or when fragments are empty,
 * which signals to buildSystemPrompt to skip appending any section.
 *
 * @returns Context provider with setResult state setter
 */
export function createRecallContextProvider(): ContextProvider & RecallContextState {
  let currentResult: RecallResult | null = null;

  const provider = (() => {
    if (!currentResult || currentResult.fragments.length === 0) {
      return undefined;
    }
    return formatRecallSection(currentResult);
  }) as ContextProvider & RecallContextState;

  provider.setResult = (result: RecallResult | null) => {
    currentResult = result;
  };

  return provider;
}
