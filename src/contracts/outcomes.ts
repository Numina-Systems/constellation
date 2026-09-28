// pattern: Functional Core

/**
 * Bounded, provider-neutral outcomes shared across effectful boundaries.
 */
export type OutcomeDetails = Readonly<Record<string, string | number | boolean | null>>;

export type TransactionPublicationDetails = OutcomeDetails & Readonly<{
  readonly attempted: number;
  readonly skipped: number;
}>;

export type ToolOutcome =
  | { readonly kind: 'success'; readonly output: string; readonly details?: OutcomeDetails }
  | { readonly kind: 'error'; readonly code: string; readonly message: string; readonly details?: OutcomeDetails }
  | { readonly kind: 'cancelled'; readonly code: 'cancelled' | 'deadline_exceeded'; readonly message: string; readonly details?: OutcomeDetails }
  | { readonly kind: 'outcome_unknown'; readonly code: string; readonly message: string; readonly details?: OutcomeDetails };

export type TransactionTruth = 'committed' | 'rolled_back' | 'unknown';

export type TransactionReconciliation<TResult> =
  | { readonly truth: 'committed'; readonly value?: TResult }
  | { readonly truth: 'rolled_back'; readonly error?: unknown }
  | { readonly truth: 'unknown'; readonly error: unknown };

export type TransactionOutcome<TResult> =
  | { readonly status: 'confirmed_commit'; readonly value: TResult }
  | { readonly status: 'confirmed_rollback'; readonly error: unknown }
  | { readonly status: 'commit_unknown'; readonly error: unknown; readonly value?: TResult }
  | { readonly status: 'reconciled_commit'; readonly value: TResult; readonly error: unknown }
  | { readonly status: 'reconciled_rollback'; readonly error: unknown }
  | { readonly status: 'committed_publication_failed'; readonly value: TResult; readonly error: unknown; readonly details?: TransactionPublicationDetails }
  | { readonly status: 'provisional'; readonly value: TResult };

const MAX_OUTCOME_TEXT_BYTES = 64 * 1024;
const MAX_OUTCOME_DETAILS = 32;
const MAX_DETAIL_TEXT_BYTES = 4096;

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string';
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Validate untrusted runtime data before it crosses the tool/result boundary. */
export function parseToolOutcome(value: unknown): ToolOutcome {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('invalid tool outcome: expected an outcome object');
  }
  const candidate = value as Record<string, unknown>;
  const kind = candidate['kind'];
  if (kind === 'success') {
    const output = candidate['output'];
    if (typeof output !== 'string' || byteLength(output) > MAX_OUTCOME_TEXT_BYTES) {
      throw new Error('invalid tool outcome: success output exceeds byte bound');
    }
    return {kind, output, details: parseDetails(candidate['details'])};
  }
  if (kind === 'error' || kind === 'cancelled' || kind === 'outcome_unknown') {
    const code = candidate['code'];
    const message = candidate['message'];
    if (typeof code !== 'string' || !/^[a-z][a-z0-9_.-]{0,127}$/.test(code) ||
        typeof message !== 'string' || byteLength(message) > MAX_OUTCOME_TEXT_BYTES ||
        (kind === 'cancelled' && code !== 'cancelled' && code !== 'deadline_exceeded')) {
      throw new Error('invalid tool outcome: code or message is invalid');
    }
    return {kind, code: code as never, message, details: parseDetails(candidate['details'])};
  }
  throw new Error('invalid tool outcome: unknown kind');
}

/** Runtime type guard for data loaded from persistence or an MCP transport. */
export function isToolOutcome(value: unknown): value is ToolOutcome {
  try { parseToolOutcome(value); return true; } catch { return false; }
}

function parseDetails(value: unknown): OutcomeDetails | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid tool outcome: details must be an object');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_OUTCOME_DETAILS) throw new Error('invalid tool outcome: too many details');
  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, detail] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(key) || !isScalar(detail) ||
        (typeof detail === 'string' && byteLength(detail) > MAX_DETAIL_TEXT_BYTES)) {
      throw new Error('invalid tool outcome: detail is invalid');
    }
    details[key] = detail;
  }
  return details;
}
