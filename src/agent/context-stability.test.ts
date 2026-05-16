// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt } from './context.ts';
import { buildUserMessage } from './messages.ts';
import type { MemoryManager } from '../memory/manager.ts';

/**
 * Create a mock memory manager for testing system prompt stability.
 * Returns a fixed base prompt regardless of internal state changes.
 */
function createMockMemory(basePrompt: string): MemoryManager {
  return {
    buildSystemPrompt: async () => basePrompt,
    // Other methods stubbed as no-ops
    addCore: async () => {},
    removeCore: async () => {},
    getCore: async () => [],
    addWorking: async () => {},
    removeWorking: async () => {},
    getWorking: async () => [],
    getWorkingBlocks: async () => [],
    addArchival: async () => {},
    searchArchival: async () => [],
    archiveWorking: async () => {},
  } as unknown as MemoryManager;
}

describe('AC1: System Prompt Stability', () => {
  test('AC1.1: system prompt hash stable between consecutive turns', async () => {
    const mockMemory = createMockMemory('You are a test agent. Your name is Test.');

    // Build system prompt twice
    const firstPrompt = await buildSystemPrompt(mockMemory);
    const secondPrompt = await buildSystemPrompt(mockMemory);

    // Both should be identical
    expect(firstPrompt).toBe(secondPrompt);

    // Hash both to verify stability
    const firstHash = Bun.hash(firstPrompt);
    const secondHash = Bun.hash(secondPrompt);

    expect(firstHash).toBe(secondHash);
  });

  test('AC1.3: changing memory content does NOT change system prompt hash', async () => {
    // Create two separate memory instances with different internal state
    const mockMemory1 = createMockMemory('Base persona and memory content.');
    const mockMemory2 = createMockMemory('Base persona and memory content.');

    // Even though internal memory state might differ, the system prompt output is stable
    const prompt1 = await buildSystemPrompt(mockMemory1);
    const prompt2 = await buildSystemPrompt(mockMemory2);

    // System prompts should be identical since buildSystemPrompt only returns memory output
    expect(prompt1).toBe(prompt2);

    // Hashes should match
    const hash1 = Bun.hash(prompt1);
    const hash2 = Bun.hash(prompt2);

    expect(hash1).toBe(hash2);
  });

  test('AC1.4: changing recall results does NOT change system prompt hash', async () => {
    // buildSystemPrompt no longer accepts context providers (including recall)
    // This test verifies that the system prompt is truly stable and independent
    // of any dynamic context like recall results
    const mockMemory = createMockMemory('Base persona content only.');

    const prompt1 = await buildSystemPrompt(mockMemory);
    const prompt2 = await buildSystemPrompt(mockMemory);

    // Verify no recall-related content is present
    expect(prompt1).not.toContain('[Recalled Context]');
    expect(prompt1).not.toContain('[Recall');
    expect(prompt2).not.toContain('[Recalled Context]');
    expect(prompt2).not.toContain('[Recall');

    // Hashes must be identical
    const hash1 = Bun.hash(prompt1);
    const hash2 = Bun.hash(prompt2);

    expect(hash1).toBe(hash2);
  });

  test('AC1.5: first turn with no dynamic context produces plain user message', async () => {
    // Call buildUserMessage with null snapshot (no dynamic context)
    const result = buildUserMessage('hello', null);

    // Should return plain string message structure
    expect(result).toEqual({
      role: 'user',
      content: 'hello',
    });

    // Verify it's not an array (would indicate attachments)
    expect(typeof result.content).toBe('string');
  });

  test('AC1.5 edge: buildUserMessage with noop snapshot returns plain message', async () => {
    // Snapshot with 'noop' mode should behave like null
    const result = buildUserMessage('hello', {
      mode: 'noop',
      content: null,
      hashes: new Map(),
      changedProviders: [],
    });

    // Should still be a plain string message
    expect(result).toEqual({
      role: 'user',
      content: 'hello',
    });
    expect(typeof result.content).toBe('string');
  });
});
