// pattern: Imperative Shell

/**
 * Core agent loop implementation.
 * Orchestrates message processing, conversation history management,
 * tool dispatch, and context compression.
 */

// UUID generation is built-in to Bun via crypto
import { toSql } from 'pgvector/utils';
import { buildSystemPrompt, buildMessages, shouldCompress, estimateOverheadTokens, truncateOldest, estimateTokens } from './context.ts';
import { createSnapshotState } from './snapshot.ts';
import { buildUserMessage } from './messages.ts';
import { createCacheDiagnostics, serializeTools } from './cache-diagnostics.ts';
import { formatSkillsSection } from '../skill/context.ts';
import { performRecall } from '../recall/index.js';
import { isConstellationError, wrapError } from '@/errors/index.js';
import { traceError } from '@/errors/trace.js';
import { stripQuotedContent } from '@/loop-detection/strip-quotes.js';
import type { Agent, AgentDependencies, ConversationMessage, ExternalEvent, ClassifiedProvider, CheckpointState } from './types.ts';
import type { TextBlock, ToolUseBlock } from '../model/types.ts';
import type { RecallResult } from '../recall/index.js';
import type { MemoryManager } from '../memory/manager.ts';

const DEFAULT_MODEL_NAME = 'claude-3-sonnet-20250219';
const DEFAULT_MAX_TOKENS = 24576; // Default token limit per request

/**
 * Helper to get labels of core memory blocks.
 * MemoryManager doesn't currently expose getCoreBlockLabels, so return empty array.
 * This is a known limitation — core block deduplication would require a follow-up PR.
 */
function getCoreLabels(_memory: MemoryManager): ReadonlyArray<string> {
  return [];
}

/**
 * Checkpoint state reference for tracking agent state across turns.
 * Holds the minimal checkpoint data needed for periodic checkpoint creation.
 */
type CheckpointStateRef = {
  current: CheckpointState | null;
};

/**
 * Format an external event as a structured user message with metadata header.
 * Pure function for testability.
 */
