// pattern: Imperative Shell

/**
 * Core agent loop implementation.
 * Orchestrates message processing, conversation history management,
 * tool dispatch, and context compression.
 */

// UUID generation is built-in to Bun via crypto
import { buildSystemPrompt, buildMessages, shouldCompress } from './context.ts';
import type { Agent, AgentDependencies, ConversationMessage, ExternalEvent } from './types.ts';
import type { TextBlock, ToolUseBlock } from '../model/types.ts';

const COMPRESSION_KEEP_RECENT = 5; // Always keep the most recent N messages
const DEFAULT_MODEL_NAME = 'claude-3-sonnet-20250219';
const DEFAULT_MAX_TOKENS = 4096; // Default token limit per request

/**
 * Format an external event as a structured user message with metadata header.
 * Pure function for testability.
 */
function formatExternalEvent(event: ExternalEvent): string {
  const header = `[External Event: ${event.source}]`;
  const from = event.metadata['handle'] ? `From: @${event.metadata['handle']} (${event.metadata['did']})` : '';
  const post = event.metadata['uri'] ? `Post: ${event.metadata['uri']}` : '';
  const replyTo = event.metadata['reply_to'] ? `Reply to: ${event.metadata['reply_to']}` : '';
  const time = `Time: ${event.timestamp.toISOString()}`;

  const parts = [header, from, post, replyTo, time].filter(Boolean).concat('', event.content);
  return parts.join('\n');
}

/**
 * Create an agent instance.
 * If conversationId is not provided, generates a new ULID/UUID.
 * If provided, loads existing conversation history from Postgres.
 */
