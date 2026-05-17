// pattern: Mixed (pure helpers tightly coupled to scan I/O)

import type { MemoryStore } from '@/memory/store.js';
import type { MemoryBlock } from '@/memory/types.js';
import type { BlockSnapshot, ScanResult } from '../types.js';
import { createHash } from 'node:crypto';

type ScanDeps = {
  readonly memoryStore: MemoryStore;
  readonly owner: string;
};

const EXCLUDED_LABEL_PREFIXES = ['archivist:', 'diary:'];

export function isEligible(block: MemoryBlock): boolean {
  if (block.permission !== 'readwrite') return false;
  if (block.pinned) return false;
  for (const prefix of EXCLUDED_LABEL_PREFIXES) {
    if (block.label.startsWith(prefix)) return false;
  }
  return true;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function toSnapshot(block: MemoryBlock): BlockSnapshot {
  return {
    id: block.id,
    label: block.label,
    tier: block.tier,
    content: block.content,
    contentHash: hashContent(block.content),
    embedding: block.embedding,
  };
}

export async function scan(deps: ScanDeps): Promise<ScanResult> {
  const { memoryStore, owner } = deps;

  const workingBlocks = await memoryStore.getBlocksByTier(owner, 'working');
  const archivalBlocks = await memoryStore.getBlocksByTier(owner, 'archival');
  const allBlocks = [...workingBlocks, ...archivalBlocks];

  const eligible = allBlocks.filter(isEligible).map(toSnapshot);

  return {
    blocks: eligible,
    scannedAt: new Date(),
  };
}
