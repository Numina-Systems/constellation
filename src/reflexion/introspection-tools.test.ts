import { describe, it, expect } from 'bun:test';
import type { TraceStore } from './trace-recorder.ts';
import type { PredictionStore, OperationTrace, IntrospectionQuery } from './types.ts';
import { createIntrospectionTools } from './introspection-tools.ts';

describe('Introspection tools', () => {
  function createMockTraceStore(): TraceStore {
    return {
      record: async () => {
        // no-op for testing
      },
      queryTraces: async () => [],
    };
  }

  function createMockPredictionStore(): PredictionStore {
    return {
      createPrediction: async () => {
        throw new Error('not implemented');
      },
      listPredictions: async () => [],
      createEvaluation: async () => {
        throw new Error('not implemented');
      },
      markEvaluated: async () => {
        // no-op
      },
      expireStalePredictions: async () => 0,
      getLastReviewTimestamp: async () => null,
    };
  }

  describe('self_introspect tool', () => {
    it('should query traces with computed lookback when lookback_hours provided', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      const beforeCall = new Date();
      await introspect.handler({
        lookback_hours: 2,
      });
      const afterCall = new Date();

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query && query.lookbackSince) {
        const elapsed = afterCall.getTime() - beforeCall.getTime();
        const expectedTime = new Date(afterCall.getTime() - 2 * 3600000);
        const timeDiff = Math.abs(query.lookbackSince.getTime() - expectedTime.getTime());
        expect(timeDiff).toBeLessThanOrEqual(elapsed + 100);
      }
    });

    it('should use last review timestamp as lookback when no hours provided', async () => {
      let capturedQuery: IntrospectionQuery | null = null;
      const lastReviewTime = new Date('2026-03-01T15:00:00Z');

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const mockPredictionStore = createMockPredictionStore();
      mockPredictionStore.getLastReviewTimestamp = async () => lastReviewTime;

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: mockPredictionStore,
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({});

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.lookbackSince?.getTime()).toBe(lastReviewTime.getTime());
      }
    });

    it('should omit lookbackSince when no hours and no prior review', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const mockPredictionStore = createMockPredictionStore();
      mockPredictionStore.getLastReviewTimestamp = async () => null;

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: mockPredictionStore,
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({});

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.lookbackSince).toBeUndefined();
      }
    });

    it('should pass tool_name filter', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({
        tool_name: 'web_search',
      });

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.toolName).toBe('web_search');
      }
    });

    it('should pass success_only filter', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({
        success_only: true,
      });

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.successOnly).toBe(true);
      }
    });

    it('should pass limit parameter', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({
        limit: 50,
      });

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.limit).toBe(50);
      }
    });

    it('should format and return traces', async () => {
      const trace: OperationTrace = {
        id: 'trace-1',
        owner: 'agent-1',
        conversationId: 'conv-1',
        toolName: 'web_search',
        input: { query: 'test' },
        outputSummary: 'Found 5 results',
        durationMs: 150,
        success: true,
        error: null,
        createdAt: new Date('2026-03-02T10:00:00Z'),
      };

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async () => [trace];

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      const result = await introspect.handler({});

      expect(result.success).toBe(true);
      expect(result.output).toContain('trace-1');
      expect(result.output).toContain('web_search');
      expect(result.output).toContain('Found 5 results');
    });

    it('should return error on store failure', async () => {
      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async () => {
        throw new Error('database error');
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-1',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      const result = await introspect.handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('database error');
    });

    it('should always pass owner to trace query', async () => {
      let capturedQuery: IntrospectionQuery | null = null;

      const mockTraceStore = createMockTraceStore();
      mockTraceStore.queryTraces = async (query) => {
        capturedQuery = query;
        return [];
      };

      const tools = createIntrospectionTools({
        traceStore: mockTraceStore,
        predictionStore: createMockPredictionStore(),
        owner: 'agent-xyz',
      });

      const introspect = tools.find((t) => t.definition.name === 'self_introspect');
      expect(introspect).toBeDefined();

      if (!introspect) return;

      await introspect.handler({});

      expect(capturedQuery).toBeDefined();
      const query = capturedQuery as IntrospectionQuery | null;
      if (query) {
        expect(query.owner).toBe('agent-xyz');
      }
    });
  });
});
