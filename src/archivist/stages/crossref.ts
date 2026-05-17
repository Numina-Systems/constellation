// pattern: Functional Core

import { cosineSimilarity } from './dedup.js';
import type { BlockSnapshot, CrossrefAction, CrossrefResult } from '../types.js';

export function crossref(
  blocks: ReadonlyArray<BlockSnapshot>,
  crossrefThreshold: number,
  dedupThreshold: number,
): CrossrefResult {
  const withEmbeddings = blocks.filter(b => b.embedding !== null);
  if (withEmbeddings.length === 0) {
    return { actions: [], skipped: true };
  }

  const actions: Array<CrossrefAction> = [];

  for (const block of withEmbeddings) {
    const related: Array<string> = [];
    for (const other of withEmbeddings) {
      if (other.id === block.id) continue;
      const sim = cosineSimilarity(block.embedding!, other.embedding!);
      if (sim >= crossrefThreshold && sim < dedupThreshold) {
        related.push(other.label);
      }
    }
    if (related.length > 0) {
      actions.push({ blockId: block.id, relatedLabels: related });
    }
  }

  return { actions, skipped: false };
}
