// pattern: Imperative Shell

import type { ModelProvider, ModelRequest, ModelResponse, StreamEvent } from '../model/types.js';
import { ModelError } from '../model/types.js';
import { composeCancellation, isTimeoutCancellation } from '../model/cancellation.js';
import type { RateLimiterConfig, RateLimitStatus, ServerRateLimitSync } from './types.js';
import { createTokenBucket, tryConsume, recordConsumption, getStatus, refill } from './bucket.js';
import { estimateInputTokens } from './estimate.js';

const DEFAULT_MIN_OUTPUT_RESERVE = 1024;

type CancellationOptions = {
  readonly signal: AbortSignal;
  readonly deadline: number | null;
};

function cancellationError(options: CancellationOptions): ModelError {
  const timedOut = isTimeoutCancellation(options.signal, options.deadline);
  return new ModelError(
    timedOut ? 'TIMEOUT' : 'CANCELLED',
    timedOut ? 'request timed out' : 'request cancelled',
    timedOut,
    { subsystem: 'rate-limit' },
  );
}

function abortableWait<T>(promise: Promise<T>, options: CancellationOptions): Promise<T> {
  if (options.signal.aborted) return Promise.reject(cancellationError(options));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => options.signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancellationError(options));
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function sleepForRefill(milliseconds: number, options: CancellationOptions): Promise<void> {
  return abortableWait(
    new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(1, milliseconds));
    }),
    options,
  );
}

export function createRateLimitedProvider(
  provider: ModelProvider,
  config: RateLimiterConfig,
): ModelProvider & { getStatus(): RateLimitStatus; syncFromServer: ServerRateLimitSync } {
  const now = Date.now();

  const rpmBucket = createTokenBucket(
    {
      capacity: config.requestsPerMinute,
      refillRate: config.requestsPerMinute / 60000,
    },
    now,
  );
  const itpmBucket = createTokenBucket(
    {
      capacity: config.inputTokensPerMinute,
      refillRate: config.inputTokensPerMinute / 60000,
    },
    now,
  );
  const otpmBucket = createTokenBucket(
    {
      capacity: config.outputTokensPerMinute,
      refillRate: config.outputTokensPerMinute / 60000,
    },
    now,
  );

  const minOutputReserve = config.minOutputReserve ?? DEFAULT_MIN_OUTPUT_RESERVE;
  let rpmBucketState = rpmBucket;
  let itpmBucketState = itpmBucket;
  let otpmBucketState = otpmBucket;
  let queueDepth = 0;

  let mutexChain = Promise.resolve();

  function withMutex<T>(fn: () => Promise<T>, options: CancellationOptions): Promise<T> {
    const previous = mutexChain;
    let release: () => void = () => {};
    mutexChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    const turn = previous.then(async () => {
      try {
        if (options.signal.aborted) throw cancellationError(options);
        return await fn();
      } finally {
        release();
      }
    });
    return abortableWait(turn, options);
  }

  async function complete(request: ModelRequest): Promise<ModelResponse> {
    const effectiveDeadline = request.timeout === undefined
      ? request.deadline ?? null
      : request.deadline === undefined
        ? Date.now() + request.timeout
        : Math.min(request.deadline, Date.now() + request.timeout);
    const cancellation = composeCancellation({
      signal: request.signal,
      deadline: effectiveDeadline,
    });
    const cancellationOptions: CancellationOptions = {
      signal: cancellation.signal,
      deadline: effectiveDeadline,
    };
    const estimatedInputTokens = estimateInputTokens(request);
    let enteredCriticalSection = false;
    queueDepth++;

    try {
      return await withMutex(async () => {
        enteredCriticalSection = true;
        try {
          while (true) {
            if (cancellation.signal.aborted) throw cancellationError(cancellationOptions);
            const currentTime = Date.now();
            const rpmResult = tryConsume(rpmBucketState, 1, currentTime);
            const itpmResult = tryConsume(itpmBucketState, estimatedInputTokens, currentTime);
            const otpmResult = tryConsume(otpmBucketState, minOutputReserve, currentTime);

            if (rpmResult.allowed && itpmResult.allowed && otpmResult.allowed) {
              rpmBucketState = rpmResult.bucket;
              itpmBucketState = itpmResult.bucket;
              otpmBucketState = otpmResult.bucket;
              break;
            }

            rpmBucketState = refill(rpmBucketState, currentTime);
            itpmBucketState = refill(itpmBucketState, currentTime);
            otpmBucketState = refill(otpmBucketState, currentTime);
            const maxWaitMs = Math.max(rpmResult.waitMs, itpmResult.waitMs, otpmResult.waitMs);
            if (maxWaitMs > 5000) {
              console.info(`rate limit: waiting ${Math.round(maxWaitMs)}ms for bucket refill`);
            }
            await sleepForRefill(maxWaitMs, cancellationOptions);
          }

          const providerRequest: ModelRequest = {
            ...request,
            signal: cancellation.signal,
            deadline: effectiveDeadline === null ? undefined : effectiveDeadline,
            timeout: undefined,
          };
          const response = await provider.complete(providerRequest);
          const actualInputTokens = response.usage?.input_tokens ?? estimatedInputTokens;
          const actualOutputTokens = response.usage?.output_tokens ?? minOutputReserve;
          const completedAt = Date.now();
          rpmBucketState = recordConsumption(rpmBucketState, 1, 1, completedAt);
          itpmBucketState = recordConsumption(itpmBucketState, estimatedInputTokens, actualInputTokens, completedAt);
          otpmBucketState = recordConsumption(otpmBucketState, minOutputReserve, actualOutputTokens, completedAt);
          return response;
        } finally {
          queueDepth--;
        }
      }, cancellationOptions);
    } finally {
      cancellation.dispose();
      if (!enteredCriticalSection) queueDepth = Math.max(0, queueDepth - 1);
    }
  }

  function stream(request: ModelRequest): AsyncIterable<StreamEvent> {
    return provider.stream(request);
  }

  function status(): RateLimitStatus {
    const currentTime = Date.now();
    return {
      rpm: getStatus(rpmBucketState, currentTime),
      inputTokens: getStatus(itpmBucketState, currentTime),
      outputTokens: getStatus(otpmBucketState, currentTime),
      queueDepth,
    };
  }

  function syncFromServer(serverStatus: { readonly limit: number; readonly remaining: number; readonly resetAt: number }): void {
    if (serverStatus.limit === 0 && serverStatus.remaining === 0) return;
    const currentTime = Date.now();
    const windowMs = Math.max(serverStatus.resetAt - currentTime, 1000);
    rpmBucketState = {
      capacity: serverStatus.limit,
      tokens: serverStatus.remaining,
      refillRate: serverStatus.limit / windowMs,
      lastRefill: currentTime,
    };
  }

  return {
    complete,
    stream,
    getStatus: status,
    syncFromServer,
  };
}
