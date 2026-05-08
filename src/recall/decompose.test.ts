// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import type { ModelProvider, ModelRequest, ModelResponse } from '@/model/types.js';
import { parseDecompositionResponse, decomposeMessage } from './decompose.js';

/**
 * Mock ModelProvider factory for testing.
 * Returns a ModelProvider that responds with customizable text.
 */
function createMockModel(responseText: string): ModelProvider {
  const calls: Array<ModelRequest> = [];

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      calls.push(request);
      return {
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };
    },
    async *stream() {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
    _calls: calls,
  } as unknown as ModelProvider;
}

/**
 * Mock ModelProvider factory that throws on complete().
 */
function createFailingMockModel(): ModelProvider {
  return {
    async complete(): Promise<ModelResponse> {
      throw new Error('Model error');
    },
    async *stream() {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
  } as unknown as ModelProvider;
}

describe('parseDecompositionResponse', () => {
  describe('reflexive-recall.AC1.1: Parse valid JSON with queries and entities', () => {
    it('extracts queries and entities from valid JSON', () => {
      const json = JSON.stringify({
        queries: ['CalDAV project'],
        entities: ['CalDAV'],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual(['CalDAV project']);
      expect(result.entities).toEqual(['CalDAV']);
    });

    it('handles CalDAV example from spec', () => {
      const json = JSON.stringify({
        queries: ['CalDAV project overview', 'CalDAV implementation details'],
        entities: ['CalDAV', 'WebDAV'],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries.length).toBeGreaterThanOrEqual(1);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      expect(result.queries[0]).toContain('CalDAV');
      expect(result.entities.includes('CalDAV')).toBe(true);
    });
  });

  describe('reflexive-recall.AC1.2: Parse multiple distinct topics', () => {
    it('handles multiple queries covering distinct topics', () => {
      const json = JSON.stringify({
        queries: ['topic A discussion', 'topic B analysis', 'topic C implementation'],
        entities: ['TopicA', 'TopicB', 'TopicC'],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries.length).toBe(3);
      expect(result.entities.length).toBe(3);
    });
  });

  describe('reflexive-recall.AC1.3: Single-word message produces one query', () => {
    it('handles single-word query', () => {
      const json = JSON.stringify({
        queries: ['Python'],
        entities: ['Python'],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries.length).toBe(1);
      expect(result.queries[0]).toBe('Python');
    });
  });

  describe('reflexive-recall.AC1.4: Message with no proper nouns produces empty entities', () => {
    it('returns empty entities when none present', () => {
      const json = JSON.stringify({
        queries: ['how to write code'],
        entities: [],
      });

      const result = parseDecompositionResponse(json);

      expect(result.entities.length).toBe(0);
      expect(result.queries.length).toBeGreaterThan(0);
    });
  });

  describe('reflexive-recall.AC5.2: Invalid JSON triggers fallback', () => {
    it('returns empty result for plain text (not JSON)', () => {
      const result = parseDecompositionResponse('This is not JSON');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('returns empty result for truncated JSON', () => {
      const result = parseDecompositionResponse('{"queries": ["incomplete"');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('returns empty result for missing fields', () => {
      const json = JSON.stringify({
        queries: ['valid'],
        // missing 'entities' field
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('returns empty result for malformed structure (queries not array)', () => {
      const json = JSON.stringify({
        queries: 'not an array',
        entities: [],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('returns empty result for non-string query values', () => {
      const json = JSON.stringify({
        queries: [123, 456],
        entities: [],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('handles empty arrays', () => {
      const json = JSON.stringify({
        queries: [],
        entities: [],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('handles arrays with empty strings', () => {
      const json = JSON.stringify({
        queries: [''],
        entities: [''],
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual(['']);
      expect(result.entities).toEqual(['']);
    });

    it('ignores extra fields in JSON', () => {
      const json = JSON.stringify({
        queries: ['test query'],
        entities: ['TestEntity'],
        extra: 'ignored',
        another: 123,
      });

      const result = parseDecompositionResponse(json);

      expect(result.queries).toEqual(['test query']);
      expect(result.entities).toEqual(['TestEntity']);
    });
  });
});

describe('decomposeMessage', () => {
  describe('reflexive-recall.AC1.1: Decompose CalDAV-style message', () => {
    it('decomposes a message with project reference', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['CalDAV project'],
          entities: ['CalDAV'],
        }),
      );

      const result = await decomposeMessage('Tell me about the CalDAV project', model, 'test-model');

      expect(result.queries).toEqual(['CalDAV project']);
      expect(result.entities).toEqual(['CalDAV']);
    });
  });

  describe('reflexive-recall.AC1.2: Multi-topic decomposition', () => {
    it('produces 2-4 distinct queries for multi-topic message', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['topic A analysis', 'topic B discussion', 'topic C implementation'],
          entities: ['TopicA', 'TopicB', 'TopicC'],
        }),
      );

      const result = await decomposeMessage(
        'Tell me about topic A, how does topic B work, and what about topic C?',
        model,
        'test-model',
      );

      expect(result.queries.length).toBeGreaterThanOrEqual(2);
      expect(result.queries.length).toBeLessThanOrEqual(4);
    });
  });

  describe('reflexive-recall.AC1.3: Single-word message', () => {
    it('produces one query for single-word message', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['Python'],
          entities: ['Python'],
        }),
      );

      const result = await decomposeMessage('Python', model, 'test-model');

      expect(result.queries.length).toBe(1);
      expect(result.queries[0]).toContain('Python');
    });
  });

  describe('reflexive-recall.AC1.4: No proper nouns', () => {
    it('produces empty entities for message without proper nouns', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['how to write functions'],
          entities: [],
        }),
      );

      const result = await decomposeMessage('How do I write functions?', model, 'test-model');

      expect(result.entities).toEqual([]);
      expect(result.queries.length).toBeGreaterThan(0);
    });
  });

  describe('reflexive-recall.AC5.1: Model failure fallback', () => {
    it('returns empty result when model.complete() throws', async () => {
      const model = createFailingMockModel();

      const result = await decomposeMessage('Some message', model, 'test-model');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });
  });

  describe('reflexive-recall.AC5.2: Malformed JSON from model', () => {
    it('returns empty result when model returns plain text', async () => {
      const model = createMockModel('This is plain text, not JSON');

      const result = await decomposeMessage('Some message', model, 'test-model');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('returns empty result when model returns truncated JSON', async () => {
      const model = createMockModel('{"queries": ["incomplete"');

      const result = await decomposeMessage('Some message', model, 'test-model');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });
  });

  describe('Model integration', () => {
    it('calls model.complete with correct parameters', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['test query'],
          entities: [],
        }),
      );

      await decomposeMessage('Test message', model, 'gpt-4-turbo');

      const calls = (model as any)._calls as Array<ModelRequest>;
      expect(calls.length).toBe(1);

      const request = calls[0]!;
      expect(request.model).toBe('gpt-4-turbo');
      expect(request.max_tokens).toBe(256);
      expect(request.temperature).toBe(0);
      expect(request.messages[0]?.content).toBe('Test message');
      expect(request.system).toBeDefined();
    });

    it('handles model response with text content block', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['extracted query'],
          entities: ['ExtractedEntity'],
        }),
      );

      const result = await decomposeMessage('Input message', model, 'test-model');

      expect(result.queries).toEqual(['extracted query']);
      expect(result.entities).toEqual(['ExtractedEntity']);
    });

    it('returns empty result if response has no text content', async () => {
      const model = {
        async complete(): Promise<ModelResponse> {
          return {
            content: [], // Empty content
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 0,
            },
          };
        },
        async *stream() {
          yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
        },
      } as unknown as ModelProvider;

      const result = await decomposeMessage('Test', model, 'test-model');

      expect(result.queries).toEqual([]);
      expect(result.entities).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('handles very long message', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['long message summary'],
          entities: [],
        }),
      );

      const longMessage = 'word '.repeat(1000);

      const result = await decomposeMessage(longMessage, model, 'test-model');

      expect(result.queries).toEqual(['long message summary']);
    });

    it('handles message with special characters', async () => {
      const model = createMockModel(
        JSON.stringify({
          queries: ['special chars'],
          entities: [],
        }),
      );

      const result = await decomposeMessage('Message with @#$%^&*() special chars!', model, 'test-model');

      expect(result.queries.length).toBeGreaterThanOrEqual(0);
    });
  });
});