export function createAgent(
  deps: AgentDependencies,
  conversationId?: string,
): Agent {
  const id = conversationId || generateId();
  const modelMaxTokens = deps.config.model_max_tokens ?? 200000;
  const modelName = deps.config.model_name ?? DEFAULT_MODEL_NAME;
  const maxTokens = deps.config.max_tokens ?? DEFAULT_MAX_TOKENS;

  async function processMessage(userMessage: string): Promise<string> {
    // Step 1: Persist user message
    await persistMessage({
      conversation_id: id,
      role: 'user',
      content: userMessage,
    });

    // Step 2: Load conversation history
    let history = await loadConversationHistory(id);

    // Step 3: Check context budget and compress if needed
    if (shouldCompress(history, deps.config.context_budget, modelMaxTokens)) {
      history = await compressConversationHistory(history, id);
    }

    // Step 4 & 5: Build context and call model
    let roundCount = 0;
    const maxRounds = deps.config.max_tool_rounds;

    while (roundCount < maxRounds) {
      roundCount++;

      // Build fresh context for each round
      const systemPrompt = await buildSystemPrompt(deps.memory);
      const messages = await buildMessages(history, deps.memory);

      // Call the model with current context
      const modelRequest = {
        messages,
        system: systemPrompt,
        tools: deps.registry.toModelTools(),
        model: modelName,
        max_tokens: maxTokens,
      };

      const response = await deps.model.complete(modelRequest);

      // Step 6: Handle response based on stop_reason
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract text content and return
        const textContent = response.content.find((block) => block.type === 'text') as TextBlock | undefined;
        const text = textContent?.text || '';

        // Persist assistant message
        await persistMessage({
          conversation_id: id,
          role: 'assistant',
          content: text,
        });

        return text;
      }

      if (response.stop_reason === 'tool_use') {
        // Extract tool use blocks
        const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use') as Array<ToolUseBlock>;

        // Persist the assistant message with tool calls
        const assistantText = response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as TextBlock).text)
          .join('');

        const assistantMessageId = await persistMessage({
          conversation_id: id,
          role: 'assistant',
          content: assistantText || '[Tool calls]',
          tool_calls: toolUseBlocks,
        });

        // Dispatch each tool use and collect results
        const toolResults: Array<ConversationMessage> = [];
        for (const toolUse of toolUseBlocks) {
          let toolResult: string;

          try {
            if (toolUse.name === 'execute_code') {
              // Special case: code execution
              const code = String(toolUse.input['code']);
              const stubs = deps.registry.generateStubs();
              const context = deps.getExecutionContext?.();
              const result = await deps.runtime.execute(code, stubs, context);

              toolResult = result.success ? result.output : `Error: ${result.error}`;
            } else {
              // Regular tool dispatch
              const result = await deps.registry.dispatch(toolUse.name, toolUse.input);
              toolResult = result.output;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolResult = `Error executing tool ${toolUse.name}: ${errorMsg}`;
          }

          // Persist tool result
          await persistMessage({
            conversation_id: id,
            role: 'tool',
            content: toolResult,
            tool_call_id: toolUse.id,
          });

          // Collect tool result for history (added after assistant message below)
          toolResults.push({
            id: `tool-result-${toolUse.id}`,
            conversation_id: id,
            role: 'tool' as const,
            content: toolResult,
            tool_call_id: toolUse.id,
            created_at: new Date(),
          });
        }

        // Add assistant message FIRST (must precede tool results for API ordering)
        history.push({
          id: assistantMessageId,
          conversation_id: id,
          role: 'assistant',
          content: assistantText || '[Tool calls]',
          tool_calls: toolUseBlocks,
          created_at: new Date(),
        });

        // Then add tool results
        for (const result of toolResults) {
          history.push(result);
        }

        // Continue loop for next round
        continue;
      }

      // Unknown stop reason - return empty string
      return '';
    }

    // Max rounds exceeded
    const warningMessage = `[Warning: max tool rounds (${maxRounds}) reached. Stopping tool execution.]`;

    await persistMessage({
      conversation_id: id,
      role: 'assistant',
      content: warningMessage,
    });

    return warningMessage;
  }

  async function getConversationHistory(): Promise<Array<ConversationMessage>> {
    return loadConversationHistory(id);
  }

  async function processEvent(event: ExternalEvent): Promise<string> {
    const formattedMessage = formatExternalEvent(event);
    return processMessage(formattedMessage);
  }

  return {
    processMessage,
    processEvent,
    getConversationHistory,
    conversationId: id,
  };

  /**
   * Persist a message to the database.
   * Returns the message ID.
   */
  async function persistMessage(msg: {
    conversation_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: Array<ToolUseBlock>;
    tool_call_id?: string;
  }): Promise<string> {
    const result = await deps.persistence.query(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [msg.conversation_id, msg.role, msg.content, msg.tool_calls ? JSON.stringify(msg.tool_calls) : null, msg.tool_call_id || null],
    );

    const row = result[0];
    if (!row) {
      return '';
    }
    return String(row['id']);
  }

  /**
   * Load all messages for this conversation from the database.
   */
  async function loadConversationHistory(convId: string): Promise<Array<ConversationMessage>> {
    const rows = await deps.persistence.query(
      `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [convId],
    );

    return rows.map((row) => ({
      id: String(row['id']),
      conversation_id: String(row['conversation_id']),
      role: String(row['role']) as 'user' | 'assistant' | 'system' | 'tool',
      content: String(row['content']),
      tool_calls: row['tool_calls']
        ? (typeof row['tool_calls'] === 'string' ? JSON.parse(row['tool_calls']) : row['tool_calls'])
        : undefined,
      tool_call_id: row['tool_call_id'] ? String(row['tool_call_id']) : undefined,
      created_at: new Date(String(row['created_at'])),
    }));
  }

  /**
   * Compress conversation history by summarizing old messages.
   * Keeps the most recent N messages and replaces older ones with a summary.
   */
  async function compressConversationHistory(
    history: ReadonlyArray<ConversationMessage>,
    convId: string,
  ): Promise<Array<ConversationMessage>> {
    if (history.length <= COMPRESSION_KEEP_RECENT) {
      return Array.from(history);
    }

    // Split into old and recent messages
    const toCompress = history.slice(0, history.length - COMPRESSION_KEEP_RECENT);
    const toKeep = Array.from(history.slice(history.length - COMPRESSION_KEEP_RECENT));

    // Build a summarization request
    const messageText = toCompress.map((msg) => `${msg.role}: ${msg.content}`).join('\n');

    const summaryRequest = {
      messages: [
        {
          role: 'user' as const,
          content: `Please summarize the following conversation messages concisely, preserving important context and decisions:\n\n${messageText}`,
        },
      ],
      system: 'You are a conversation summarization assistant. Create a concise summary that preserves key information and context.',
      tools: [] as ReadonlyArray<never>,
      model: modelName,
      max_tokens: 1024,
    };

    const summaryResponse = await deps.model.complete(summaryRequest);
    const summaryText = summaryResponse.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as TextBlock).text)
      .join('');

    // Replace old messages with summary
    const oldIds = toCompress.map((msg) => msg.id);

    // Delete old messages and insert summary
    await deps.persistence.query(
      `DELETE FROM messages WHERE id = ANY($1)`,
      [oldIds],
    );

    const summaryId = await persistMessage({
      conversation_id: convId,
      role: 'system',
      content: `[Context Summary]\n${summaryText}`,
    });

    // Return compressed history
    const summaryMessage: ConversationMessage = {
      id: summaryId,
      conversation_id: convId,
      role: 'system',
      content: `[Context Summary]\n${summaryText}`,
      created_at: new Date(),
    };

    // Archive to memory
    await deps.memory.write(
      'archived-conversation-summary',
      `[Context Summary from ${toCompress[0]?.created_at?.toISOString() || 'unknown'} to ${toCompress[toCompress.length - 1]?.created_at?.toISOString() || 'unknown'}]\n${summaryText}`,
      'archival',
      'automatic compression of conversation history',
    );

    return [summaryMessage, ...toKeep];
  }
}

/**
 * Generate a new conversation ID.
 * Uses crypto.randomUUID() which is built-in to Bun.
 */
function generateId(): string {
  return crypto.randomUUID();
}
