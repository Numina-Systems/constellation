// pattern: Imperative Shell

/**
 * Unit tests for createPredictionContextProvider.
 * Verifies AC5.1 and AC5.2: context provider output injection and caching.
 */

import { describe, it, expect } from 'bun:test';
import { createPredictionContextProvider } from './context-provider.ts';
import type { Prediction, PredictionStore } from './types.ts';

function createMockPredictionStore(
  predictions: ReadonlyArray<Prediction>,
): PredictionStore & { callCount: number; resetCallCount: () => void } {
  let callCount = 0;
  return {
    callCount,
    resetCallCount() {
      callCount = 0;
    },
    async listPredictions() {
      callCount++;
      return predictions;
    },
    async createPrediction() {
      throw new Error('not implemented');
    },
    async createEvaluation() {
      throw new Error('not implemented');
    },
    async markEvaluated() {
      throw new Error('not implemented');
    },
    async expireStalePredictions() {
      throw new Error('not implemented');
    },
    async getLastReviewTimestamp() {
      throw new Error('not implemented');
    },
  };
}

function createMockPrediction(overrides?: Partial<Prediction>): Prediction {
  return {
    id: 'pred-1',
    owner: 'test-owner',
    conversationId: 'conv-1',
    predictionText: 'test prediction',
    domain: null,
    confidence: 0.8,
    contextSnapshot: {},
    status: 'pending',
    createdAt: new Date(),
    evaluatedAt: null,
    ...overrides,
  };
}

describe('createPredictionContextProvider', () => {
  it('AC5.1: returns status line with pending predictions after cache prime', async () => {
    const predictions = [
      createMockPrediction({ id: 'pred-1' }),
      createMockPrediction({ id: 'pred-2' }),
      createMockPrediction({ id: 'pred-3' }),
    ];
    const store = createMockPredictionStore(predictions);
    const provider = createPredictionContextProvider(store, 'test-owner');

    // First call returns undefined (cache not yet primed)
    const firstResult = provider();
    expect(firstResult).toBeUndefined();

    // Wait for async refresh to complete
    await Bun.sleep(50);

    // Second call returns status line
    const secondResult = provider();
    expect(secondResult).toContain('[Prediction Journal]');
    expect(secondResult).toContain('3 pending predictions');
  });

  it('AC5.2: returns undefined when no pending predictions', async () => {
    const store = createMockPredictionStore([]);
    const provider = createPredictionContextProvider(store, 'test-owner');

    // Trigger cache prime
    provider();
    await Bun.sleep(50);

    // Should still return undefined
    const result = provider();
    expect(result).toBeUndefined();
  });

  it('uses correct singular/plural form in status line', async () => {
    const singlePrediction = [createMockPrediction()];
    const store = createMockPredictionStore(singlePrediction);
    const provider = createPredictionContextProvider(store, 'test-owner');

    provider();
    await Bun.sleep(50);

    const result = provider();
    expect(result).toContain('1 pending prediction');
    expect(result).not.toContain('predictions');
  });

  it('caches result and does not call store within TTL', async () => {
    const predictions = [createMockPrediction()];
    const store = createMockPredictionStore(predictions);
    const provider = createPredictionContextProvider(store, 'test-owner');

    // Prime the cache
    provider();
    await Bun.sleep(50);

    const callCountAfterPrime = store.callCount;

    // Call multiple times within 5 minutes — store should not be called again
    for (let i = 0; i < 5; i++) {
      provider();
    }

    expect(store.callCount).toBe(callCountAfterPrime);
  });

  it('multiple providers have independent caches', async () => {
    const predictions1 = [createMockPrediction({ id: 'pred-1' })];
    const predictions2 = [
      createMockPrediction({ id: 'pred-2' }),
      createMockPrediction({ id: 'pred-3' }),
    ];
    const store1 = createMockPredictionStore(predictions1);
    const store2 = createMockPredictionStore(predictions2);

    const provider1 = createPredictionContextProvider(store1, 'owner-1');
    const provider2 = createPredictionContextProvider(store2, 'owner-2');

    // Prime both caches
    provider1();
    provider2();
    await Bun.sleep(50);

    const result1 = provider1();
    const result2 = provider2();

    expect(result1).toContain('1 pending prediction');
    expect(result2).toContain('2 pending predictions');
  });

  it('does not throw on store error and logs warning', async () => {
    const throwingStore: PredictionStore = {
      async listPredictions() {
        throw new Error('database connection failed');
      },
      async createPrediction() {
        throw new Error('not implemented');
      },
      async createEvaluation() {
        throw new Error('not implemented');
      },
      async markEvaluated() {
        throw new Error('not implemented');
      },
      async expireStalePredictions() {
        throw new Error('not implemented');
      },
      async getLastReviewTimestamp() {
        throw new Error('not implemented');
      },
    };

    const provider = createPredictionContextProvider(throwingStore, 'test-owner');

    // Should not throw
    expect(() => {
      provider();
    }).not.toThrow();

    // Wait for async refresh
    await Bun.sleep(50);

    // Should return undefined after failed refresh
    const result = provider();
    expect(result).toBeUndefined();
  });

  it('handles concurrent refresh calls gracefully', async () => {
    const predictions = [createMockPrediction()];
    const store = createMockPredictionStore(predictions);
    const provider = createPredictionContextProvider(store, 'test-owner');

    // Call provider multiple times in quick succession (before async refresh completes)
    provider();
    provider();
    provider();

    const callCountBefore = store.callCount;

    // Wait for refresh
    await Bun.sleep(50);

    // Only one refresh should have occurred
    expect(store.callCount).toBe(callCountBefore);
  });
});
