// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { buildSystemPrompt, shouldCompress, estimateOverheadTokens, truncateOldest } from './context.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ContextProvider, ConversationMessage } from './types.ts';
import type { ToolDefinition } from '../tool/types.ts';
import type { Message } from '../model/types.ts';

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
    const tools: ReadonlyArray<ToolDefinition> = [];
    const maxOutputTokens = 300;

    const result = estimateOverheadTokens(systemPrompt, tools, maxOutputTokens);
    // 'Short' is 5 chars = ceil(5/4) = 2 tokens
    // Empty array: JSON.stringify([]) = '[]' (2 chars) = ceil(2/4) = 1 token, but tools.length is 0 so it's skipped
    expect(result).toBe(2 + 300);
  });
});

describe('truncateOldest', () => {
  test('context-overflow-guard.AC3.2: preserves leading system messages when truncating', () => {
    // Create messages: [sys1, sys2, user1, asst1, user2]
    // When budget is tight, should keep sys1 and sys2
    const messages: Array<Message> = [
      {
        role: 'system',
        content: 'System message 1 with some context about the AI'.repeat(2), // ~44 tokens
      },
      {
        role: 'system',
        content: 'System message 2 with more context'.repeat(2), // ~34 tokens
      },
      {
        role: 'user',
        content: 'x'.repeat(400), // ~100 tokens
      },
      {
        role: 'assistant',
        content: 'y'.repeat(400), // ~100 tokens
      },
      {
        role: 'user',
        content: 'z'.repeat(400), // ~100 tokens
      },
    ];

    // Budget: enough for 2 system + latest user = ~44 + 34 + 100 = 178 tokens
    // modelMaxTokens = 300, overhead = 100, available = 200
    // This forces truncation of middle messages (user1, asst1)
    const result = truncateOldest(messages, 300, 100);

    // Should have: [sys1, sys2, user2] (no asst1, no user1)
    expect(result.length).toBe(3);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toContain('System message 1');
    expect(result[1]?.role).toBe('system');
    expect(result[1]?.content).toContain('System message 2');
    expect(result[2]?.role).toBe('user');
    expect(result[2]?.content).toContain('z'.repeat(400));
  });

  test('context-overflow-guard.AC3.3: preserves most recent user message', () => {
    // Create: [user1, asst1, user2, asst2, user3]
    // Even with tight budget, user3 should be kept
    const messages: Array<Message> = [
      { role: 'user', content: 'a'.repeat(400) }, // ~100 tokens
      { role: 'assistant', content: 'b'.repeat(400) }, // ~100 tokens
      { role: 'user', content: 'c'.repeat(400) }, // ~100 tokens
      { role: 'assistant', content: 'd'.repeat(400) }, // ~100 tokens
      { role: 'user', content: 'latest user message'.repeat(10) }, // ~48 tokens
    ];

    // Budget: 250 tokens (overhead=100, modelMax=350)
    // This is enough only for the most recent user + some overhead
    const result = truncateOldest(messages, 350, 100);

    // Must include the latest user message
    const lastMsg = result[result.length - 1];
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.content).toContain('latest user message');
  });

  test('context-overflow-guard.AC3.4: drops oldest non-protected messages first', () => {
    // Create: [user1, asst1, user2, asst2, user3]
    // When budget is limited, should drop user1+asst1 before user2+asst2
    const messages: Array<Message> = [
      { role: 'user', content: 'old' }, // ~1 token
      { role: 'assistant', content: 'response to old' }, // ~4 tokens
      { role: 'user', content: 'middle' }, // ~1 token
      { role: 'assistant', content: 'response to middle' }, // ~5 tokens
      { role: 'user', content: 'latest' }, // ~2 tokens
    ];

    // Budget: 8 tokens (overhead=0, modelMax=8)
    // Can fit: latest user (2) + response to middle (5) = 7 tokens, just under budget
    // Drop oldest first: user1 (1), response to old (4), user2 (1)
    const result = truncateOldest(messages, 8, 0);

    // Should preserve latest user + response to middle (keeps older assistant message that fits)
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe('assistant');
    expect(result[0]?.content).toBe('response to middle');
    expect(result[1]?.role).toBe('user');
    expect(result[1]?.content).toBe('latest');
  });

  test('context-overflow-guard.AC3.6: minimum viable context (sys + user) never truncated further', () => {
    // Create: [sys, user]
    // With extremely tight budget, should never truncate further
    const messages: Array<Message> = [
      { role: 'system', content: 'System prompt with lots of detail'.repeat(10) }, // ~88 tokens
      { role: 'user', content: 'User input here'.repeat(10) }, // ~39 tokens
    ];

    // Budget: only 20 tokens (overhead=0, modelMax=20)
    // Even though messages exceed budget, minimum viable context is returned
    const result = truncateOldest(messages, 20, 0);

    // Should return both (minimum viable context)
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe('system');
    expect(result[1]?.role).toBe('user');
  });

  test('context-overflow-guard.AC3.6 edge: no user messages with tight budget returns only leading system messages', () => {
    // Create: [sys1, sys2, asst1, asst2]
    // With no user messages and tight budget, should return leading system messages only
    const messages: Array<Message> = [
      { role: 'system', content: 'System A' },
      { role: 'system', content: 'System B' },
      { role: 'assistant', content: 'x'.repeat(500) }, // ~125 tokens
      { role: 'assistant', content: 'y'.repeat(500) }, // ~125 tokens
    ];

    // Budget: 10 tokens (overhead=0), which fits only system messages (4 tokens)
    const result = truncateOldest(messages, 10, 0);

    // Should return only the leading system messages
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe('system');
    expect(result[0]?.content).toBe('System A');
    expect(result[1]?.role).toBe('system');
    expect(result[1]?.content).toBe('System B');
  });

  test('context-overflow-guard.AC3.6 edge: no system messages preserves last user, drops oldest others', () => {
    // Create: [user1, asst1, user2, asst2, user3]
    // With no leading system messages, should keep last user, drop oldest
    const messages: Array<Message> = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'response 1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'response 2' },
      { role: 'user', content: 'third' },
    ];

    const result = truncateOldest(messages, 100, 0);

    // Must include the last user message
    const lastMsg = result[result.length - 1];
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.content).toBe('third');
  });

  test('messages within budget are returned unchanged', () => {
    const messages: Array<Message> = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    // Budget: 1000 tokens (plenty)
    const result = truncateOldest(messages, 1000, 0);

    // Should return all messages
    expect(result.length).toBe(2);
    expect(result).toEqual(messages);
  });

  test('available tokens <= 0 returns minimum viable context', () => {
    const messages: Array<Message> = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Assistant' },
    ];

    // Budget: modelMax=100, overhead=150 => available = -50 (negative)
    const result = truncateOldest(messages, 100, 150);

    // Should return minimum viable context: [sys, user]
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe('system');
    expect(result[1]?.role).toBe('user');
  });

  test('large middle section truncated, preserving boundaries', () => {
    // Create: [sys, user1, asst1...asst100, user2]
    // With limited budget, should drop the large assistant section
    const messages: Array<Message> = [
      { role: 'system', content: 'System context' }, // ~3 tokens
      { role: 'user', content: 'First question' }, // ~3 tokens
    ];

    // Add a large assistant message section
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'assistant', content: 'x'.repeat(500) }); // ~125 tokens each
    }

    messages.push({ role: 'user', content: 'Final question' }); // ~3 tokens

    // Budget: 50 tokens (overhead=0, modelMax=50)
    // Can fit: sys (3) + final user (3) = 6 tokens
    const result = truncateOldest(messages, 50, 0);

    // Should have: [sys, final user] (all assistants + first user dropped)
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe('system');
    expect(result[1]?.role).toBe('user');
    expect(result[1]?.content).toContain('Final question');
  });

  test('content blocks (non-string) handled correctly', () => {
    // Message with array content (tool results, etc.)
    const messages: Array<Message> = [
      { role: 'system', content: 'System' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Some text' },
          { type: 'tool_result', tool_use_id: 'abc', content: 'Result' },
        ],
      },
      { role: 'user', content: 'latest' },
    ];

    const result = truncateOldest(messages, 1000, 0);

    // Should preserve all (within budget)
    expect(result.length).toBe(3);
  });

  test('pure function: input array is not mutated', () => {
    const messages: Array<Message> = [
      { role: 'user', content: 'a'.repeat(500) },
      { role: 'assistant', content: 'b'.repeat(500) },
      { role: 'user', content: 'c'.repeat(500) },
    ];

    const originalLength = messages.length;
    truncateOldest(messages, 50, 0);

    // Original array should be unchanged
    expect(messages.length).toBe(originalLength);
  });
});
