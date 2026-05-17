import { expect, test, describe } from 'bun:test';
import { prune } from './prune.js';
import type { BlockSnapshot } from '../types.js';

describe('prune', () => {
  const createBlockSnapshot = (id: string, content: string): BlockSnapshot => ({
    id,
    label: `block-${id}`,
    tier: 'working' as const,
    content,
    contentHash: 'hash123',
    embedding: null,
  });

  test('returns empty list when no blocks are empty', () => {
    const blocks = [
      createBlockSnapshot('1', 'real content'),
      createBlockSnapshot('2', 'more real content'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toEqual([]);
  });

  test('identifies empty string blocks for pruning', () => {
    const blocks = [
      createBlockSnapshot('1', ''),
      createBlockSnapshot('2', 'content'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toContain('1');
    expect(result.prunedIds).not.toContain('2');
  });

  test('identifies whitespace-only blocks for pruning', () => {
    const blocks = [
      createBlockSnapshot('1', '   '),
      createBlockSnapshot('2', '\t\n'),
      createBlockSnapshot('3', '  \n  \t  '),
      createBlockSnapshot('4', 'real content'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toContain('1');
    expect(result.prunedIds).toContain('2');
    expect(result.prunedIds).toContain('3');
    expect(result.prunedIds).not.toContain('4');
  });

  test('returns correct block IDs for empty blocks', () => {
    const blocks = [
      createBlockSnapshot('first', ''),
      createBlockSnapshot('second', 'content'),
      createBlockSnapshot('third', '   '),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toEqual(['first', 'third']);
  });

  test('preserves order of pruned IDs', () => {
    const blocks = [
      createBlockSnapshot('a', ''),
      createBlockSnapshot('b', 'content'),
      createBlockSnapshot('c', '  '),
      createBlockSnapshot('d', 'more'),
      createBlockSnapshot('e', '\n'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toEqual(['a', 'c', 'e']);
  });

  test('handles single empty block', () => {
    const blocks = [createBlockSnapshot('only', '')];

    const result = prune(blocks);
    expect(result.prunedIds).toEqual(['only']);
  });

  test('handles all empty blocks', () => {
    const blocks = [
      createBlockSnapshot('1', ''),
      createBlockSnapshot('2', '  '),
      createBlockSnapshot('3', '\t'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds.length).toBe(3);
    expect(result.prunedIds).toContain('1');
    expect(result.prunedIds).toContain('2');
    expect(result.prunedIds).toContain('3');
  });

  test('does not prune blocks with non-whitespace content', () => {
    const blocks = [
      createBlockSnapshot('1', 'a'),
      createBlockSnapshot('2', 'a b c'),
      createBlockSnapshot('3', '\n\na\n\n'),
      createBlockSnapshot('4', '123'),
    ];

    const result = prune(blocks);
    expect(result.prunedIds).toEqual([]);
  });
});
