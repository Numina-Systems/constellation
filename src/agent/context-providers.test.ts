/**
 * Unit tests for buildSystemPrompt with context providers.
 * Verifies context provider output injection into system prompts.
 */

import { describe, it, expect } from 'bun:test';
import { buildSystemPrompt } from './context.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ContextProvider } from './types.ts';

function createMockMemoryManager(prompt: string): MemoryManager {
  return {
    buildSystemPrompt: async () => prompt,
    getWorkingBlocks: async () => [],
    addWorkingBlock: async () => {},
    removeWorkingBlock: async () => {},
    addArchivedBlock: async () => {},
    getArchivedBlocks: async () => [],
    searchMemory: async () => [],
    removeArchivedBlock: async () => {},
  } as unknown as MemoryManager;
}

describe('buildSystemPrompt with context providers', () => {
  it('returns memory prompt unchanged when no context providers', async () => {
    const memory = createMockMemoryManager('base prompt');
    const result = await buildSystemPrompt(memory);
    expect(result).toBe('base prompt');
  });

  it('appends context provider output to prompt', async () => {
    const memory = createMockMemoryManager('base prompt');
    const provider: ContextProvider = () => 'extra context';
    const result = await buildSystemPrompt(memory, [provider]);
    expect(result).toBe('base prompt\n\nextra context');
  });

  it('does not append when context provider returns undefined', async () => {
    const memory = createMockMemoryManager('base prompt');
    const provider: ContextProvider = () => undefined;
    const result = await buildSystemPrompt(memory, [provider]);
    expect(result).toBe('base prompt');
  });

  it('appends all non-undefined context provider outputs', async () => {
    const memory = createMockMemoryManager('base prompt');
    const provider1: ContextProvider = () => 'context 1';
    const provider2: ContextProvider = () => undefined;
    const provider3: ContextProvider = () => 'context 3';
    const result = await buildSystemPrompt(memory, [provider1, provider2, provider3]);
    expect(result).toBe('base prompt\n\ncontext 1\n\ncontext 3');
  });

  it('handles empty context provider array', async () => {
    const memory = createMockMemoryManager('base prompt');
    const result = await buildSystemPrompt(memory, []);
    expect(result).toBe('base prompt');
  });
});
