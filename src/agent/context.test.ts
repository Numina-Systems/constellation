// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt } from './context.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ContextProvider, ConversationMessage } from './types.ts';

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

describe('shouldCompress', () => {
  const { shouldCompress } = require('./context.ts');

  test('context-overflow-guard.AC1.3: message tokens within budget + overhead returns false', () => {
    // Budget: 100 tokens, overhead: 20 tokens, available: 80 tokens
    // Message: 50 tokens (under 80)
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(200), // ~50 tokens
        created_at: new Date(),
      },
    ];

    const result = shouldCompress(history, 0.5, 200, 20);
    expect(result).toBe(false);
  });

  test('context-overflow-guard.AC1.1: message tokens under budget but with overhead exceeds budget returns true', () => {
    // Budget: 100 tokens, overhead: 40 tokens, available: 60 tokens
    // Message: 80 tokens (exceeds 60)
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(320), // ~80 tokens
        created_at: new Date(),
      },
    ];

    const result = shouldCompress(history, 0.5, 200, 40);
    expect(result).toBe(true);
  });

  test('context-overflow-guard.AC1.4: zero overhead with zero tools and empty system prompt returns false when within budget', () => {
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(400), // ~100 tokens
        created_at: new Date(),
      },
    ];

    // Budget: 100 tokens, overhead: 0, available: 100 tokens
    // Message: 100 tokens (exactly at budget)
    const result = shouldCompress(history, 0.5, 200, 0);
    expect(result).toBe(false);
  });

  test('context-overflow-guard.AC1.4: overhead alone exceeds budget returns true immediately', () => {
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(100), // ~25 tokens
        created_at: new Date(),
      },
    ];

    // Budget: 50 tokens, overhead: 60 tokens (exceeds budget)
    // Available: -10 tokens (negative, should return true immediately)
    const result = shouldCompress(history, 0.25, 200, 60);
    expect(result).toBe(true);
  });

  test('backwards compatibility: default overheadTokens parameter is 0', () => {
    // Call without overheadTokens parameter (should default to 0)
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(400), // ~100 tokens
        created_at: new Date(),
      },
    ];

    // Budget: 100 tokens, no overhead parameter (defaults to 0)
    const result = shouldCompress(history, 0.5, 200);
    expect(result).toBe(false);
  });

  test('multiple messages accumulate tokens across overhead threshold', () => {
    const history: Array<ConversationMessage> = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'x'.repeat(200), // ~50 tokens
        created_at: new Date(),
      },
      {
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: 'y'.repeat(160), // ~40 tokens
        created_at: new Date(),
      },
    ];

    // Budget: 100 tokens, overhead: 15 tokens, available: 85 tokens
    // Total messages: 90 tokens (exceeds 85)
    const result = shouldCompress(history, 0.5, 200, 15);
    expect(result).toBe(true);
  });
});

describe('estimateOverheadTokens', () => {
  const { estimateOverheadTokens } = require('./context.ts');

  test('with system prompt, tools, and maxOutputTokens', () => {
    const systemPrompt = 'System'.repeat(50); // 300 chars = 75 tokens
    const tools = [
      { name: 'tool1', description: 'Tool 1', parameters: [] },
      { name: 'tool2', description: 'Tool 2', parameters: [] },
    ];
    const maxOutputTokens = 1000;

    // JSON.stringify(tools) = 113 chars = 29 tokens
    const expectedOverhead = 75 + 29 + 1000;

    const result = estimateOverheadTokens(systemPrompt, tools, maxOutputTokens);
    expect(result).toBe(expectedOverhead);
  });

  test('with no system prompt and no tools returns only maxOutputTokens', () => {
    const maxOutputTokens = 500;

    const result = estimateOverheadTokens(undefined, undefined, maxOutputTokens);
    expect(result).toBe(maxOutputTokens);
  });

  test('with empty tools array returns system prompt and maxOutputTokens', () => {
    const systemPrompt = 'Short';
    const tools: Array<Record<string, unknown>> = [];
    const maxOutputTokens = 300;

    const result = estimateOverheadTokens(systemPrompt, tools, maxOutputTokens);
    // 'Short' is 5 chars = ceil(5/4) = 2 tokens
    // Empty array: JSON.stringify([]) = '[]' (2 chars) = ceil(2/4) = 1 token, but tools.length is 0 so it's skipped
    expect(result).toBe(2 + 300);
  });
});
