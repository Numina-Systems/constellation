// pattern: Functional Core

import type { BlockSnapshot, DedupGroup, DedupResult } from '../types.js';

export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function dedup(
  blocks: ReadonlyArray<BlockSnapshot>,
  threshold: number,
): DedupResult {
  const withEmbeddings = blocks.filter(b => b.embedding !== null);
  if (withEmbeddings.length === 0) {
    return { groups: [], skipped: true };
  }

  const merged = new Set<string>();
  const groups: Array<DedupGroup> = [];

  for (let i = 0; i < withEmbeddings.length; i++) {
    const canonical = withEmbeddings[i]!;
    if (merged.has(canonical.id)) continue;

    const duplicates: Array<BlockSnapshot> = [];
    let maxSim = 0;

    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const candidate = withEmbeddings[j]!;
      if (merged.has(candidate.id)) continue;

      const sim = cosineSimilarity(canonical.embedding!, candidate.embedding!);
      if (sim >= threshold) {
        duplicates.push(candidate);
        merged.add(candidate.id);
        maxSim = Math.max(maxSim, sim);
      }
    }

    if (duplicates.length > 0) {
      merged.add(canonical.id);
      groups.push({ canonical, duplicates, similarity: maxSim });
    }
  }

  return { groups, skipped: false };
}
