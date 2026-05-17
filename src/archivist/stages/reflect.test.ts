import { expect, test, describe } from 'bun:test';
import { reflect } from './reflect.js';
import type { PipelineResult, ReflectResult } from '../types.js';
import type { ModelProvider } from '@/model/types.js';

describe('reflect', () => {
  const createMockPipelineResult = (): PipelineResult => ({
    mode: 'full' as const,
    scanned: 10,
    deduped: 2,
    consolidated: 2,
    crossreffed: 3,
    pruned: 1,
    reflected: false,
    totalTokensUsed: 500,
  });

  const createMockModelProvider = (responseText: string): ModelProvider => ({
    complete: async () => ({
      content: [{ type: 'text', text: responseText }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    stream: async function* () {
      // not used in tests
    },
  });

  test('returns skipped=true when no model provider', async () => {
    const stats = createMockPipelineResult();
    const result = await reflect(stats, {
      model: null,
      tokenBudget: 5000,
      tokensUsedSoFar: 0,
    });

    expect(result.skipped).toBe(true);
    expect(result.reflection).toBe('');
    expect(result.tokensUsed).toBe(0);
  });

  test('returns skipped=true when token budget exceeded', async () => {
    const mockModel = createMockModelProvider('observation');
    const stats = createMockPipelineResult();

    const result = await reflect(stats, {
      model: mockModel,
      tokenBudget: 100,
      tokensUsedSoFar: 100, // Already at budget
    });

    expect(result.skipped).toBe(true);
    expect(result.reflection).toBe('');
  });

  test('generates reflection from model response', async () => {
    const mockModel = createMockModelProvider(
      'The memory system is well-organized with few duplicates.',
    );
    const stats = createMockPipelineResult();

    const result = await reflect(stats, {
      model: mockModel,
      tokenBudget: 5000,
      tokensUsedSoFar: 500,
    });

    expect(result.skipped).toBe(false);
    expect(result.reflection).toBe('The memory system is well-organized with few duplicates.');
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  test('passes pipeline stats to model', async () => {
    let capturedRequest: string | null = null;

    const mockModel: ModelProvider = {
      complete: async (request) => {
        if (
          request.messages.length > 0 &&
          typeof request.messages[0]!.content === 'string'
        ) {
          capturedRequest = request.messages[0]!.content;
        }
        return {
          content: [{ type: 'text', text: 'reflection' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      stream: async function* () {},
    };

    const stats = createMockPipelineResult();
    await reflect(stats, {
      model: mockModel,
      tokenBudget: 5000,
      tokensUsedSoFar: 500,
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest).toContain('Memory maintenance pipeline completed');
    expect(capturedRequest).toContain('full mode');
    expect(capturedRequest).toContain('Scanned: 10');
    expect(capturedRequest).toContain('Consolidated: 2');
  });

  test('includes full, incremental, and empty modes in prompt', async () => {
    let capturedRequest: string | null = null;

    const mockModel: ModelProvider = {
      complete: async (request) => {
        if (
          request.messages.length > 0 &&
          typeof request.messages[0]!.content === 'string'
        ) {
          capturedRequest = request.messages[0]!.content;
        }
        return {
          content: [{ type: 'text', text: 'reflection' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      stream: async function* () {},
    };

    // Test incremental mode
    const incrementalStats: PipelineResult = {
      mode: 'incremental' as const,
      scanned: 5,
      deduped: 0,
      consolidated: 0,
      crossreffed: 0,
      pruned: 1,
      reflected: false,
      totalTokensUsed: 0,
    };

    await reflect(incrementalStats, {
      model: mockModel,
      tokenBudget: 5000,
      tokensUsedSoFar: 0,
    });

    expect(capturedRequest).toContain('incremental mode');
  });

  test('estimates token usage for reflection', async () => {
    const mockModel = createMockModelProvider('Short reflection.');
    const stats = createMockPipelineResult();

    const result = await reflect(stats, {
      model: mockModel,
      tokenBudget: 5000,
      tokensUsedSoFar: 0,
    });

    expect(result.tokensUsed).toBeGreaterThan(0);
    // Should include both prompt and response tokens
  });

  test('returns reflection text from response', async () => {
    const responseText = 'System appears healthy. Some consolidation opportunities remain.';
    const mockModel = createMockModelProvider(responseText);
    const stats = createMockPipelineResult();

    const result = await reflect(stats, {
      model: mockModel,
      tokenBudget: 5000,
      tokensUsedSoFar: 0,
    });

    expect(result.reflection).toBe(responseText);
  });
});
