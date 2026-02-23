// pattern: Functional Core

/**
 * Shared test utilities for integration tests.
 * Provides mock implementations for embedding providers.
 */

import type { EmbeddingProvider } from '../embedding/types';

/**
 * Create a deterministic mock embedding provider for testing.
 * Uses a simple hash-based deterministic algorithm to generate consistent embeddings.
 */
export function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: async (text: string): Promise<Array<number>> => {
      const hash = Array.from(text).reduce((acc, char) => {
        return acc * 31 + char.charCodeAt(0);
      }, 0);
      const seed = Math.abs(hash) % 1000;
      const result = Array.from({ length: 768 }, (_, i) => {
        const val = Math.sin(seed + i) * 0.5 + 0.5;
        return Number.isFinite(val) ? val : 0.5;
      });
      return result;
    },
    embedBatch: async (texts: ReadonlyArray<string>): Promise<Array<Array<number>>> => {
      const provider = createMockEmbeddingProvider();
      return Promise.all(texts.map((text) => provider.embed(text)));
    },
    dimensions: 768,
  };
}
