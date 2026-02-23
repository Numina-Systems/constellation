// pattern: Imperative Shell

/**
 * Context building utilities for the agent loop.
 * Handles conversion of persisted conversation history to model-ready messages,
 * system prompt generation from memory, and context budget estimation.
 */

import type { Message, ContentBlock, ToolUseBlock } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ConversationMessage } from './types.ts';

/**
 * Build system prompt from memory manager's core blocks.
 * This ensures AC1.3: core blocks are always in the system prompt.
 */
export async function buildSystemPrompt(memory: MemoryManager): Promise<string> {
  return memory.buildSystemPrompt();
}

/**
 * Convert persisted conversation messages to model-ready Message format.
 * Prepends working memory blocks as context.
 * Includes tool results as user-role messages with ToolResultBlock content,
 * and system summaries as user-role messages.
 */
export async function buildMessages(
  history: ReadonlyArray<ConversationMessage>,
  memory: MemoryManager,
): Promise<Array<Message>> {
  const messages: Array<Message> = [];

  // Add working memory blocks as context message if available
  const workingBlocks = await memory.getWorkingBlocks();
  if (workingBlocks.length > 0) {
    const workingContext = workingBlocks.map((block) => `## ${block.label}\n${block.content}`).join('\n\n');
    messages.push({
      role: 'user',
      content: `[Working Memory Context]\n${workingContext}`,
    });
  }

  // Convert persisted messages to model format
  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: msg.content,
      });
    } else if (msg.role === 'assistant') {
      // Reconstruct assistant messages with tool_use blocks when present
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const contentBlocks: Array<ContentBlock> = [];
        if (msg.content && msg.content !== '[Tool calls]') {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls as Array<ToolUseBlock>) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        messages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        messages.push({
          role: 'assistant',
          content: msg.content,
        });
      }
    } else if (msg.role === 'tool') {
      // Convert tool result messages to user-role messages with ToolResultBlock
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: msg.tool_call_id || '',
            content: msg.content,
            is_error: msg.content.toLowerCase().includes('error'),
          },
        ],
      });
    } else if (msg.role === 'system') {
      // Include system summaries as user-role context messages
      messages.push({
        role: 'user',
        content: msg.content,
      });
    }
  }

  return messages;
}

/**
 * Simple token estimation heuristic.
 * Rough approximation: 1 token ≈ 4 characters.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if conversation history exceeds context budget.
 * Returns true if estimated tokens exceed budget * modelMaxTokens.
 */
export function shouldCompress(
  history: ReadonlyArray<ConversationMessage>,
  budget: number,
  modelMaxTokens: number,
): boolean {
  const budgetInTokens = budget * modelMaxTokens;
  let totalTokens = 0;

  for (const msg of history) {
    totalTokens += estimateTokens(msg.content);
    if (totalTokens > budgetInTokens) {
      return true;
    }
  }

  return false;
}
