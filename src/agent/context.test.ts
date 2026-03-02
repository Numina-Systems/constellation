// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt } from './context.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ContextProvider } from './types.ts';

describe('buildSystemPrompt', () => {
  /**
   * Create a mock memory manager for testing
   */
  function createMockMemory(basePrompt: string): MemoryManager {
    return {
      buildSystemPrompt: async () => basePrompt,
      // Other methods stubbed
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

  test('rate-limiter.AC3.3: no context providers returns exact memory prompt', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const result = await buildSystemPrompt(mockMemory);
    expect(result).toBe('You are the spirit.');
  });

  test('rate-limiter.AC3.3: empty provider array returns exact memory prompt', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const result = await buildSystemPrompt(mockMemory, []);
    expect(result).toBe('You are the spirit.');
  });

  test('rate-limiter.AC3.1: single provider output appended to memory prompt', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const provider: ContextProvider = () => '## Resource Budget\nInput tokens: 1000/5000';
    const result = await buildSystemPrompt(mockMemory, [provider]);
    expect(result).toBe('You are the spirit.\n\n## Resource Budget\nInput tokens: 1000/5000');
  });

  test('rate-limiter.AC3.2: provider returns different values each call', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    let callCount = 0;
    const provider: ContextProvider = () => {
      callCount++;
      return `Budget: ${callCount * 100}/5000`;
    };

    const result1 = await buildSystemPrompt(mockMemory, [provider]);
    expect(result1).toBe('You are the spirit.\n\nBudget: 100/5000');

    const result2 = await buildSystemPrompt(mockMemory, [provider]);
    expect(result2).toBe('You are the spirit.\n\nBudget: 200/5000');
  });

  test('provider returning undefined skipped', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const provider: ContextProvider = () => undefined;
    const result = await buildSystemPrompt(mockMemory, [provider]);
    expect(result).toBe('You are the spirit.');
  });

  test('multiple providers all appended in order', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const provider1: ContextProvider = () => '## Section 1';
    const provider2: ContextProvider = () => '## Section 2';
    const provider3: ContextProvider = () => '## Section 3';

    const result = await buildSystemPrompt(mockMemory, [provider1, provider2, provider3]);
    expect(result).toBe('You are the spirit.\n\n## Section 1\n\n## Section 2\n\n## Section 3');
  });

  test('multiple providers with some undefined skips undefined ones', async () => {
    const mockMemory = createMockMemory('You are the spirit.');
    const provider1: ContextProvider = () => '## Section 1';
    const provider2: ContextProvider = () => undefined;
    const provider3: ContextProvider = () => '## Section 3';

    const result = await buildSystemPrompt(mockMemory, [provider1, provider2, provider3]);
    expect(result).toBe('You are the spirit.\n\n## Section 1\n\n## Section 3');
  });
});
