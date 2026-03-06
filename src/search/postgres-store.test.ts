// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { DomainSearchParams, SearchResult, SearchDomain } from './types.ts';
import { createSearchStore } from './postgres-store.ts';

// Mock EmbeddingProvider for testing
function createMockEmbeddingProvider(options?: {
  shouldFail?: boolean;
}): EmbeddingProvider {
  return {
    embed: async (text: string): Promise<Array<number>> => {
      if (options?.shouldFail) {
        throw new Error('Mock embedding provider error');
      }
      // Deterministic embedding based on text
      const hash = Array.from(text).reduce((acc, char) => {
        return acc * 31 + char.charCodeAt(0);
      }, 0);
      const seed = Math.abs(hash) % 1000;
      return Array.from({ length: 768 }, (_, i) => {
        const val = Math.sin(seed + i) * 0.5 + 0.5;
        return Number.isFinite(val) ? val : 0.5;
      });
    },
    embedBatch: async (texts: ReadonlyArray<string>): Promise<Array<Array<number>>> => {
      const provider = createMockEmbeddingProvider(options);
      return Promise.all(texts.map((text) => provider.embed(text)));
    },
    dimensions: 768,
  };
}

// Mock SearchDomain implementations
function createMockMemoryDomain(results: ReadonlyArray<SearchResult>): SearchDomain {
  return {
    name: 'memory',
    search: async (_params: DomainSearchParams) => results,
  };
}

function createMockConversationDomain(results: ReadonlyArray<SearchResult>): SearchDomain {
  return {
    name: 'conversations',
    search: async (_params: DomainSearchParams) => results,
  };
}

