import { expect, test, describe } from 'bun:test';
import { consolidate } from './consolidate.js';
import type { DedupGroup } from '../types.js';
import type { ModelProvider } from '@/model/types.js';

describe('consolidate', () => {
  const createBlockSnapshot = (id: string, label: string, content: string) => ({
    id,
    label,
    tier: 'working' as const,
    content,
    contentHash: 'hash',
    embedding: null,
  });

  const createDedupGroup = (
    canonicalId: string,
    canonicalLabel: string,
    canonicalContent: string,
    duplicateIds: Array<{ id: string; label: string; content: string }>,
  ): DedupGroup => ({
    canonical: createBlockSnapshot(canonicalId, canonicalLabel, canonicalContent),
    duplicates: duplicateIds.map(d => createBlockSnapshot(d.id, d.label, d.content)),
    similarity: 0.95,
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

  test('returns empty actions and skipped=true when no model provider', async () => {
    const groups = [
      createDedupGroup('1', 'block1', 'content1', [
        { id: '2', label: 'block2', content: 'content2' },
      ]),
    ];

    const result = await consolidate(groups, { model: null, modelName: 'claude-3-5-sonnet', tokenBudget: 5000 });

    expect(result.actions.length).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.tokensUsed).toBe(0);
  });

  test('returns empty actions when no groups provided', async () => {
    const mockModel = createMockModelProvider('merged');
    const result = await consolidate([], { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 5000 });

    expect(result.actions.length).toBe(0);
    expect(result.skipped).toBe(false);
  });

  test('consolidates a group with merged content from model', async () => {
    const mockModel = createMockModelProvider('Consolidated content here');
    const groups = [
      createDedupGroup('1', 'block1', 'content1', [
        { id: '2', label: 'block2', content: 'content2' },
      ]),
    ];

    const result = await consolidate(groups, { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 5000 });

    expect(result.actions.length).toBe(1);
    const action = result.actions[0];
    expect(action).toBeDefined();
    expect(action!.group).toEqual(groups[0]!);
    expect(action!.mergedContent).toBe('Consolidated content here');
    expect(result.skipped).toBe(false);
  });

  test('stops processing when token budget is exhausted', async () => {
    const mockModel = createMockModelProvider('M'.repeat(3000)); // Large response
    const groups = [
      createDedupGroup('1', 'block1', 'a'.repeat(500), [
        { id: '2', label: 'block2', content: 'b'.repeat(500) },
      ]),
      createDedupGroup('3', 'block3', 'c'.repeat(500), [
        { id: '4', label: 'block4', content: 'd'.repeat(500) },
      ]),
    ];

    // First group: ~255 tokens input + 750 tokens response = 1005
    // Second group check: 1005 + 255 = 1260 > 1200, stops
    const result = await consolidate(groups, { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 1200 });

    // Should only process first group
    expect(result.actions.length).toBe(1);
  });

  test('includes all content from group in model request', async () => {
    let capturedRequest: string | null = null;

    const mockModel: ModelProvider = {
      complete: async (request) => {
        // Capture the request content
        if (
          request.messages.length > 0 &&
          typeof request.messages[0]!.content === 'string'
        ) {
          capturedRequest = request.messages[0]!.content;
        }
        return {
          content: [{ type: 'text', text: 'merged' }],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      stream: async function* () {
        // not used
      },
    };

    const groups = [
      createDedupGroup('1', 'block1', 'canonical content', [
        { id: '2', label: 'block2', content: 'dup1 content' },
        { id: '3', label: 'block3', content: 'dup2 content' },
      ]),
    ];

    await consolidate(groups, { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 5000 });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.includes('[block1]')).toBe(true);
    expect(capturedRequest!.includes('canonical content')).toBe(true);
    expect(capturedRequest!.includes('[block2]')).toBe(true);
    expect(capturedRequest!.includes('dup1 content')).toBe(true);
    expect(capturedRequest!.includes('[block3]')).toBe(true);
    expect(capturedRequest!.includes('dup2 content')).toBe(true);
  });

  test('estimates tokens and tracks usage', async () => {
    const mockModel = createMockModelProvider('Response text');
    const groups = [
      createDedupGroup('1', 'block1', 'a'.repeat(400), [
        { id: '2', label: 'block2', content: 'b'.repeat(400) },
      ]),
    ];

    const result = await consolidate(groups, { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 5000 });

    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.skipped).toBe(false);
  });

  test('does not process groups when budget insufficient before starting', async () => {
    const mockModel = createMockModelProvider('merged');
    const groups = [
      createDedupGroup('1', 'block1', 'a'.repeat(5000), [
        { id: '2', label: 'block2', content: 'b'.repeat(5000) },
      ]),
    ];

    const result = await consolidate(groups, { model: mockModel, modelName: 'claude-3-5-sonnet', tokenBudget: 100 });

    // Budget is too small to even start processing
    expect(result.actions.length).toBe(0);
  });
});
