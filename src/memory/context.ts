// pattern: Functional Core

/**
 * Context provider for working-memory blocks.
 * Formats working blocks into a snapshot-pipeline section; the agent loop
 * refreshes the block list each round before snapshot composition.
 */

import type { ContextProvider } from '@/agent/types.js';
import type { MemoryBlock } from './types.js';

export type WorkingMemoryContextState = {
  setBlocks(blocks: ReadonlyArray<MemoryBlock>): void;
};

export function formatWorkingMemorySection(
  blocks: ReadonlyArray<MemoryBlock>,
): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((block) => `### ${block.label}\n${block.content}`).join('\n\n');
}

export function createWorkingMemoryContextProvider(): ContextProvider & WorkingMemoryContextState {
  let currentBlocks: ReadonlyArray<MemoryBlock> = [];

  const provider = () => formatWorkingMemorySection(currentBlocks);

  return Object.assign(provider, {
    setBlocks(blocks: ReadonlyArray<MemoryBlock>): void {
      currentBlocks = blocks;
    },
  });
}
