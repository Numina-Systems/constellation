export type TokenBucketConfig = {
  readonly capacity: number;
  readonly refillRate: number; // tokens per millisecond
};

export type TokenBucket = {
  readonly capacity: number;
  readonly refillRate: number;
  readonly tokens: number;
  readonly lastRefill: number; // timestamp in ms
};

export type ConsumeResult = {
  readonly allowed: boolean;
  readonly bucket: TokenBucket;
  readonly waitMs: number;
};

export type RateLimiterConfig = {
  readonly requestsPerMinute: number;
  readonly inputTokensPerMinute: number;
  readonly outputTokensPerMinute: number;
  readonly minOutputReserve?: number;
};

export type BucketStatus = {
  readonly remaining: number;
  readonly capacity: number;
  readonly refillRate: number; // tokens per millisecond (continuous refill — no discrete "next refill time")
};

export type RateLimitStatus = {
  readonly rpm: BucketStatus;
  readonly inputTokens: BucketStatus;
  readonly outputTokens: BucketStatus;
  readonly queueDepth: number;
};
