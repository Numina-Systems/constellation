// pattern: Functional Core

import type { TokenBucket, TokenBucketConfig, ConsumeResult, BucketStatus } from './types.js';

export function createTokenBucket(config: TokenBucketConfig, now: number): TokenBucket {
  return {
    capacity: config.capacity,
    refillRate: config.refillRate,
    tokens: config.capacity,
    lastRefill: now,
  };
}

export function refill(bucket: TokenBucket, now: number): TokenBucket {
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return bucket;

  const added = elapsed * bucket.refillRate;
  const newTokens = Math.min(bucket.tokens + added, bucket.capacity);

  return { ...bucket, tokens: newTokens, lastRefill: now };
}

export function tryConsume(bucket: TokenBucket, amount: number, now: number): ConsumeResult {
  const refilled = refill(bucket, now);

  if (refilled.tokens >= amount) {
    return {
      allowed: true,
      bucket: { ...refilled, tokens: refilled.tokens - amount },
      waitMs: 0,
    };
  }

  const deficit = amount - refilled.tokens;
  const waitMs = deficit / refilled.refillRate;

  return {
    allowed: false,
    bucket: refilled,
    waitMs,
  };
}

export function recordConsumption(
  bucket: TokenBucket,
  estimated: number,
  actual: number,
  now: number,
): TokenBucket {
  const refilled = refill(bucket, now);
  const correction = estimated - actual;
  return { ...refilled, tokens: refilled.tokens + correction };
}

export function getStatus(bucket: TokenBucket, now: number): BucketStatus {
  const refilled = refill(bucket, now);
  return { remaining: refilled.tokens, capacity: refilled.capacity, refillRate: refilled.refillRate };
}
