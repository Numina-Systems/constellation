import { expect, test, describe } from 'bun:test';
import { crossref } from './crossref.js';
import type { BlockSnapshot } from '../types.js';

describe('crossref', () => {
  const createBlockSnapshot = (
    id: string,
    label: string,
    embedding: ReadonlyArray<number> | null,
  ): BlockSnapshot => ({
    id,
    label,
    tier: 'working' as const,
    content: `Content for ${label}`,
    contentHash: 'hash123',
    embedding,
  });

  test('returns empty actions and skipped=true when no blocks have embeddings', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', null),
      createBlockSnapshot('2', 'block2', null),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.actions).toEqual([]);
    expect(result.skipped).toBe(true);
  });

  test('excludes blocks below crossref threshold', () => {
    const block1 = [1, 0, 0];
    const block2 = [0, 1, 0]; // Orthogonal, similarity ~0

    const blocks = [
      createBlockSnapshot('1', 'block1', block1),
      createBlockSnapshot('2', 'block2', block2),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.actions.length).toBe(0);
  });

  test('excludes blocks at or above dedup threshold', () => {
    const block1 = [1, 0, 0];
    const block2 = [0.95, 0.1, 0.05]; // Very similar, > 0.92

    const blocks = [
      createBlockSnapshot('1', 'block1', block1),
      createBlockSnapshot('2', 'block2', block2),
    ];

    // These are duplicates, not crossref targets
    const result = crossref(blocks, 0.75, 0.92);
    expect(result.actions.length).toBe(0);
  });

  test('includes blocks in [crossrefThreshold, dedupThreshold)', () => {
    const block1 = [1, 0, 0];
    const block2 = [0.8, 0.4, 0.3]; // Similarity ~0.8, in range [0.75, 0.92)

    const blocks = [
      createBlockSnapshot('1', 'block1', block1),
      createBlockSnapshot('2', 'block2', block2),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.some(a => a.blockId === '1')).toBe(true);
    expect(result.actions[0]!.relatedLabels).toContain('block2');
  });

  test('marks as not skipped when there are embeddings', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', [1, 0, 0]),
      createBlockSnapshot('2', 'block2', [0, 1, 0]),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.skipped).toBe(false);
  });

  test('identifies multiple related blocks for one block', () => {
    const canonical = [1, 0, 0, 0];
    const related1 = [0.75, 0.4, 0.3, 0.2]; // Similarity in [0.75, 0.92)
    const related2 = [0.76, 0.39, 0.3, 0.2]; // Similarity in [0.75, 0.92)

    const blocks = [
      createBlockSnapshot('1', 'canonical', canonical),
      createBlockSnapshot('2', 'related1', related1),
      createBlockSnapshot('3', 'related2', related2),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.actions.length).toBeGreaterThan(0);
    const action = result.actions.find(a => a.blockId === '1');
    expect(action).toBeDefined();
    expect(action!.relatedLabels.length).toBe(2);
    expect(action!.relatedLabels).toContain('related1');
    expect(action!.relatedLabels).toContain('related2');
  });

  test('excludes self-references', () => {
    const embedding = [1, 0, 0];

    const blocks = [createBlockSnapshot('1', 'block1', embedding)];

    const result = crossref(blocks, 0.75, 0.92);
    // Block can only reference itself (similarity 1.0), which is >= dedup threshold
    expect(result.actions.length).toBe(0);
  });

  test('handles mixed embeddings and null values', () => {
    const block1 = [1, 0, 0];
    const block2 = [0.8, 0.4, 0.3]; // Related but not duplicate, similarity ~0.8

    const blocks = [
      createBlockSnapshot('1', 'block1', block1),
      createBlockSnapshot('2', 'block2', block2),
      createBlockSnapshot('3', 'block3', null), // No embedding
    ];

    const result = crossref(blocks, 0.75, 0.92);
    expect(result.skipped).toBe(false);
    // Only blocks 1 and 2 are compared
    expect(result.actions.length).toBeGreaterThan(0);
  });

  test('correctly orders related labels', () => {
    const canonical = [1, 0, 0, 0];
    const veryClose = [0.85, 0.3, 0.2, 0.1]; // In [0.75, 0.92)
    const close = [0.76, 0.4, 0.3, 0.2]; // In [0.75, 0.92)

    const blocks = [
      createBlockSnapshot('1', 'canonical', canonical),
      createBlockSnapshot('2', 'veryClose', veryClose),
      createBlockSnapshot('3', 'close', close),
    ];

    const result = crossref(blocks, 0.75, 0.92);
    const action = result.actions.find(a => a.blockId === '1');
    expect(action).toBeDefined();
    expect(action!.relatedLabels.length).toBe(2);
  });
});
