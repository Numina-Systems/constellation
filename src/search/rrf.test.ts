// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { mergeWithRRF } from './rrf.ts';
import { type DomainSearchResult } from './types.ts';

describe('mergeWithRRF', () => {
  describe('GH-23.AC2.1: Results in both lists rank higher than results in only one', () => {
    it('should score results appearing in both keyword and vector lists higher than exclusive results', () => {
      // Simulate keyword search results
      const keywordResults: DomainSearchResult[] = [
        {
          id: 'result-1',
          domain: 'memory',
          content: 'Content 1',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'result-2',
          domain: 'memory',
          content: 'Content 2',
          score: 0.8,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
        {
          id: 'result-3',
          domain: 'memory',
          content: 'Content 3',
          score: 0.7,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-03'),
        },
      ];

      // Simulate vector search results with overlapping items
      const vectorResults: DomainSearchResult[] = [
        {
          id: 'result-1',
          domain: 'memory',
          content: 'Content 1',
          score: 0.85,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'result-4',
          domain: 'memory',
          content: 'Content 4',
          score: 0.75,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-04'),
        },
        {
          id: 'result-2',
          domain: 'memory',
          content: 'Content 2',
          score: 0.7,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
      ];

      const merged = mergeWithRRF([keywordResults, vectorResults]);

      // Find the merged results
      const result1 = merged.find((r) => r.id === 'result-1');
      const result2 = merged.find((r) => r.id === 'result-2');
      const result3 = merged.find((r) => r.id === 'result-3');
      const result4 = merged.find((r) => r.id === 'result-4');

      // result-1 and result-2 appear in both lists, so should have higher scores
      // result-3 appears only in keyword list
      // result-4 appears only in vector list
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
      expect(result4).toBeDefined();

      if (!result1 || !result2 || !result3 || !result4) {
        throw new Error('Missing results');
      }

      // Results in both lists should score higher than exclusive results
      expect(result1.score).toBeGreaterThan(result3.score);
      expect(result1.score).toBeGreaterThan(result4.score);
      expect(result2.score).toBeGreaterThan(result3.score);
      expect(result2.score).toBeGreaterThan(result4.score);
    });
  });

  describe('GH-23.AC2.2: Results are interleaved by RRF score, not grouped by domain', () => {
    it('should interleave results from different domains based on score, not domain grouping', () => {
      // Memory domain results
      const memoryResults: DomainSearchResult[] = [
        {
          id: 'mem-1',
          domain: 'memory',
          content: 'Memory 1',
          score: 0.9,
          metadata: { tier: 'core', label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'mem-2',
          domain: 'memory',
          content: 'Memory 2',
          score: 0.6,
          metadata: { tier: 'working', label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
      ];

      // Conversations domain results
      const conversationResults: DomainSearchResult[] = [
        {
          id: 'conv-1',
          domain: 'conversations',
          content: 'Conversation 1',
          score: 0.85,
          metadata: { tier: null, label: null, role: null, conversationId: 'conv-123' },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'conv-2',
          domain: 'conversations',
          content: 'Conversation 2',
          score: 0.7,
          metadata: { tier: null, label: null, role: null, conversationId: 'conv-456' },
          createdAt: new Date('2026-01-02'),
        },
      ];

      const merged = mergeWithRRF([memoryResults, conversationResults]);

      // Calculate expected RRF scores (k=60)
      // mem-1: rank 1 in memoryResults, not in conversationResults -> 1/(60+1) = 1/61
      // mem-2: rank 2 in memoryResults, not in conversationResults -> 1/(60+2) = 1/62
      // conv-1: rank 1 in conversationResults, not in memoryResults -> 1/(60+1) = 1/61
      // conv-2: rank 2 in conversationResults, not in memoryResults -> 1/(60+2) = 1/62

      // mem-1 and conv-1 should have equal scores (both 1/61) and appear at top
      // mem-2 and conv-2 should have equal scores (both 1/62)

      // Verify interleaving (not domain grouping)
      // The first two should be mixed (mem-1 and conv-1, both rank 1)
      const first = merged[0]!.domain;
      const second = merged[1]!.domain;
      expect(first).not.toBe(second); // Not grouped: should alternate

      // All memory and conversation results should be present
      const memoryCount = merged.filter((r) => r.domain === 'memory').length;
      const conversationCount = merged.filter((r) => r.domain === 'conversations').length;
      expect(memoryCount).toBe(2);
      expect(conversationCount).toBe(2);
    });
  });

  describe('GH-23.AC2.3: Results in only one list still appear with appropriate lower score', () => {
    it('should include exclusive results in output with lower scores than overlapping results', () => {
      const list1: DomainSearchResult[] = [
        {
          id: 'shared-1',
          domain: 'memory',
          content: 'Shared',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'exclusive-1',
          domain: 'memory',
          content: 'Exclusive to list 1',
          score: 0.5,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
      ];

      const list2: DomainSearchResult[] = [
        {
          id: 'shared-1',
          domain: 'memory',
          content: 'Shared',
          score: 0.85,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'exclusive-2',
          domain: 'memory',
          content: 'Exclusive to list 2',
          score: 0.4,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-03'),
        },
      ];

      const merged = mergeWithRRF([list1, list2]);

      const shared = merged.find((r) => r.id === 'shared-1');
      const exclusive1 = merged.find((r) => r.id === 'exclusive-1');
      const exclusive2 = merged.find((r) => r.id === 'exclusive-2');

      // All results should be present
      expect(shared).toBeDefined();
      expect(exclusive1).toBeDefined();
      expect(exclusive2).toBeDefined();

      if (!shared || !exclusive1 || !exclusive2) {
        throw new Error('Missing results');
      }

      // Exclusive results should have valid scores
      expect(exclusive1.score).toBeGreaterThan(0);
      expect(exclusive2.score).toBeGreaterThan(0);

      // Shared result should score higher than exclusive results
      expect(shared.score).toBeGreaterThan(exclusive1.score);
      expect(shared.score).toBeGreaterThan(exclusive2.score);

      // Verify all results are in output (not filtered)
      expect(merged).toHaveLength(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty input and return empty array', () => {
      const merged = mergeWithRRF([]);
      expect(merged).toEqual([]);
    });

    it('should handle empty result lists', () => {
      const merged = mergeWithRRF([[], []]);
      expect(merged).toEqual([]);
    });

    it('should handle single result list', () => {
      const results: DomainSearchResult[] = [
        {
          id: 'item-1',
          domain: 'memory',
          content: 'Content 1',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'item-2',
          domain: 'memory',
          content: 'Content 2',
          score: 0.8,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
      ];

      const merged = mergeWithRRF([results]);

      // Should return all results with RRF scores calculated
      expect(merged).toHaveLength(2);

      // RRF scores for single list: 1/(60+1)=1/61 and 1/(60+2)=1/62
      const item1 = merged.find((r) => r.id === 'item-1');
      const item2 = merged.find((r) => r.id === 'item-2');

      expect(item1).toBeDefined();
      expect(item2).toBeDefined();

      if (!item1 || !item2) {
        throw new Error('Missing items');
      }

      expect(item1.score).toBeCloseTo(1 / 61);
      expect(item2.score).toBeCloseTo(1 / 62);
      expect(item1.score).toBeGreaterThan(item2.score);
    });

    it('should correctly merge duplicate IDs across lists with summed scores', () => {
      const list1: DomainSearchResult[] = [
        {
          id: 'dup-1',
          domain: 'memory',
          content: 'Duplicate',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
      ];

      const list2: DomainSearchResult[] = [
        {
          id: 'dup-1',
          domain: 'memory',
          content: 'Duplicate',
          score: 0.8,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
      ];

      const list3: DomainSearchResult[] = [
        {
          id: 'dup-1',
          domain: 'memory',
          content: 'Duplicate',
          score: 0.7,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
      ];

      const merged = mergeWithRRF([list1, list2, list3]);

      // Should have only one result (deduplicated)
      expect(merged).toHaveLength(1);

      const result = merged[0]!;
      expect(result.id).toBe('dup-1');

      // Score should be sum of RRF scores from all three lists
      // 1/(60+1) + 1/(60+1) + 1/(60+1) = 3/61
      const expectedScore = 3 / 61;
      expect(result.score).toBeCloseTo(expectedScore);
    });

    it('should respect custom smoothing constant k', () => {
      const results: DomainSearchResult[] = [
        {
          id: 'item-1',
          domain: 'memory',
          content: 'Content',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
      ];

      const mergedDefaultK = mergeWithRRF([results]);
      const mergedCustomK = mergeWithRRF([results], 120);

      // With k=120, the score should be lower: 1/(120+1) vs 1/(60+1)
      expect(mergedCustomK[0]!.score).toBeLessThan(mergedDefaultK[0]!.score);
      expect(mergedCustomK[0]!.score).toBeCloseTo(1 / 121);
    });

    it('should sort results by RRF score descending', () => {
      const list1: DomainSearchResult[] = [
        {
          id: 'a',
          domain: 'memory',
          content: 'A',
          score: 0.9,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'b',
          domain: 'memory',
          content: 'B',
          score: 0.8,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-02'),
        },
        {
          id: 'c',
          domain: 'memory',
          content: 'C',
          score: 0.7,
          metadata: { tier: null, label: null, role: null, conversationId: null },
          createdAt: new Date('2026-01-03'),
        },
      ];

      const merged = mergeWithRRF([list1]);

      // Verify descending order
      for (let i = 0; i < merged.length - 1; i++) {
        expect(merged[i]!.score).toBeGreaterThanOrEqual(merged[i + 1]!.score);
      }
    });
  });
});
