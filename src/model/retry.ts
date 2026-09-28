// pattern: Imperative Shell

import {ModelError} from "./types.js";

/** Retry logic with one caller-owned lifetime across attempts and backoff. */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export type RetryOptions = {
  readonly signal?: AbortSignal;
  readonly deadline?: number | null;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
};

const MAX_RETRY_AFTER_MS = 60_000;

/** Shared superset of transient errors recognized by the provider adapters. */
export function isRetryableModelError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; retryable?: unknown };
  if (candidate.name === "APIUserAbortError" || candidate.name === "AbortError") return false;
  if (candidate.name === "APIConnectionTimeoutError" || candidate.name === "RateLimitError") return true;
  if (typeof candidate.retryable === "boolean") return candidate.retryable;
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  if (typeof candidate.code === "string" && ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(candidate.code)) return true;
  if (typeof candidate.message === "string") {
    const message = candidate.message.toLowerCase();
    return message.includes("timeout") || message.includes("econnrefused") || message.includes("fetch failed") || message.includes("network");
  }
  return false;
}

function retryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("headers" in error)) return null;
  const headers = (error as { headers?: unknown }).headers;
  let value: string | null = null;
  if (headers instanceof Headers) value = headers.get("retry-after");
  else if (typeof headers === "object" && headers !== null && "get" in headers && typeof headers.get === "function") value = headers.get("retry-after");
  else if (typeof headers === "object" && headers !== null) {
    const record = headers as Record<string, unknown>;
    const raw = record["retry-after"] ?? record["Retry-After"];
    if (typeof raw === "string") value = raw;
  }
  if (!value) return null;
  const seconds = /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(seconds)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds));
}

function cancellationError(signal: AbortSignal | undefined, deadline: number | null | undefined): ModelError {
  const timedOut = deadline !== null && deadline !== undefined && Date.now() >= deadline;
  const reason = signal?.reason;
  const timeoutReason = reason instanceof DOMException && reason.name === "TimeoutError";
  if (timedOut || timeoutReason) return new ModelError("TIMEOUT", "request timed out", true);
  return new ModelError("CANCELLED", "request cancelled", false);
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw cancellationError(signal, null);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal?.removeEventListener("abort", abort);
    const finish = (): void => { if (settled) return; settled = true; cleanup(); resolve(); };
    const abort = (): void => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); reject(cancellationError(signal, null)); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", abort, {once: true});
  });
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  isRetryableError: (error: unknown) => boolean,
  onError?: (error: unknown, attempt: number) => void,
  options: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (options.signal?.aborted || (options.deadline !== null && options.deadline !== undefined && Date.now() >= options.deadline)) {
      throw cancellationError(options.signal, options.deadline);
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onError?.(error, attempt);
      if (!isRetryableError(error)) throw error;
      if (attempt < MAX_RETRIES - 1) {
        const remaining = options.deadline === null || options.deadline === undefined ? null : Math.max(0, options.deadline - Date.now());
        const exponentialMs = INITIAL_BACKOFF_MS * 2 ** attempt;
        const jitteredMs = exponentialMs * (options.random ?? Math.random)();
        const delayMs = retryAfterMs(error) ?? jitteredMs;
        const backoffMs = remaining === null ? delayMs : Math.min(delayMs, remaining);
        if (backoffMs <= 0) throw cancellationError(options.signal, options.deadline);
        await (options.sleep ?? wait)(backoffMs, options.signal);
      }
    }
  }
  throw lastError;
}
