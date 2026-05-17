// pattern: Functional Core

import type { BlockSnapshot, PruneResult } from '../types.js';

export function prune(blocks: ReadonlyArray<BlockSnapshot>): PruneResult {
  const prunedIds = blocks
    .filter(b => b.content.trim().length === 0)
    .map(b => b.id);
  return { prunedIds };
}
