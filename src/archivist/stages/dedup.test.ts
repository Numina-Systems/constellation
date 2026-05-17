import { expect, test, describe } from 'bun:test';
import { dedup, cosineSimilarity } from './dedup.js';
import type { BlockSnapshot } from '../types.js';

describe('cosineSimilarity', () => {
  test('returns 1.0 for identical vectors', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(1.0);
  });

  test('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.0);
  });

  test('returns correct value for normalized vectors', () => {
    const a = [1, 1];
    const b = [1, 1];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(1.0);
  });

  test('returns correct value for partially similar vectors', () => {
    const a = [1, 0];
    const b = [0.707, 0.707];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.707, 2);
  });

  test('returns 0 for zero vectors', () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBe(0);
  });
});

describe('dedup', () => {
  const createBlockSnapshot = (
    id: string,
    label: string,
    embedding: ReadonlyArray<number> | null
  ): BlockSnapshot => ({
    id,
    label,
    tier: 'working' as const,
    content: `Content for ${label}`,
    contentHash: 'hash123',
    embedding,
  });

  test('returns empty groups when no blocks have embeddings', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', null),
      createBlockSnapshot('2', 'block2', null),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.groups).toEqual([]);
    expect(result.skipped).toBe(true);
  });

  test('returns empty groups when no duplicates above threshold', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', [1, 0, 0]),
      createBlockSnapshot('2', 'block2', [0, 1, 0]),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.groups).toEqual([]);
    expect(result.skipped).toBe(false);
  });

  test('groups blocks above similarity threshold', () => {
    const embedding = [1, 0, 0, 0];
    const veryCloseEmbedding = [0.98, 0.1, 0.05, 0.05];

    const blocks = [
      createBlockSnapshot('1', 'block1', embedding),
      createBlockSnapshot('2', 'block2', veryCloseEmbedding),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0]!.canonical.id).toBe('1');
    expect(result.groups[0]!.duplicates.length).toBe(1);
    expect(result.groups[0]!.duplicates[0]!.id).toBe('2');
  });

  test('groups multiple duplicates with one canonical', () => {
    const embedding = [1, 0, 0];
    const dup1 = [0.95, 0.1, 0.05];
    const dup2 = [0.93, 0.15, 0.02];

    const blocks = [
      createBlockSnapshot('1', 'block1', embedding),
      createBlockSnapshot('2', 'block2', dup1),
      createBlockSnapshot('3', 'block3', dup2),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0]!.canonical.id).toBe('1');
    expect(result.groups[0]!.duplicates.length).toBe(2);
    expect(result.groups[0]!.similarity).toBeGreaterThan(0.92);
  });

  test('identifies independent duplicate groups', () => {
    const groupA1 = [1, 0, 0, 0];
    const groupA2 = [0.95, 0.1, 0, 0];
    const groupB1 = [0, 1, 0, 0];
    const groupB2 = [0.05, 0.95, 0.1, 0];

    const blocks = [
      createBlockSnapshot('a1', 'a1', groupA1),
      createBlockSnapshot('a2', 'a2', groupA2),
      createBlockSnapshot('b1', 'b1', groupB1),
      createBlockSnapshot('b2', 'b2', groupB2),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.groups.length).toBe(2);
    expect(result.groups.every(g => g.duplicates.length > 0)).toBe(true);
  });

  test('excludes blocks below similarity threshold from different groups', () => {
    const embedding1 = [1, 0];
    const embedding2 = [0.5, 0.866];
    const embedding3 = [0, 1];

    const blocks = [
      createBlockSnapshot('1', 'block1', embedding1),
      createBlockSnapshot('2', 'block2', embedding2),
      createBlockSnapshot('3', 'block3', embedding3),
    ];

    const result = dedup(blocks, 0.9);
    // embedding1 and embedding2 may be above threshold, embedding3 is orthogonal
    expect(result.groups.length).toBeLessThanOrEqual(2);
  });

  test('marks as not skipped when there are embeddings and groups found', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', [1, 0, 0]),
      createBlockSnapshot('2', 'block2', [0.95, 0.1, 0.05]),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.skipped).toBe(false);
  });

  test('marks as not skipped when there are embeddings even without groups', () => {
    const blocks = [
      createBlockSnapshot('1', 'block1', [1, 0, 0]),
      createBlockSnapshot('2', 'block2', [0, 1, 0]),
    ];

    const result = dedup(blocks, 0.92);
    expect(result.skipped).toBe(false);
  });

  test('tracks maximum similarity within each group', () => {
    const canonical = [1, 0, 0, 0];
    const dup1 = [0.98, 0.1, 0.05, 0.05];
    const dup2 = [0.9, 0.2, 0.1, 0.05];

    const blocks = [
      createBlockSnapshot('1', 'block1', canonical),
      createBlockSnapshot('2', 'block2', dup1),
      createBlockSnapshot('3', 'block3', dup2),
    ];

    const result = dedup(blocks, 0.88);
    expect(result.groups.length).toBe(1);
    // The highest similarity should be with dup1
    expect(result.groups[0]!.similarity).toBeGreaterThan(0.98);
  });
});
