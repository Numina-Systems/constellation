// pattern: Functional Core

/**
 * Shared types for embedding providers.
 * These types define the port interface that all embedding adapters normalize to.
 */

export interface EmbeddingProvider {
  embed(text: string): Promise<Array<number>>;
  embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>>;
  dimensions: number;
}
