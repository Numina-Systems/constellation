// pattern: Functional Core

/**
 * Context building utilities for the agent loop.
 * Handles conversion of persisted conversation history to model-ready messages,
 * system prompt generation from memory, and context budget estimation.
 */

import type { Message } from '../model/types.ts';
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
 */
export async function buildMessages(
  history: Array<ConversationMessage>,
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
    // Filter out tool messages and system messages from history
    // Only user and assistant messages go to the model
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
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
  history: Array<ConversationMessage>,
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
