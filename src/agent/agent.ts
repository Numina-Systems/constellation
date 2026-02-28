// pattern: Imperative Shell

/**
 * Core agent loop implementation.
 * Orchestrates message processing, conversation history management,
 * tool dispatch, and context compression.
 */

// UUID generation is built-in to Bun via crypto
import { buildSystemPrompt, buildMessages, shouldCompress } from './context.ts';
import type { Agent, AgentDependencies, ConversationMessage } from './types.ts';
import type { TextBlock, ToolUseBlock } from '../model/types.ts';

const DEFAULT_MODEL_NAME = 'claude-3-sonnet-20250219';
const DEFAULT_MAX_TOKENS = 4096; // Default token limit per request

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
    if (deps.compactor && shouldCompress(history, deps.config.context_budget, modelMaxTokens)) {
      const result = await deps.compactor.compress(history, id);
      history = Array.from(result.history);
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
              const result = await deps.runtime.execute(code, stubs);

              toolResult = result.success ? result.output : `Error: ${result.error}`;
            } else if (toolUse.name === 'compact_context') {
              // Special case: context compaction
              if (deps.compactor) {
                const compactionResult = await deps.compactor.compress(history, id);
                history = Array.from(compactionResult.history);

                toolResult = JSON.stringify({
                  messagesCompressed: compactionResult.messagesCompressed,
                  batchesCreated: compactionResult.batchesCreated,
                  tokensEstimateBefore: compactionResult.tokensEstimateBefore,
                  tokensEstimateAfter: compactionResult.tokensEstimateAfter,
                });
              } else {
                toolResult = JSON.stringify({
                  success: false,
                  output: 'Compaction not configured',
                });
              }
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

  return {
    processMessage,
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
}

/**
 * Generate a new conversation ID.
 * Uses crypto.randomUUID() which is built-in to Bun.
 */
function generateId(): string {
  return crypto.randomUUID();
}
