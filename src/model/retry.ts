// pattern: Imperative Shell

import {ModelError} from "./types.js";

/** Retry logic with one caller-owned lifetime across attempts and backoff. */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export type RetryOptions = {
  readonly signal?: AbortSignal;
  readonly deadline?: number | null;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

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
        const backoffMs = remaining === null ? INITIAL_BACKOFF_MS * 2 ** attempt : Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, remaining);
        if (backoffMs <= 0) throw cancellationError(options.signal, options.deadline);
        await (options.sleep ?? wait)(backoffMs, options.signal);
      }
    }
  }
  throw lastError;
}
