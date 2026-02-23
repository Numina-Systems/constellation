// pattern: Imperative Shell

/**
 * Retry logic shared across all model adapters.
 * Each adapter provides its own isRetryableError predicate.
 */

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  isRetryableError: (error: unknown) => boolean,
  onError?: (error: unknown, attempt: number) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (onError) {
        onError(error, attempt);
      }

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}
