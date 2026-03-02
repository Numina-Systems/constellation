// pattern: Imperative Shell

import type { ModelProvider, ModelRequest, ModelResponse } from '../model/types.js';
import type { RateLimiterConfig, RateLimitStatus } from './types.js';
import { createTokenBucket, tryConsume, recordConsumption, getStatus } from './bucket.js';
import { estimateInputTokens } from './estimate.js';

const DEFAULT_MIN_OUTPUT_RESERVE = 1024;

export function createRateLimitedProvider(
  provider: ModelProvider,
  config: RateLimiterConfig,
): ModelProvider & { getStatus(): RateLimitStatus } {
  const now = Date.now();

  // Create three independent token buckets
  const rpmBucket = createTokenBucket(
    {
      capacity: config.requestsPerMinute,
      refillRate: config.requestsPerMinute / 60000, // per millisecond
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

  // State tracking
  let rpmBucketState = rpmBucket;
  let itpmBucketState = itpmBucket;
  let otpmBucketState = otpmBucket;
  let queueDepth = 0;

  // Promise-based mutex for serializing concurrent callers
  let mutexChain = Promise.resolve();

  function withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = mutexChain;
    let resolve: () => void = () => {};
    mutexChain = new Promise<void>((r) => {
      resolve = r;
    });
    return prev.then(fn).finally(() => resolve());
  }

  async function complete(request: ModelRequest): Promise<ModelResponse> {
    const estimatedInputTokens = estimateInputTokens(request);

    return withMutex(async () => {
      queueDepth++;

      try {
        // Loop until all buckets have sufficient capacity
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const now = Date.now();

          const rpmResult = tryConsume(rpmBucketState, 1, now);
          const itpmResult = tryConsume(itpmBucketState, estimatedInputTokens, now);
          const otpmResult = tryConsume(otpmBucketState, minOutputReserve, now);

          // Update buckets after consumption attempts
          rpmBucketState = rpmResult.bucket;
          itpmBucketState = itpmResult.bucket;
          otpmBucketState = otpmResult.bucket;

          if (rpmResult.allowed && itpmResult.allowed && otpmResult.allowed) {
            // All buckets have capacity
            rpmBucketState = { ...rpmBucketState, tokens: rpmBucketState.tokens - 1 };
            itpmBucketState = {
              ...itpmBucketState,
              tokens: itpmBucketState.tokens - estimatedInputTokens,
            };
            otpmBucketState = { ...otpmBucketState, tokens: otpmBucketState.tokens - minOutputReserve };
            break;
          }

          // Calculate max wait across all buckets
          const maxWaitMs = Math.max(rpmResult.waitMs, itpmResult.waitMs, otpmResult.waitMs);

          if (maxWaitMs > 5000) {
            console.info(`rate limit: waiting ${Math.round(maxWaitMs)}ms for bucket refill`);
          }

          // Sleep and retry
          await new Promise((resolve) => setTimeout(resolve, maxWaitMs));
        }

        // Call the underlying provider
        const response = await provider.complete(request);

        // Correct buckets with actual usage
        const actualInputTokens = response.usage.input_tokens;
        const actualOutputTokens = response.usage.output_tokens;

        const now = Date.now();
        rpmBucketState = recordConsumption(rpmBucketState, 1, 1, now); // RPM is always 1 request consumed
        itpmBucketState = recordConsumption(itpmBucketState, estimatedInputTokens, actualInputTokens, now);
        otpmBucketState = recordConsumption(otpmBucketState, minOutputReserve, actualOutputTokens, now);

        return response;
      } finally {
        queueDepth--;
      }
    });
  }

  function stream(request: ModelRequest): AsyncIterable<any> {
    // Stream does not go through rate limiting
    return provider.stream(request);
  }

  function status(): RateLimitStatus {
    const now = Date.now();
    return {
      rpm: getStatus(rpmBucketState, now),
      inputTokens: getStatus(itpmBucketState, now),
      outputTokens: getStatus(otpmBucketState, now),
      queueDepth,
    };
  }

  return {
    complete,
    stream,
    getStatus: status,
  };
}