function formatExternalEvent(
  event: ExternalEvent,
  sourceInstructions?: ReadonlyMap<string, string>,
): string {
  const header = `[External Event: ${event.source}]`;
  const from = event.metadata['handle'] ? `From: @${event.metadata['handle']} (${event.metadata['did']})` : '';
  const post = event.metadata['uri'] ? `Post: ${event.metadata['uri']}` : '';
  const cid = event.metadata['cid'] ? `CID: ${event.metadata['cid']}` : '';
  const time = `Time: ${event.timestamp.toISOString()}`;

  const parts = [header, from, post, cid, time];

  // Format reply_to as structured fields so the agent has the URIs and CIDs it needs
  const replyTo = event.metadata['reply_to'] as
    | { parent_uri: string; parent_cid: string; root_uri: string; root_cid: string }
    | undefined;
  if (replyTo) {
    parts.push(`Parent URI: ${replyTo.parent_uri}`);
    parts.push(`Parent CID: ${replyTo.parent_cid}`);
    parts.push(`Root URI: ${replyTo.root_uri}`);
    parts.push(`Root CID: ${replyTo.root_cid}`);
  }

  parts.push('', event.content);

  // Append source-specific instructions if available
  const instructions = sourceInstructions?.get(event.source);
  if (instructions) {
    parts.push('');
    parts.push(`[Instructions: ${instructions}]`);
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * Build a dynamic providers map from classified providers.
 * Extracts providers with 'dynamic' classification into the format
 * expected by computeSnapshot: ReadonlyMap<string, () => string | undefined>.
 */
function buildDynamicProviderMap(
  classified: ReadonlyArray<ClassifiedProvider> | undefined,
): ReadonlyMap<string, () => string | undefined> {
  if (!classified) return new Map();
  const map = new Map<string, () => string | undefined>();
  for (const cp of classified) {
    if (cp.classification === 'dynamic') {
      map.set(cp.name, cp.provider);
    }
  }
  return map;
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

  const traceOwner = deps.owner ?? 'unknown';

  // Create snapshot state for batch-anchored snapshots (Phase 4)
  const snapshotState = createSnapshotState();

  // Create cache diagnostics instance if enabled
  const cacheDiagnostics = deps.config.cache_diagnostics !== false
    ? createCacheDiagnostics()
    : null;

  // Build dynamic providers map once (providers don't change, but their state does each turn)
  const dynamicProviders = buildDynamicProviderMap(deps.classifiedProviders);

  // Checkpoint state reference for tracking agent state (Phase 5)
  const checkpointStateRef: CheckpointStateRef = { current: null };

  let turnNumber = 0;
  let previousToolsHash: bigint | null = null;
  let lastCompactionMessageCount = 0;
  let lastCompactionSummaryCount = 0;

  function recordTrace(
    toolName: string,
    input: Record<string, unknown>,
    output: string,
    durationMs: number,
    success: boolean,
    error: string | null,
  ): void {
    if (!deps.traceRecorder) return;
    // Fire-and-forget: start the async operation without awaiting
    // Errors are caught and logged by the TraceRecorder implementation
    deps.traceRecorder.record({
      owner: traceOwner,
      conversationId: id,
      toolName,
      input,
      outputSummary: output,
      durationMs,
      success,
      error,
    }).catch(() => {
      // Silently ignore errors per AC2.4
    });
  }

  /**
   * Update checkpoint state with current turn information and message history.
   * Does not load conversation history from the database; instead uses the in-memory
   * history array passed by the caller (already kept in sync via manual pushes).
   * Verifies: arch-hardening.AC3.1 (single load per turn)
   */
  function updateCheckpointStateAndTriggerInterval(
    currentTurnNumber: number,
    currentHistory: ReadonlyArray<ConversationMessage>,
  ): void {
    const messageIds = currentHistory.map(m => m.id);
    checkpointStateRef.current = {
      turnNumber: currentTurnNumber,
      toolRound: 0,
      messageIds,
      compactionMeta: {
        lastCompactedIndex: Math.max(0, lastCompactionMessageCount - 1),
        summaryCount: lastCompactionSummaryCount,
      },
    };
    // Future: trigger checkpoint creation at configured intervals
  }

  async function processMessage(userMessage: string): Promise<string> {
    turnNumber++;

    // Reset loop detector on new user message
    deps.loopDetector?.reset();

    // Step 1: Persist user message
    await persistMessage({
      conversation_id: id,
      role: 'user',
      content: userMessage,
    });

    // Step 2: Load conversation history
    let history = await loadConversationHistory(id);

    // Step 3: Check context budget and compress if needed
    const preliminarySystemPrompt = await buildSystemPrompt(deps.memory);
    const overheadTokens = estimateOverheadTokens(preliminarySystemPrompt, deps.registry.toModelTools(), maxTokens);

    let compactionOccurredThisTurn = false;
    if (deps.compactor && shouldCompress(history, deps.config.context_budget, modelMaxTokens, overheadTokens)) {
      // Pre-compaction checkpoint (AC1.2)
      if (deps.checkpointFn) {
        await deps.checkpointFn('pre_compaction');
      }

      const result = await deps.compactor.compress(history, id);
      history = Array.from(result.history);
      // Reset snapshot state after compaction so next turn gets full snapshot
      snapshotState.reset();
      compactionOccurredThisTurn = result.messagesCompressed > 0;

      // Track compaction metadata for checkpoint state
      if (compactionOccurredThisTurn) {
        lastCompactionMessageCount = history.length;
        lastCompactionSummaryCount = result.batchesCreated ?? 0;
      }
    }

    // Step 4 & 5: Build context and call model
    let roundCount = 0;
    const maxRounds = deps.config.max_tool_rounds;

    // Recall state — cache result across tool rounds
    let cachedRecallResult: RecallResult | null = null;
    let recallExecuted = false;

    while (roundCount < maxRounds) {
      roundCount++;

      // Build fresh context for each round
      let systemPrompt = await buildSystemPrompt(deps.memory);

      // Inject diary section (session-static, same string every round)
      if (deps.diarySection) {
        systemPrompt += '\n\n' + deps.diarySection;
      }

      // Recall step — fires once per turn, cached across tool rounds
      if (!recallExecuted && deps.config.recall_enabled && deps.recallContextState && deps.searchStore) {
        recallExecuted = true;
        try {
          cachedRecallResult = await performRecall(userMessage, {
            searchStore: deps.searchStore,
            embedding: deps.embedding ?? null,
            model: deps.summarizationModel ?? null,
            modelName: deps.summarizationModelName ?? null,
            tokenBudget: deps.config.recall_token_budget ?? 4096,
            traceRecorder: deps.traceRecorder,
            owner: deps.owner,
            conversationId: id,
            coreLabels: getCoreLabels(deps.memory),
          });
        } catch (error) {
          console.warn('recall: pipeline failed, continuing without recall', error);
          cachedRecallResult = null;

          if (deps.traceRecorder) {
            const structured = isConstellationError(error)
              ? error
              : wrapError(error, 'RECALL_FAILED', 'agent', {});
            traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
          }
        }
        deps.recallContextState.setResult(cachedRecallResult);
        // Rebuild system prompt with recall context now set
        systemPrompt = await buildSystemPrompt(deps.memory);
        // Re-append diary after recall rebuilds system prompt (diary is session-static, not included in buildSystemPrompt)
        if (deps.diarySection) {
          systemPrompt += '\n\n' + deps.diarySection;
        }
      } else if (recallExecuted && deps.recallContextState) {
        // Subsequent rounds: result already cached, just ensure state is set
        deps.recallContextState.setResult(cachedRecallResult);
      }

      // Retrieve and append relevant skills
      // KNOWN LIMITATION: Skills currently mutate systemPrompt directly rather than routing through
      // the snapshot pipeline like other dynamic providers (recall, prediction, activity, etc).
      // Future improvement: Create a SkillsContextState holder (similar to RecallContextState) that
      // stores skill content and registers as a dynamic provider in classifiedProviders. This would
      // allow skill injection to be cached and versioned in snapshots. Requires:
      // 1. New SkillsContextState type with setContent/getContent methods
      // 2. Creating the holder before agent loop (in index.ts composition root)
      // 3. Passing it as AgentDependencies.skillsContextState
      // 4. Calling setContent after getRelevant() here, then removing this direct mutation
      // For now, this approach works but prevents skills from being routed through snapshot caching.
      if (deps.skills) {
        try {
          const maxSkills = deps.config.max_skills_per_turn ?? 3;
          const threshold = deps.config.skill_threshold ?? 0.3;
          const relevantSkills = await deps.skills.getRelevant(userMessage, maxSkills, threshold);
          const skillSection = formatSkillsSection(relevantSkills);
          if (skillSection) {
            systemPrompt += '\n\n' + skillSection;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.warn(`failed to retrieve relevant skills: ${errorMsg}`);

          if (deps.traceRecorder) {
            const structured = isConstellationError(error)
              ? error
              : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { operation: 'skill_retrieval' });
            traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
          }
        }
      }

      const messages = await buildMessages(history, deps.memory);

      // Pre-flight guard: truncate if estimated request exceeds model limit
      const modelTools = deps.registry.toModelTools();
      const requestOverhead = estimateOverheadTokens(systemPrompt, modelTools, maxTokens);
      const messageTokens = messages.reduce(
        (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
        0,
      );

      let finalMessages = messages;
      const safeLimit = Math.floor(modelMaxTokens * 0.9);
      if (messageTokens + requestOverhead > safeLimit) {
        console.warn(
          `pre-flight guard: estimated ${messageTokens + requestOverhead} tokens exceeds safe limit ${safeLimit} (model max: ${modelMaxTokens}), truncating oldest messages`,
        );
        finalMessages = truncateOldest(messages, modelMaxTokens, requestOverhead);
      }

      // Compute snapshot — first round forces full, subsequent rounds detect delta/noop
      const isFirstRound = roundCount === 1;
      const snapshotResult = snapshotState.computeSnapshot(dynamicProviders, isFirstRound);

      // Build final user message with snapshot composition
      const lastMessage = finalMessages[finalMessages.length - 1];
      if (lastMessage && lastMessage.role === 'user' && typeof lastMessage.content === 'string') {
        const composedUserMessage = buildUserMessage(lastMessage.content, snapshotResult);
        finalMessages = [...finalMessages.slice(0, -1), composedUserMessage];
      }

      // Call cache diagnostics before model.complete()
      if (cacheDiagnostics) {
        // Detect tool changes for cache diagnostics
        const currentToolsSerialized = serializeTools(modelTools);
        const currentToolsHash = BigInt(Bun.hash(currentToolsSerialized));
        const toolsChangedThisTurn = previousToolsHash !== null && currentToolsHash !== previousToolsHash;
        previousToolsHash = currentToolsHash;

        const cacheBustEvents = cacheDiagnostics.checkForCacheBust({
          systemPrompt,
          tools: modelTools,
          messages: finalMessages,
          betaHeaders: undefined,
          turn: turnNumber,
          flags: {
            compactionOccurred: compactionOccurredThisTurn,
            toolsChanged: toolsChangedThisTurn,
            isFirstTurn: turnNumber === 1 && roundCount === 1,
          },
        });

        for (const event of cacheBustEvents) {
          const summary = `${event.dimension} changed: ${event.previousSize} chars → ${event.currentSize} chars (${event.delta >= 0 ? '+' : ''}${event.delta})`;
          console.warn(`cache bust detected (turn ${event.turn}): ${summary}`);
          recordTrace(
            'cache_diagnostics',
            { dimension: event.dimension, turn: event.turn },
            summary,
            0,
            true,
            null,
          );
        }

        // Reset after consumption so subsequent tool rounds in the same turn
        // don't carry the flag forward (unless compaction happens again in the tool round).
        compactionOccurredThisTurn = false;
      }

      // Call the model with current context
      const modelRequest = {
        messages: finalMessages,
        system: systemPrompt,
        tools: modelTools,
        model: modelName,
        max_tokens: maxTokens,
      };

      const response = await deps.model.complete(modelRequest);

      // Post-response loop detection check
      if (deps.loopDetector) {
        // For text responses, check the text content (stripped of quotes)
        // For tool calls, check serialised tool name + arguments
        const responseForDetection = response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens'
          ? stripQuotedContent(response.content.find((block) => block.type === 'text')?.text ?? '')
          : response.content
            .filter((block) => block.type === 'tool_use')
            .map((block) => `${(block as ToolUseBlock).name} ${JSON.stringify((block as ToolUseBlock).input)}`)
            .join('\n');

        const loopResult = deps.loopDetector.check(responseForDetection);

        if (loopResult.triggered) {
          if (loopResult.action === 'halt') {
            // End the turn with an error message
            const haltMessage = 'I appear to be stuck in a repetitive loop and cannot make progress. Please try rephrasing your request or providing additional context.';

            await persistMessage({
              conversation_id: id,
              role: 'assistant',
              content: haltMessage,
            });

            return haltMessage;
          }

          // For warn/redirect, inject a system message before the next round
          const warningMessage = 'Your recent responses appear repetitive. Try a different approach.';
          const redirectHint = loopResult.action === 'redirect'
            ? ' Consider using a different tool or strategy than what you have been attempting.'
            : '';

          // Inject as system context for next model call
          // Implementation: append to conversation history as a system-injected message
          history.push({
            id: crypto.randomUUID(),
            conversation_id: id,
            role: 'user',
            content: `[System: ${warningMessage}${redirectHint}]`,
            created_at: new Date(),
          });
        }
      }

      // Step 6: Handle response based on stop_reason
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract text content and return
        const textContent = response.content.find((block) => block.type === 'text') as TextBlock | undefined;
        const text = textContent?.text || '';

        // Persist assistant message
        const assistantMessageId = await persistMessage({
          conversation_id: id,
          role: 'assistant',
          content: text,
          reasoning_content: response.reasoning_content,
        });

        // Push assistant message onto history before checkpoint update (verifies AC3.2)
        history.push({
          id: assistantMessageId,
          conversation_id: id,
          role: 'assistant',
          content: text,
          tool_calls: undefined,
          tool_call_id: undefined,
          reasoning_content: response.reasoning_content ?? undefined,
          created_at: new Date(),
        });

        // Update checkpoint state with current history (verifies AC3.1, AC3.2)
        updateCheckpointStateAndTriggerInterval(turnNumber, history);

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
          reasoning_content: response.reasoning_content,
        });

        // Dispatch each tool use and collect results
        const toolResults: Array<ConversationMessage> = [];
        for (const toolUse of toolUseBlocks) {
          let toolResult: string;

          const startTime = Date.now();
          try {
            if (toolUse.name === 'execute_code') {
              // Special case: code execution
              const code = String(toolUse.input['code']);
              const stubs = deps.registry.generateStubs();
              const context = deps.getExecutionContext?.();
              const result = await deps.runtime.execute(code, stubs, context);

              toolResult = result.success ? result.output : `Error: ${result.error}`;
              recordTrace('execute_code', toolUse.input, toolResult, Date.now() - startTime, result.success, result.success ? null : (result.error ?? null));
            } else if (toolUse.name === 'compact_context') {
              // Special case: context compaction
              const compactSuccess = !!deps.compactor;
              if (deps.compactor) {
                // Pre-compaction checkpoint (AC1.2)
                if (deps.checkpointFn) {
                  await deps.checkpointFn('pre_compaction');
                }

                const compactionResult = await deps.compactor.compress(history, id);
                history = Array.from(compactionResult.history);
                // Reset snapshot state after compaction so next tool round gets full snapshot
                snapshotState.reset();
                compactionOccurredThisTurn = compactionResult.messagesCompressed > 0;
                // Track compaction metadata for checkpoint state
                if (compactionOccurredThisTurn) {
                  lastCompactionMessageCount = history.length;
                  lastCompactionSummaryCount = compactionResult.batchesCreated ?? 0;
                }

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
              recordTrace('compact_context', toolUse.input, toolResult, Date.now() - startTime, compactSuccess, compactSuccess ? null : 'Compaction not configured');
            } else {
              // Regular tool dispatch
              const result = await deps.registry.dispatch(toolUse.name, toolUse.input);
              toolResult = result.output;
              recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, result.success, result.error ?? null);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolResult = `Error executing tool ${toolUse.name}: ${errorMsg}`;
            recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, false, errorMsg);

            // Record structured error trace if available
            if (deps.traceRecorder) {
              const structured = isConstellationError(error)
                ? error
                : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { toolName: toolUse.name });
              traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
            }
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
          reasoning_content: response.reasoning_content,
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

    const warningMessageId = await persistMessage({
      conversation_id: id,
      role: 'assistant',
      content: warningMessage,
    });

    // Push warning message onto history before checkpoint update
    history.push({
      id: warningMessageId,
      conversation_id: id,
      role: 'assistant',
      content: warningMessage,
      tool_calls: undefined,
      tool_call_id: undefined,
      reasoning_content: undefined,
      created_at: new Date(),
    });

    // Update checkpoint state with current history (verifies AC3.1, AC3.2)
    updateCheckpointStateAndTriggerInterval(turnNumber, history);

    return warningMessage;
  }

  async function getConversationHistory(): Promise<Array<ConversationMessage>> {
    return loadConversationHistory(id);
  }

  async function processEvent(event: ExternalEvent): Promise<string> {
    const formattedMessage = formatExternalEvent(event, deps.sourceInstructions);
    return processMessage(formattedMessage);
  }

  function getCheckpointState(): CheckpointState | null {
    return checkpointStateRef.current;
  }

  return {
    processMessage,
    processEvent,
    getConversationHistory,
    getCheckpointState,
    conversationId: id,
  };

  /**
   * Generate an embedding for a message, with graceful null fallback on provider absence or error.
   * Pattern: Follow MemoryManager.generateEmbedding() for consistent error handling.
   */
  async function generateMessageEmbedding(text: string): Promise<Array<number> | null> {
    if (!deps.embedding) return null;
    try {
      return await deps.embedding.embed(text);
    } catch (error) {
      console.warn('embedding provider failed for message, storing with null embedding', error);
      return null;
    }
  }

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
    reasoning_content?: string | null;
  }): Promise<string> {
    // Generate embedding for user/assistant messages, null for system/tool
    let embedding: Array<number> | null = null;
    if (msg.role === 'user' || msg.role === 'assistant') {
      embedding = await generateMessageEmbedding(msg.content);
    }

    // Format embedding for SQL: use toSql for non-null, null otherwise
    const embeddingValue = embedding ? toSql(embedding) : null;

    const result = await deps.persistence.query(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [msg.conversation_id, msg.role, msg.content, msg.tool_calls ? JSON.stringify(msg.tool_calls) : null, msg.tool_call_id || null, msg.reasoning_content || null, embeddingValue],
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
      `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at
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
      reasoning_content: row['reasoning_content'] ? String(row['reasoning_content']) : undefined,
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