describe('SearchStore (postgres-store)', () => {
  describe('registerDomain()', () => {
    it('registers a domain successfully', () => {
      const store = createSearchStore(createMockEmbeddingProvider());
      const domain = createMockMemoryDomain([]);

      expect(() => {
        store.registerDomain(domain);
      }).not.toThrow();
    });

    it('rejects duplicate domain names', () => {
      const store = createSearchStore(createMockEmbeddingProvider());
      const domain = createMockMemoryDomain([]);

      store.registerDomain(domain);

      expect(() => {
        store.registerDomain(domain);
      }).toThrow('Domain "memory" is already registered');
    });
  });

  describe('search()', () => {
    it('GH-23.AC1.6: returns empty array when no results match', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());
      const emptyDomain = createMockMemoryDomain([]);
      store.registerDomain(emptyDomain);

      const results = await store.search({
        query: 'nonexistent query',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results).toEqual([]);
    });

    it('GH-23.AC2.1: overlapping results score higher after RRF merge', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());

      // Create two mock domains with overlapping results
      const memoryResults = [
        {
          domain: 'memory' as const,
          id: 'mem-1',
          content: 'Memory result 1',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
        {
          domain: 'memory' as const,
          id: 'mem-2', // This also appears in conversations
          content: 'Shared result',
          score: 0.8,
          metadata: { tier: 'working', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
      ];

      const conversationResults = [
        {
          domain: 'conversations' as const,
          id: 'mem-2', // Same as memory result - should score higher
          content: 'Shared result from conversation',
          score: 0.85,
          metadata: { tier: null, label: null, role: 'assistant', conversationId: 'conv-1' },
          createdAt: new Date(),
        },
        {
          domain: 'conversations' as const,
          id: 'conv-1',
          content: 'Conversation result 1',
          score: 0.7,
          metadata: { tier: null, label: null, role: 'user', conversationId: 'conv-1' },
          createdAt: new Date(),
        },
      ];

      store.registerDomain(createMockMemoryDomain(memoryResults));
      store.registerDomain(createMockConversationDomain(conversationResults));

      const results = await store.search({
        query: 'test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Find the shared result (mem-2/conv-1)
      const sharedResult = results.find((r) => r.id === 'mem-2');
      expect(sharedResult).toBeDefined();

      // The shared result should rank before single-appearance results
      // due to RRF (appearing in both lists contributes more to score)
      const memOnly = results.find((r) => r.id === 'mem-1');
      const convOnly = results.find((r) => r.id === 'conv-1');

      if (sharedResult && memOnly) {
        expect(sharedResult.score).toBeGreaterThan(memOnly.score);
      }
      if (sharedResult && convOnly) {
        expect(sharedResult.score).toBeGreaterThan(convOnly.score);
      }
    });

    it('GH-23.AC2.2: results from different domains are interleaved by RRF score', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());

      const memoryResults = [
        {
          domain: 'memory' as const,
          id: 'mem-1',
          content: 'Memory 1',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
        {
          domain: 'memory' as const,
          id: 'mem-2',
          content: 'Memory 2',
          score: 0.7,
          metadata: { tier: 'working', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
      ];

      const conversationResults = [
        {
          domain: 'conversations' as const,
          id: 'conv-1',
          content: 'Conversation 1',
          score: 0.8,
          metadata: { tier: null, label: null, role: 'assistant', conversationId: 'conv-1' },
          createdAt: new Date(),
        },
      ];

      store.registerDomain(createMockMemoryDomain(memoryResults));
      store.registerDomain(createMockConversationDomain(conversationResults));

      const results = await store.search({
        query: 'test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Results should be sorted by RRF score, not grouped by domain
      expect(results.length).toBe(3);
      // The first result should be from memory (highest single-source score)
      expect(results[0]?.id).toBe('mem-1');
      // Second should be conversation (0.8 score from single source)
      expect(results[1]?.id).toBe('conv-1');
      // Third should be memory-2 (0.7 score)
      expect(results[2]?.id).toBe('mem-2');

      // Verify interleaving: not all memory first, then all conversations
      const domainSequence = results.map((r) => r.domain);
      expect(domainSequence).toEqual(['memory', 'conversations', 'memory']);
    });

    it('GH-23.AC4.4: search without time filters returns all results', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const results = [
        {
          domain: 'memory' as const,
          id: 'past',
          content: 'Old result',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: yesterday,
        },
        {
          domain: 'memory' as const,
          id: 'present',
          content: 'Current result',
          score: 0.85,
          metadata: { tier: 'working', label: null, role: null, conversationId: null },
          createdAt: now,
        },
        {
          domain: 'memory' as const,
          id: 'future',
          content: 'Future result',
          score: 0.8,
          metadata: { tier: 'archival', label: null, role: null, conversationId: null },
          createdAt: tomorrow,
        },
      ];

      store.registerDomain(createMockMemoryDomain(results));

      const searchResults = await store.search({
        query: 'test',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // All results should be returned when no time filters
      expect(searchResults.length).toBe(3);
      expect(searchResults.map((r) => r.id)).toEqual(['past', 'present', 'future']);
    });

    it('embedding provider failure falls back to keyword mode', async () => {
      const failingProvider = createMockEmbeddingProvider({ shouldFail: true });
      const store = createSearchStore(failingProvider);

      const results = [
        {
          domain: 'memory' as const,
          id: 'result-1',
          content: 'Test result',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
      ];

      store.registerDomain(createMockMemoryDomain(results));

      // Search with hybrid mode (would need embedding, but provider fails)
      const searchResults = await store.search({
        query: 'test',
        mode: 'hybrid',
        domains: ['memory'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should still return results (fallback to keyword mode)
      expect(searchResults.length).toBe(1);
    });

    it('unregistered domain in params.domains is silently skipped', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());

      const results = [
        {
          domain: 'memory' as const,
          id: 'mem-1',
          content: 'Memory result',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: new Date(),
        },
      ];

      store.registerDomain(createMockMemoryDomain(results));

      // Request both memory and conversations, but only memory is registered
      const searchResults = await store.search({
        query: 'test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should return only memory results, not error
      expect(searchResults.length).toBe(1);
      expect(searchResults[0]?.domain).toBe('memory');
    });

    it('applies limit to merged results', async () => {
      const store = createSearchStore(createMockEmbeddingProvider());

      const results = Array.from({ length: 20 }, (_, i) => ({
        domain: 'memory' as const,
        id: `result-${i}`,
        content: `Result ${i}`,
        score: 1.0 - i * 0.01,
        metadata: { tier: 'core', label: null, role: null, conversationId: null },
        createdAt: new Date(),
      }));

      store.registerDomain(createMockMemoryDomain(results));

      const searchResults = await store.search({
        query: 'test',
        mode: 'keyword',
        domains: ['memory'],
        embedding: null,
        limit: 5,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Only 5 results should be returned due to limit
      expect(searchResults.length).toBe(5);
    });
  });
});
