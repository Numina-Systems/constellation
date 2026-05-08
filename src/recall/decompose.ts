// pattern: Functional Core

/**
 * Pure parser for message decomposition responses.
 * Parses JSON responses into semantic queries and named entities.
 */

import type { DecompositionResult } from './types.js';

/**
 * Pure function that parses the model's JSON response.
 * Expects { "queries": [...], "entities": [...] }.
 * On parse failure or malformed structure, returns the fallback: { queries: [], entities: [] }.
 * Empty queries AND entities is the failure signal.
 * Filters out empty strings from both arrays to prevent meaningless queries.
 */
export function parseDecompositionResponse(raw: string): DecompositionResult {
  try {
    const parsed = JSON.parse(raw);

    // Validate structure
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray(parsed.queries) &&
      Array.isArray(parsed.entities) &&
      parsed.queries.every((q: unknown) => typeof q === 'string') &&
      parsed.entities.every((e: unknown) => typeof e === 'string')
    ) {
      return {
        queries: parsed.queries.filter((q: string) => q.length > 0) as ReadonlyArray<string>,
        entities: parsed.entities.filter((e: string) => e.length > 0) as ReadonlyArray<string>,
      };
    }
  } catch {
    // JSON parse error or validation failure
  }

  // Fallback: empty result signals decomposition failure
  return {
    queries: [],
    entities: [],
  };
}
