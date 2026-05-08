import { describe, test, expect, beforeEach } from 'bun:test';
import type { SearchStore } from '@/search/store.js';
import type { SearchResult } from '@/search/types.js';
import type { DecompositionResult } from './types.js';
import { retrieveContext } from './retrieve.js';

describe('retrieveContext', () => {
  let mockSearchStore: SearchStore;

  beforeEach(() => {
    mockSearchStore = {
      search: async () => [],
      registerDomain: () => {
        throw new Error('not implemented');
      },
    };
  });

  test('AC2.1: semantic queries call search with mode=hybrid and limit=5', async () => {
    const calls: Array<{ query: string; mode: string; limit: number }> = [];
    mockSearchStore.search = async (params) => {
      calls.push({ query: params.query, mode: params.mode, limit: params.limit });
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: ['what is my personality?', 'core memories'],
      entities: [],
    };

    await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ query: 'what is my personality?', mode: 'hybrid', limit: 5 });
    expect(calls[1]).toEqual({ query: 'core memories', mode: 'hybrid', limit: 5 });
  });

  test('AC2.2: entity queries call search with mode=keyword and limit=3', async () => {
    const calls: Array<{ query: string; mode: string; limit: number }> = [];
    mockSearchStore.search = async (params) => {
      calls.push({ query: params.query, mode: params.mode, limit: params.limit });
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: [],
      entities: ['Alice', 'Bob'],
    };

    await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ query: 'Alice', mode: 'keyword', limit: 3 });
    expect(calls[1]).toEqual({ query: 'Bob', mode: 'keyword', limit: 3 });
  });

  test('AC2.3: merge and deduplicate results by id, keeping highest score', async () => {
    const result1: SearchResult = {
      id: 'doc-1',
      domain: 'memory',
      content: 'first occurrence',
      score: 0.8,
      metadata: { tier: 'core', label: 'personality', role: null, conversationId: null },
      createdAt: new Date(),
    };

    const result1_duplicate: SearchResult = {
      id: 'doc-1',
      domain: 'memory',
      content: 'duplicate',
      score: 0.5, // lower score
      metadata: { tier: 'core', label: 'personality', role: null, conversationId: null },
      createdAt: new Date(),
    };

    const result2: SearchResult = {
      id: 'doc-2',
      domain: 'memory',
      content: 'second',
      score: 0.7,
      metadata: { tier: 'working', label: 'goal', role: null, conversationId: null },
      createdAt: new Date(),
    };

    mockSearchStore.search = async (params) => {
      if (params.mode === 'hybrid') {
        return [result1, result1_duplicate]; // query returns duplicates
      }
      return [result2]; // entity returns another result
    };

    const decomposition: DecompositionResult = {
      queries: ['test query'],
      entities: ['entity'],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments).toHaveLength(2);
    // Should deduplicate: doc-1 with score 0.8, doc-2 with score 0.7
    const fragment1 = result.fragments.find((f) => f.id === 'doc-1');
    const fragment2 = result.fragments.find((f) => f.id === 'doc-2');

    expect(fragment1).toBeDefined();
    expect(fragment1?.content).toBe('first occurrence'); // highest score kept
    expect(fragment1?.score).toBe(0.8);
    expect(fragment2).toBeDefined();
    expect(fragment2?.score).toBe(0.7);
  });

  test('AC3.1: includes memory domain results with different tiers', async () => {
    const results: SearchResult[] = [
      {
        id: 'core-1',
        domain: 'memory',
        content: 'core memory',
        score: 0.9,
        metadata: { tier: 'core', label: 'core-fact', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'working-1',
        domain: 'memory',
        content: 'working memory',
        score: 0.8,
        metadata: { tier: 'working', label: 'current-goal', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'archival-1',
        domain: 'memory',
        content: 'archival memory',
        score: 0.7,
        metadata: { tier: 'archival', label: 'old-fact', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments).toHaveLength(3);
    const tierNames = result.fragments.map((f) => f.tier);
    expect(tierNames).toContain('core');
    expect(tierNames).toContain('working');
    expect(tierNames).toContain('archival');
  });

  test('AC3.2: includes conversation domain results', async () => {
    const results: SearchResult[] = [
      {
        id: 'msg-1',
        domain: 'conversations',
        content: 'conversation message',
        score: 0.8,
        metadata: { tier: null, label: null, role: 'user', conversationId: 'conv-1' },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.domain).toBe('conversations');
  });

  test('AC3.3: filters out results matching coreLabels', async () => {
    const results: SearchResult[] = [
      {
        id: 'personality',
        domain: 'memory',
        content: 'personality traits',
        score: 0.9,
        metadata: { tier: 'core', label: 'personality', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'other',
        domain: 'memory',
        content: 'other fact',
        score: 0.8,
        metadata: { tier: 'core', label: 'fact', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
      coreLabels: ['personality'],
    });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.id).toBe('other');
  });

  test('AC4.1: total tokens stay within budget', async () => {
    // Mock estimateTokens to return predictable values
    const results: SearchResult[] = [
      {
        id: 'long-1',
        domain: 'memory',
        content: 'x'.repeat(200), // ~50 tokens
        score: 0.9,
        metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'long-2',
        domain: 'memory',
        content: 'x'.repeat(200), // ~50 tokens
        score: 0.8,
        metadata: { tier: 'core', label: 'b', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'long-3',
        domain: 'memory',
        content: 'x'.repeat(200), // ~50 tokens
        score: 0.7,
        metadata: { tier: 'core', label: 'c', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'long-4',
        domain: 'memory',
        content: 'x'.repeat(200), // ~50 tokens
        score: 0.6,
        metadata: { tier: 'core', label: 'd', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    // Budget of 100 tokens should fit ~2 fragments (each ~50 tokens)
    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 100,
    });

    expect(result.totalTokens).toBeLessThanOrEqual(100);
  });

  test('AC4.2: truncates fragment content when it exceeds remaining budget', async () => {
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        domain: 'memory',
        content: 'x'.repeat(400), // ~100 tokens
        score: 0.9,
        metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    // Budget of 50 tokens, but fragment is ~100 tokens
    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 50,
    });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.content.length).toBeLessThan(400); // truncated
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });

  test('AC4.3: empty decomposition returns no fragments', async () => {
    mockSearchStore.search = async () => [];

    const decomposition: DecompositionResult = {
      queries: [],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.queryCount).toBe(0);
  });

  test('tracks source as semantic for query results', async () => {
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        domain: 'memory',
        content: 'semantic result',
        score: 0.9,
        metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async (params) => {
      if (params.mode === 'hybrid') return results;
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments[0]?.source).toBe('semantic');
  });

  test('tracks source as entity for entity results', async () => {
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        domain: 'memory',
        content: 'entity result',
        score: 0.9,
        metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async (params) => {
      if (params.mode === 'keyword') return results;
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: [],
      entities: ['Alice'],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments[0]?.source).toBe('entity');
  });

  test('prefers semantic source when same result appears in both', async () => {
    const baseResult: SearchResult = {
      id: 'doc-1',
      domain: 'memory',
      content: 'shared result',
      score: 0.9,
      metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
      createdAt: new Date(),
    };

    mockSearchStore.search = async (params) => {
      if (params.mode === 'hybrid') return [baseResult];
      if (params.mode === 'keyword') return [baseResult]; // same result from entity search
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: ['test query'],
      entities: ['Alice'],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.source).toBe('semantic'); // should prefer semantic
  });

  test('correctly maps SearchResult to RecallFragment', async () => {
    const results: SearchResult[] = [
      {
        id: 'test-id-123',
        domain: 'memory',
        content: 'test content here',
        score: 0.85,
        metadata: { tier: 'working', label: 'test-label', role: 'user', conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    const fragment = result.fragments[0];
    expect(fragment).toBeDefined();
    expect(fragment?.id).toBe('test-id-123');
    expect(fragment?.label).toBe('test-label');
    expect(fragment?.domain).toBe('memory');
    expect(fragment?.content).toBe('test content here');
    expect(fragment?.score).toBe(0.85);
    expect(fragment?.tier).toBe('working');
  });

  test('handles null label by mapping to unknown', async () => {
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        domain: 'memory',
        content: 'test',
        score: 0.9,
        metadata: { tier: 'core', label: null, role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments[0]?.label).toBe('unknown');
  });

  test('counts total queries made', async () => {
    mockSearchStore.search = async () => [];

    const decomposition: DecompositionResult = {
      queries: ['q1', 'q2', 'q3'],
      entities: ['e1', 'e2'],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.queryCount).toBe(5); // 3 semantic + 2 entity
  });

  test('runs all searches concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    mockSearchStore.search = async () => {
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return [];
    };

    const decomposition: DecompositionResult = {
      queries: ['q1', 'q2'],
      entities: ['e1'],
    };

    await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    // All 3 searches should have run concurrently
    expect(maxConcurrent).toBe(3);
  });

  test('returns zero elapsed time (handled by orchestrator)', async () => {
    mockSearchStore.search = async () => [];

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.elapsed).toBe(0);
  });

  test('sorts fragments by score descending', async () => {
    const results: SearchResult[] = [
      {
        id: 'doc-1',
        domain: 'memory',
        content: 'low score',
        score: 0.5,
        metadata: { tier: 'core', label: 'a', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'doc-2',
        domain: 'memory',
        content: 'high score',
        score: 0.95,
        metadata: { tier: 'core', label: 'b', role: null, conversationId: null },
        createdAt: new Date(),
      },
      {
        id: 'doc-3',
        domain: 'memory',
        content: 'mid score',
        score: 0.7,
        metadata: { tier: 'core', label: 'c', role: null, conversationId: null },
        createdAt: new Date(),
      },
    ];

    mockSearchStore.search = async () => results;

    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };

    const result = await retrieveContext({
      decomposition,
      searchStore: mockSearchStore,
      tokenBudget: 4096,
    });

    expect(result.fragments[0]?.score).toBe(0.95);
    expect(result.fragments[1]?.score).toBe(0.7);
    expect(result.fragments[2]?.score).toBe(0.5);
  });
});
