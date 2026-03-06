// pattern: Imperative Shell

/**
 * Unit tests for search tool.
 * Verifies AC1.7 (enum validation via registry) and AC1.8 (limit clamping).
 */

import { describe, it, expect } from 'bun:test';
import type { SearchStore, SearchParams, SearchResult } from '../../search/index.ts';
import { createSearchTools } from './search.ts';
import { createToolRegistry } from '../registry.ts';

describe('Search tool (createSearchTools)', () => {
  function createMockSearchStore(
    capturedParams: { params: SearchParams | null } = { params: null },
    overrides?: { results?: Array<SearchResult> },
  ): SearchStore {
    const mockResults: Array<SearchResult> = overrides?.results ?? [
      {
        domain: 'memory',
        id: 'mem-1',
        content: 'This is a memory result',
        score: 0.95,
        metadata: { tier: 'core', label: 'test', role: null, conversationId: null },
        createdAt: new Date('2026-01-01'),
      },
      {
        domain: 'conversations',
        id: 'conv-1',
        content: 'This is a conversation result',
        score: 0.85,
        metadata: { tier: null, label: null, role: 'user', conversationId: 'conv-123' },
        createdAt: new Date('2026-01-02'),
      },
    ];

    return {
      search: async (params: SearchParams) => {
        capturedParams.params = params;
        return mockResults;
      },
      registerDomain: () => {},
    };
  }

  describe('AC1.7: Enum validation via registry', () => {
    it('should reject invalid mode enum value with clear error message', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);
      const registry = createToolRegistry();

      registry.register(tools[0]!);

      const result = await registry.dispatch('search', {
        query: 'test',
        mode: 'invalid_mode',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid value');
      expect(result.error).toContain('mode');
      expect(result.error).toContain('semantic');
      expect(result.error).toContain('keyword');
      expect(result.error).toContain('hybrid');
    });

    it('should reject invalid domain enum value with clear error message', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);
      const registry = createToolRegistry();

      registry.register(tools[0]!);

      const result = await registry.dispatch('search', {
        query: 'test',
        domain: 'invalid_domain',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid value');
      expect(result.error).toContain('domain');
    });

    it('should reject invalid role enum value', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);
      const registry = createToolRegistry();

      registry.register(tools[0]!);

      const result = await registry.dispatch('search', {
        query: 'test',
        role: 'invalid_role',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid value');
      expect(result.error).toContain('role');
    });

    it('should reject invalid tier enum value', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);
      const registry = createToolRegistry();

      registry.register(tools[0]!);

      const result = await registry.dispatch('search', {
        query: 'test',
        tier: 'invalid_tier',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid value');
      expect(result.error).toContain('tier');
    });

    it('should accept valid enum values', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);
      const registry = createToolRegistry();

      registry.register(tools[0]!);

      const result = await registry.dispatch('search', {
        query: 'test',
        mode: 'hybrid',
        domain: 'all',
        role: 'assistant',
        tier: 'working',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('AC1.8: Limit clamping to 1-50 range', () => {
    it('should clamp limit=0 to 1', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: 0 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(1);
    });

    it('should clamp limit=-5 to 1', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: -5 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(1);
    });

    it('should clamp limit=100 to 50', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: 100 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(50);
    });

    it('should not clamp limit=25 (within range)', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: 25 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(25);
    });

    it('should not clamp limit=1 (lower bound)', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: 1 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(1);
    });

    it('should not clamp limit=50 (upper bound)', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', limit: 50 });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(50);
    });
  });

  describe('Default values', () => {
    it('should use default mode=hybrid when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.mode).toBe('hybrid');
    });

    it('should resolve domain=all to [memory, conversations]', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', domain: 'all' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.domains).toEqual(['memory', 'conversations']);
    });

    it('should resolve single domain to array', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', domain: 'memory' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.domains).toEqual(['memory']);
    });

    it('should use default limit=10 when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.limit).toBe(10);
    });
  });

  describe('Time string parsing', () => {
    it('should parse ISO 8601 start_time string to Date', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const isoString = '2026-03-01T10:30:00Z';
      const result = await tools[0]!.handler({ query: 'test', start_time: isoString });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.startTime).not.toBe(null);
      expect(capturedParams.params?.startTime instanceof Date).toBe(true);
      // Compare parsed date by comparing time values since JS adds milliseconds to ISO string
      expect(capturedParams.params?.startTime?.getTime()).toBe(new Date(isoString).getTime());
    });

    it('should parse ISO 8601 end_time string to Date', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const isoString = '2026-03-05T23:59:59Z';
      const result = await tools[0]!.handler({ query: 'test', end_time: isoString });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.endTime).not.toBe(null);
      expect(capturedParams.params?.endTime instanceof Date).toBe(true);
      // Compare parsed date by comparing time values since JS adds milliseconds to ISO string
      expect(capturedParams.params?.endTime?.getTime()).toBe(new Date(isoString).getTime());
    });

    it('should use null for start_time when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.startTime).toBe(null);
    });

    it('should use null for end_time when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.endTime).toBe(null);
    });
  });

  describe('Content truncation', () => {
    it('should truncate content longer than 500 chars with ellipsis', async () => {
      const longContent = 'a'.repeat(600);
      const mockStore = createMockSearchStore(
        { params: null },
        {
          results: [
            {
              domain: 'memory',
              id: 'mem-1',
              content: longContent,
              score: 0.9,
              metadata: { tier: 'core', label: null, role: null, conversationId: null },
              createdAt: new Date(),
            },
          ],
        },
      );
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output[0].content).toBe('a'.repeat(500) + '...');
      expect(output[0].content.length).toBe(503); // 500 + 3 for "..."
    });

    it('should not add ellipsis for content exactly 500 chars', async () => {
      const content500 = 'b'.repeat(500);
      const mockStore = createMockSearchStore(
        { params: null },
        {
          results: [
            {
              domain: 'memory',
              id: 'mem-1',
              content: content500,
              score: 0.9,
              metadata: { tier: 'core', label: null, role: null, conversationId: null },
              createdAt: new Date(),
            },
          ],
        },
      );
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output[0].content).toBe(content500);
      expect(output[0].content.length).toBe(500);
    });

    it('should not truncate content shorter than 500 chars', async () => {
      const shortContent = 'Short content';
      const mockStore = createMockSearchStore(
        { params: null },
        {
          results: [
            {
              domain: 'memory',
              id: 'mem-1',
              content: shortContent,
              score: 0.9,
              metadata: { tier: 'core', label: null, role: null, conversationId: null },
              createdAt: new Date(),
            },
          ],
        },
      );
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output[0].content).toBe(shortContent);
    });
  });

  describe('Role and tier parameters', () => {
    it('should pass role parameter as-is to SearchStore', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', role: 'assistant' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.role).toBe('assistant');
    });

    it('should pass tier parameter as-is to SearchStore', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test', tier: 'working' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.tier).toBe('working');
    });

    it('should use null for role when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.role).toBe(null);
    });

    it('should use null for tier when not provided', async () => {
      const capturedParams: { params: SearchParams | null } = { params: null };
      const mockStore = createMockSearchStore(capturedParams);
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      expect(capturedParams.params?.tier).toBe(null);
    });
  });

  describe('Result formatting', () => {
    it('should format results with correct fields', async () => {
      const mockStore = createMockSearchStore();
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output).toBeInstanceOf(Array);
      expect(output.length).toBe(2);

      const first = output[0];
      expect(first).toHaveProperty('domain');
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('content');
      expect(first).toHaveProperty('score');
      expect(first).toHaveProperty('metadata');
      expect(first).toHaveProperty('created_at');
    });

    it('should convert createdAt to ISO string as created_at', async () => {
      const testDate = new Date('2026-03-05T12:34:56Z');
      const mockStore = createMockSearchStore(
        { params: null },
        {
          results: [
            {
              domain: 'memory',
              id: 'mem-1',
              content: 'test',
              score: 0.9,
              metadata: { tier: 'core', label: null, role: null, conversationId: null },
              createdAt: testDate,
            },
          ],
        },
      );
      const tools = createSearchTools(mockStore);

      const result = await tools[0]!.handler({ query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output[0].created_at).toBe(testDate.toISOString());
    });
  });
});
