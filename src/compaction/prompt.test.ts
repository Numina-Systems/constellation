// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import type { ConversationMessage } from '../agent/types.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_DIRECTIVE,
  buildSummarizationRequest,
  buildResummarizationRequest,
} from './prompt.js';

/**
 * Helper to create test ConversationMessage objects.
 */
function createMessage(
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  id: string = 'msg-1',
): ConversationMessage {
  return {
    id,
    conversation_id: 'conv-1',
    role,
    content,
    created_at: new Date(),
  };
}

describe('buildSummarizationRequest', () => {
  describe('AC1.1: Uses system field for config prompt', () => {
    it('returns a ModelRequest with system field set to provided system prompt', () => {
      const customPrompt = 'Custom system prompt';
      const request = buildSummarizationRequest({
        systemPrompt: customPrompt,
        previousSummary: null,
        messages: [],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(customPrompt);
      expect(request.model).toBe('gpt-4');
      expect(request.max_tokens).toBe(2000);
      expect(request.temperature).toBe(0);
    });

    it('uses DEFAULT_SYSTEM_PROMPT when systemPrompt is null (AC4.4)', () => {
      const request = buildSummarizationRequest({
        systemPrompt: null,
        previousSummary: null,
        messages: [],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    });
  });

  describe('AC1.2: Previous summary as system-role message', () => {
    it('adds previous summary as first system-role message when provided', () => {
      const summary = 'Previous conversation summary';
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: summary,
        messages: [createMessage('user', 'hello')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.messages[0]).toEqual({
        role: 'system',
        content: `Previous summary of conversation:\n${summary}`,
      });
    });

    it('does not include system-role message when previousSummary is null (AC1.5)', () => {
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages: [createMessage('user', 'hello')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      // First message should be the conversation message, not a system-role
      expect(request.messages[0]?.role).toBe('user');
      expect(request.messages[0]?.content).toBe('hello');
    });
  });

  describe('AC1.3: Conversation messages with original roles preserved', () => {
    it('includes user messages with role: "user"', () => {
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages: [createMessage('user', 'What is the weather?')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const userMsg = request.messages.find((m) => m.content === 'What is the weather?');
      expect(userMsg?.role).toBe('user');
      expect(userMsg?.content).toBe('What is the weather?');
    });

    it('includes assistant messages with role: "assistant"', () => {
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages: [createMessage('assistant', 'It is sunny.')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const assistantMsg = request.messages.find((m) => m.content === 'It is sunny.');
      expect(assistantMsg?.role).toBe('assistant');
    });

    it('converts tool messages to user messages with [Tool result] context', () => {
      const toolContent = 'Result from tool execution';
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages: [createMessage('tool', toolContent)],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const toolMsg = request.messages.find(
        (m) => typeof m.content === 'string' && m.content.includes(toolContent),
      );
      expect(toolMsg?.role).toBe('user');
      expect(toolMsg?.content).toBe(`[Tool result]: ${toolContent}`);
    });

    it('skips system messages in conversation (they are clip-archives)', () => {
      const messages: Array<ConversationMessage> = [
        createMessage('system', '[Context Summary — from prior compaction]', 'clip-1'),
        createMessage('user', 'Hello', 'user-1'),
      ];

      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      // Only the user message and the directive should be in messages
      // (the system message from conversation should be skipped)
      const systemMsgsFromConversation = request.messages.filter((m) => {
        if (m.role === 'system' && typeof m.content === 'string') {
          return m.content.startsWith('[Context Summary');
        }
        return false;
      });
      expect(systemMsgsFromConversation).toHaveLength(0);
    });
  });

  describe('AC1.4: Directive as final user message', () => {
    it('appends DEFAULT_DIRECTIVE as final user message', () => {
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages: [createMessage('user', 'hello')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage?.role).toBe('user');
      expect(lastMessage?.content).toBe(DEFAULT_DIRECTIVE);
    });

    it('directive is always last, after all conversation messages', () => {
      const messages = [
        createMessage('user', 'Message 1', 'msg-1'),
        createMessage('assistant', 'Response 1', 'msg-2'),
        createMessage('user', 'Message 2', 'msg-3'),
      ];

      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: null,
        messages,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage?.content).toBe(DEFAULT_DIRECTIVE);
    });
  });

  describe('AC1.5: No previous summary edge case', () => {
    it('does not add an empty system message when previousSummary is empty string', () => {
      const request = buildSummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        previousSummary: '',
        messages: [createMessage('user', 'hello')],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      // First message should be a conversation message, not a system-role message
      expect(request.messages[0]?.role).not.toBe('system');
    });
  });

  describe('AC4.3 & AC4.4: Prompt handling', () => {
    it('custom prompt is used as-is without transformation (AC4.3)', () => {
      const customPrompt = 'My custom prompt with {placeholder} that should not be replaced';
      const request = buildSummarizationRequest({
        systemPrompt: customPrompt,
        previousSummary: null,
        messages: [],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(customPrompt);
      // Ensure placeholders are NOT replaced
      expect(request.system).toContain('{placeholder}');
    });

    it('null systemPrompt falls back to DEFAULT_SYSTEM_PROMPT (AC4.4)', () => {
      const request = buildSummarizationRequest({
        systemPrompt: null,
        previousSummary: null,
        messages: [],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    });
  });
});

describe('buildResummarizationRequest', () => {
  describe('AC1.6: Re-summarization uses structured messages', () => {
    it('builds a ModelRequest with batch contents as system-role messages', () => {
      const batches = ['Batch 1 content', 'Batch 2 content'];
      const request = buildResummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        batchContents: batches,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
      expect(request.model).toBe('gpt-4');
      expect(request.max_tokens).toBe(2000);
      expect(request.temperature).toBe(0);
    });

    it('converts each batch to a system-role message', () => {
      const batches = ['Batch 1 summary', 'Batch 2 summary'];
      const request = buildResummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        batchContents: batches,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      // Should have N system messages (one per batch) + 1 directive
      const systemMessages = request.messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(2);

      expect(systemMessages[0]?.content).toBe('Summary batch:\nBatch 1 summary');
      expect(systemMessages[1]?.content).toBe('Summary batch:\nBatch 2 summary');
    });

    it('appends directive as final user message (AC1.4)', () => {
      const batches = ['Batch content'];
      const request = buildResummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        batchContents: batches,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage?.role).toBe('user');
      expect(lastMessage?.content).toBe(DEFAULT_DIRECTIVE);
    });

    it('uses DEFAULT_SYSTEM_PROMPT when systemPrompt is null', () => {
      const batches = ['Batch content'];
      const request = buildResummarizationRequest({
        systemPrompt: null,
        batchContents: batches,
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it('handles empty batch list (edge case)', () => {
      const request = buildResummarizationRequest({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        batchContents: [],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      // Should only have the directive
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]?.role).toBe('user');
      expect(request.messages[0]?.content).toBe(DEFAULT_DIRECTIVE);
    });
  });

  describe('AC4.3 & AC4.4: Re-summarization prompt handling', () => {
    it('custom prompt is used as-is (AC4.3)', () => {
      const customPrompt = 'Re-summarization prompt with {template} that should not change';
      const request = buildResummarizationRequest({
        systemPrompt: customPrompt,
        batchContents: ['Batch 1'],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(customPrompt);
      expect(request.system).toContain('{template}');
    });

    it('null systemPrompt falls back to DEFAULT_SYSTEM_PROMPT (AC4.4)', () => {
      const request = buildResummarizationRequest({
        systemPrompt: null,
        batchContents: ['Batch 1'],
        modelName: 'gpt-4',
        maxTokens: 2000,
      });

      expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    });
  });
});
