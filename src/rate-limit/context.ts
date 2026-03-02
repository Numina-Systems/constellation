// pattern: Functional Core

import type { ContextProvider } from '../agent/types.js';
import type { RateLimiterConfig, RateLimitStatus } from './types.js';

type RateLimitableConfig = {
  requests_per_minute?: number;
  input_tokens_per_minute?: number;
  output_tokens_per_minute?: number;
  min_output_reserve?: number;
};

type WithRateLimits = {
  requests_per_minute: number;
  input_tokens_per_minute: number;
  output_tokens_per_minute: number;
  min_output_reserve?: number;
};

export function hasRateLimitConfig<T extends RateLimitableConfig>(
  config: T,
): config is T & WithRateLimits {
  return (
    config.requests_per_minute !== undefined &&
    config.input_tokens_per_minute !== undefined &&
    config.output_tokens_per_minute !== undefined
  );
}

export function buildRateLimiterConfig(config: WithRateLimits): RateLimiterConfig {
  return {
    requestsPerMinute: config.requests_per_minute,
    inputTokensPerMinute: config.input_tokens_per_minute,
    outputTokensPerMinute: config.output_tokens_per_minute,
    minOutputReserve: config.min_output_reserve,
  };
}

export function createRateLimitContextProvider(
  getStatus: () => RateLimitStatus,
): ContextProvider {
  return () => {
    const status = getStatus();
    return [
      '## Resource Budget',
      `Input tokens: ${Math.round(status.inputTokens.remaining)}/${status.inputTokens.capacity} remaining this minute`,
      `Output tokens: ${Math.round(status.outputTokens.remaining)}/${status.outputTokens.capacity} remaining this minute`,
      `Queued requests: ${status.queueDepth}`,
    ].join('\n');
  };
}
