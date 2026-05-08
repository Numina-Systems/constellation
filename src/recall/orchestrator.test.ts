import { expect, test, describe, beforeEach, mock } from 'bun:test';
import type { ModelProvider, ModelResponse, StreamEvent } from '@/model/types.js';
import type { SearchStore } from '@/search/store.js';
import type { SearchParams, SearchResult } from '@/search/types.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { TraceRecorder, OperationTrace } from '@/reflexion/types.js';
import { performRecall } from './orchestrator.js';
import type { RecallDeps } from './orchestrator.js';

describe('performRecall', () => {
  let mockSearchStore: SearchStore;
  let mockModel: ModelProvider;
  let mockEmbedding: EmbeddingProvider;
  let mockTraceRecorder: TraceRecorder;
  let deps: RecallDeps;

  beforeEach(() => {
    const searchMock = mock(
      (_params: SearchParams): Promise<ReadonlyArray<SearchResult>> =>
        Promise.resolve([
          {
            id: 'test-1',
            content: 'test content one',
            score: 0.9,
            domain: 'memory',
            metadata: { label: 'test-label', tier: null, role: null, conversationId: null },
            createdAt: new Date(),
          },
        ])
    );

    // Create mock search store
    mockSearchStore = {
      search: searchMock,
      registerDomain: mock(() => {}),
    };

    // Create mock model
    mockModel = {
      complete: mock(() =>
        Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: '{"queries":["query1"],"entities":["entity1"]}',
            },
          ],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 10, output_tokens: 20 },
        } as ModelResponse)
      ),
      stream: mock((): AsyncIterable<StreamEvent> => {
        throw new Error('stream not implemented');
      }),
    };

    // Create mock embedding provider
    mockEmbedding = {
      embed: mock(() => Promise.resolve([0.1, 0.2, 0.3])),
      embedBatch: mock(() =>
        Promise.resolve([[0.1, 0.2], [0.3, 0.4]])
      ),
      dimensions: 3,
    };

    // Create mock trace recorder
    mockTraceRecorder = {
      record: mock((_trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void> =>
        Promise.resolve(undefined)
      ),
    };

    // Default deps
    deps = {
      searchStore: mockSearchStore,
      embedding: mockEmbedding,
      model: mockModel,
      modelName: 'test-model',
      tokenBudget: 1000,
      traceRecorder: mockTraceRecorder,
      owner: 'test-owner',
      conversationId: 'test-conv',
      coreLabels: [],
    };
  });

  test('AC6.3: returns null when embedding provider is null', async () => {
    const noDeps = { ...deps, embedding: null };
    const result = await performRecall('test message', noDeps);
    expect(result).toBeNull();
    expect(mockSearchStore.search).not.toHaveBeenCalled();
  });

  test('AC6.2: returns null when message is shorter than 10 characters', async () => {
    const result = await performRecall('short', deps);
    expect(result).toBeNull();
    expect(mockSearchStore.search).not.toHaveBeenCalled();
  });

  test('AC6.4: skips decomposition when model is null, uses raw message as query', async () => {
    const noDeps = { ...deps, model: null, modelName: null };
    const result = await performRecall('this is a longer message', noDeps);
    expect(result).not.toBeNull();
    expect(mockModel.complete).not.toHaveBeenCalled();
    expect(mockSearchStore.search).toHaveBeenCalled();
  });

  test('happy path: model returns valid decomposition and search returns results', async () => {
    const result = await performRecall('this is a test message', deps);
    expect(result).not.toBeNull();
    expect(result!.fragments.length).toBeGreaterThan(0);
    expect(result!.totalTokens).toBeGreaterThanOrEqual(0);
    expect(result!.queryCount).toBeGreaterThan(0);
    expect(result!.elapsed).toBeGreaterThan(0);
    expect(mockModel.complete).toHaveBeenCalled();
    expect(mockSearchStore.search).toHaveBeenCalled();
  });

  test('AC5.1: model error falls back to raw message as query', async () => {
    const errorModel: ModelProvider = {
      complete: mock(() => Promise.reject(new Error('model error'))),
      stream: mock((): AsyncIterable<StreamEvent> => {
        throw new Error('stream not implemented');
      }),
    };
    const errorDeps = { ...deps, model: errorModel };
    const result = await performRecall('this is a test message', errorDeps);
    expect(result).not.toBeNull();
    expect(mockSearchStore.search).toHaveBeenCalled();
  });

  test('AC5.2: malformed JSON from model triggers fallback to raw message', async () => {
    const badJsonModel: ModelProvider = {
      complete: mock(() =>
        Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: 'not valid json',
            },
          ],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 10, output_tokens: 20 },
        } as ModelResponse)
      ),
      stream: mock((): AsyncIterable<StreamEvent> => {
        throw new Error('stream not implemented');
      }),
    };
    const badDeps = { ...deps, model: badJsonModel };
    const result = await performRecall('this is a test message', badDeps);
    expect(result).not.toBeNull();
    expect(mockSearchStore.search).toHaveBeenCalled();
  });

  test('AC5.3: hybrid search mode is passed through to SearchStore for semantic queries', async () => {
    await performRecall('this is a test message', deps);
    expect(mockSearchStore.search).toHaveBeenCalled();
    const searchCall = (mockSearchStore.search as any).mock.calls[0];
    expect(searchCall).toBeDefined();
    const searchParams = searchCall[0] as SearchParams;
    expect(searchParams.mode).toBe('hybrid');
  });

  test('returns null when search returns empty results', async () => {
    const emptySearchStore = {
      ...mockSearchStore,
      search: mock(() => Promise.resolve([])),
    };
    const emptyDeps = { ...deps, searchStore: emptySearchStore };
    const result = await performRecall('this is a test message', emptyDeps);
    expect(result).toBeNull();
  });

  test('traces are recorded when traceRecorder is provided', async () => {
    await performRecall('this is a test message', deps);
    expect(mockTraceRecorder.record).toHaveBeenCalled();
    const traceCall = (mockTraceRecorder.record as any).mock.calls[0];
    expect(traceCall).toBeDefined();
    const trace = traceCall[0] as Omit<OperationTrace, 'id' | 'createdAt'>;
    expect(trace.owner).toBe('test-owner');
    expect(trace.conversationId).toBe('test-conv');
    expect(trace.toolName).toBe('recall');
    expect(trace.success).toBe(true);
  });

  test('trace is recorded even when search returns empty', async () => {
    const emptySearchStore = {
      ...mockSearchStore,
      search: mock(() => Promise.resolve([])),
    };
    const emptyDeps = { ...deps, searchStore: emptySearchStore };
    await performRecall('this is a test message', emptyDeps);
    expect(mockTraceRecorder.record).toHaveBeenCalled();
  });

  test('skips trace recording when traceRecorder is not provided', async () => {
    const noDeps = { ...deps, traceRecorder: undefined };
    const result = await performRecall('this is a test message', noDeps);
    expect(result).not.toBeNull();
    expect(mockTraceRecorder.record).not.toHaveBeenCalled();
  });
});
