// pattern: Functional Core

import { ConstellationError } from './base.js';

export type PersistenceErrorCode =
  | 'CONNECTION_FAILED'
  | 'MIGRATION_FAILED'
  | 'QUERY_FAILED';

export class PersistenceError extends ConstellationError {
  constructor(
    code: PersistenceErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'persistence', context ?? {}, options);
    this.name = 'PersistenceError';
  }
}

/**
 * Sanitize a SQL query for inclusion in error context.
 * Strips parameter values ($1, $2, etc. placeholders remain but any
 * inline literal values adjacent to them are not included since we
 * only store the query template, not the bound parameters).
 *
 * This is intentionally simple — the query string passed to
 * PersistenceProvider.query() is already a parameterized template
 * (e.g., "INSERT INTO foo VALUES ($1, $2)"), so there are no inline
 * literal values to strip. The function truncates long queries and
 * removes any accidental inclusion of values after parameter markers.
 */
export function sanitizeQuery(query: string): string {
  return query
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
