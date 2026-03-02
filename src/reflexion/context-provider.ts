// pattern: Imperative Shell

/**
 * Prediction context provider for agent system prompt injection.
 * Provides cached prediction journal status showing pending predictions awaiting review.
 */

import type { PredictionStore } from './types.ts';
import type { ContextProvider } from '../agent/types.ts';

export function createPredictionContextProvider(
  store: PredictionStore,
  owner: string,
): ContextProvider {
  const CACHE_TTL = 300_000; // 5 minutes
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    store
      .listPredictions(owner, 'pending', 50)
      .then((predictions) => {
        const result =
          predictions.length > 0
            ? `[Prediction Journal] You have ${predictions.length} pending prediction${predictions.length === 1 ? '' : 's'} awaiting review.`
            : undefined;
        cached = { result, timestamp: Date.now() };
      })
      .catch((error) => {
        console.warn('prediction context provider: failed to refresh', error);
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return () => {
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
      refresh();
    }
    return cached?.result;
  };
}
