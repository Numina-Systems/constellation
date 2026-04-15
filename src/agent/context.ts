// pattern: Functional Core / Imperative Shell

/**
 * Context building utilities for the agent loop.
 * Handles conversion of persisted conversation history to model-ready messages,
 * system prompt generation from memory, and context budget estimation.
 * Includes truncateOldest pure function for pre-flight context guard.
 */

import type { Message, ContentBlock, ToolUseBlock } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ConversationMessage, ContextProvider } from './types.ts';
import type { ToolDefinition } from '../tool/types.ts';

/**
 * Build system prompt from memory manager's core blocks.
 * This ensures AC1.3: core blocks are always in the system prompt.
 * Optionally appends output from context providers.
 */
export async function buildSystemPrompt(
  memory: MemoryManager,
  contextProviders?: ReadonlyArray<ContextProvider>,
): Promise<string> {
  let prompt = await memory.buildSystemPrompt();

  if (contextProviders) {
    for (const provider of contextProviders) {
      const section = provider();
      if (section !== undefined) {
        prompt += '\n\n' + section;
      }
    }
  }

  return prompt;
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
          reasoning_content: msg.reasoning_content,
        });
      } else {
        messages.push({
          role: 'assistant',
          content: msg.content,
          reasoning_content: msg.reasoning_content,
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
 * Estimate overhead tokens from system prompt, tool definitions, and output reservation.
 * Used to calculate available context budget for messages.
 */
export function estimateOverheadTokens(
  systemPrompt: string | undefined,
  tools: ReadonlyArray<ToolDefinition> | undefined,
  maxOutputTokens: number,
): number {
  let overhead = maxOutputTokens;

  if (systemPrompt) {
    overhead += estimateTokens(systemPrompt);
  }

  if (tools && tools.length > 0) {
    overhead += estimateTokens(JSON.stringify(tools));
  }

  return overhead;
}

/**
 * Check if conversation history exceeds context budget.
 * Returns true if estimated tokens (including overhead) exceed budget * modelMaxTokens.
 * The overheadTokens parameter accounts for system prompt, tool definitions, and output reservation.
 */
export function shouldCompress(
  history: ReadonlyArray<ConversationMessage>,
  budget: number,
  modelMaxTokens: number,
  overheadTokens: number = 0,
): boolean {
  const budgetInTokens = budget * modelMaxTokens;
  const availableForMessages = budgetInTokens - overheadTokens;

  if (availableForMessages <= 0) {
    return true;
  }

  let totalTokens = 0;

  for (const msg of history) {
    totalTokens += estimateTokens(msg.content);
    if (totalTokens > availableForMessages) {
      return true;
    }
  }

  return false;
}

/**
 * Pre-flight guard: truncate oldest non-protected messages when estimated request
 * exceeds modelMaxTokens after accounting for overhead.
 *
 * Pure function. Strategy:
 * 1. Protect leading system messages (contiguous system-role messages at the start)
 * 2. Protect the most recent user message (if any exists)
 * 3. Calculate available token budget: modelMaxTokens - overheadTokens
 * 4. Drop oldest non-protected messages first until the total fits
 *
 * AC3.2: Preserves leading system messages (clip-archive summaries)
 * AC3.3: Preserves the most recent user message
 * AC3.4: Drops oldest non-system messages first
 * AC3.6: Never truncates below minimum viable context (leading system + latest user, if user exists)
 */
export function truncateOldest(
  messages: ReadonlyArray<Message>,
  modelMaxTokens: number,
  overheadTokens: number,
): Array<Message> {
  const availableTokens = modelMaxTokens - overheadTokens;

  if (availableTokens <= 0) {
    return extractMinimumContext(messages);
  }

  // Estimate current total
  const currentTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0,
  );

  if (currentTokens <= availableTokens) {
    return Array.from(messages);
  }

  // Identify protected messages
  // 1. Leading system messages (clip-archive summaries)
  let leadingSystemCount = 0;
  for (const msg of messages) {
    if (msg.role === 'system') {
      leadingSystemCount++;
    } else {
      break;
    }
  }

  // 2. Most recent user message index
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  // Build result: keep protected, drop from oldest non-protected
  const leading = messages.slice(0, leadingSystemCount);
  const lastUser = lastUserIndex >= 0 ? [messages[lastUserIndex]!] : [];

  // Droppable messages: everything between leading system and end, except the last user message
  const droppable: Array<{ index: number; msg: Message }> = [];
  for (let i = leadingSystemCount; i < messages.length; i++) {
    if (i !== lastUserIndex) {
      droppable.push({ index: i, msg: messages[i]! });
    }
  }

  // Calculate tokens for protected messages
  const protectedTokens = [...leading, ...lastUser].reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0,
  );

  // If protected messages already exceed budget, return minimum viable context
  if (protectedTokens > availableTokens) {
    return extractMinimumContext(messages);
  }

  let remainingBudget = availableTokens - protectedTokens;

  // Drop oldest droppable messages until remaining fit within budget.
  // Calculate total droppable tokens first, then drop from oldest until we're under budget.
  let droppableTokens = 0;
  const droppableWithTokens = droppable.map((d) => {
    const tokens = estimateTokens(
      typeof d.msg.content === 'string' ? d.msg.content : JSON.stringify(d.msg.content),
    );
    droppableTokens += tokens;
    return { ...d, tokens };
  });

  // Drop from oldest (front) until remaining droppable tokens fit
  let tokensDropped = 0;
  let dropCount = 0;
  for (const d of droppableWithTokens) {
    if (droppableTokens - tokensDropped <= remainingBudget) {
      break;
    }
    tokensDropped += d.tokens;
    dropCount++;
  }

  const kept = droppableWithTokens.slice(dropCount);

  // Reconstruct in original order: leading system + surviving droppable + last user
  const result = [...leading, ...kept.map((k) => k.msg), ...lastUser];
  return result;
}

/**
 * Extract minimum viable context: leading system messages + most recent user message.
 * Used when token budget is extremely constrained.
 */
function extractMinimumContext(messages: ReadonlyArray<Message>): Array<Message> {
  const result: Array<Message> = [];

  // Keep leading system messages
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push(msg);
    } else {
      break;
    }
  }

  // Keep last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      result.push(messages[i]!);
      break;
    }
  }

  return result;
}
