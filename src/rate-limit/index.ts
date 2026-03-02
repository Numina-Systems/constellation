// pattern: Functional Core

export type { TokenBucket, TokenBucketConfig, ConsumeResult, RateLimiterConfig, RateLimitStatus, BucketStatus } from './types.js';
export { createTokenBucket, refill, tryConsume, recordConsumption, getStatus } from './bucket.js';
