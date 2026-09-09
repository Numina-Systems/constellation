// pattern: Imperative Shell

/**
 * Core agent loop implementation.
 * Orchestrates message processing, conversation history management,
 * tool dispatch, and context compression.
 */

// UUID generation is built-in to Bun via crypto
import { toSql } from 'pgvector/utils';
import { AsyncLocalStorage } from 'node:async_hooks';
import { buildSystemPrompt, buildMessagesWithCurrent, estimateOverheadTokens, estimateTokens, shouldCompress } from './context.ts';
import { createSnapshotState } from './snapshot.ts';
import { buildUserMessage } from './messages.ts';
import { createCacheDiagnostics, serializeTools } from './cache-diagnostics.ts';
import { formatSkillsSection } from '../skill/context.ts';
import { performRecall } from '../recall/index.js';
import { isConstellationError, wrapError } from '@/errors/index.js';
import { traceError } from '@/errors/trace.js';
import { stripQuotedContent } from '@/loop-detection/strip-quotes.js';
import { AgentError } from '@/errors/agent.js';
import { buildRequestBudget, resolveContextWindow } from '@/model/budget.ts';
import { groupExchanges, shapeExchanges } from '@/model/exchange.ts';
import type { Message as ModelMessage } from '@/model/types.ts';
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
function toToolOutcome(output: string, isError: boolean, errorCode = 'tool_failed'): import('@/contracts/outcomes.ts').ToolOutcome {
  if (!isError) return {kind: 'success', output};
  return {kind: 'error', code: errorCode, message: output.slice(0, 4096)};
}

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
  // The injected reference is the sole state source. A local fallback is only for legacy callers.
  const checkpointStateRef: CheckpointStateRef = deps.checkpointStateRef
    ? deps.checkpointStateRef as unknown as CheckpointStateRef
    : {current: null};

  let turnNumber = checkpointStateRef.current?.turnNumber ?? 0;
  let shutdownRequested = false;
  let shutdownCompleted = false;
  let completedTurnCount = turnNumber;
  let completedTurnCountLoaded = false;
  let explicitCheckpointPending = false;
  let queueTail: Promise<void> = Promise.resolve();
  let recoveryRequired = false;
  let recoveryReason: string | null = null;
  let previousToolsHash: bigint | null = null;
  let lastCompactionMessageCount = 0;
  let lastCompactionSummaryCount = 0;
  // Durable and legacy modes share this checkpoint surface: durable compaction publishes
  // receipt/archive provenance, while legacy callers retain the last known empty state.
  let activeArchiveIds: ReadonlyArray<string> = checkpointStateRef.current?.activeArchiveIds ?? [];
  let provenanceRefs: ReadonlyArray<string> = checkpointStateRef.current?.provenanceRefs ?? [];
  const ingressContext = new AsyncLocalStorage<boolean>();

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
  function freezeSnapshot<T>(value: T): T {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) freezeSnapshot(child);
    return Object.freeze(value);
  }

  async function updateCheckpointState(
    currentTurnNumber: number,
    currentHistory: ReadonlyArray<ConversationMessage>,
    transcriptRevision?: number,
  ): Promise<void> {
    const state: CheckpointState = {
      turnNumber: currentTurnNumber,
      toolRound: 0,
      messageIds: currentHistory.map(m => m.id),
      transcriptRevision,
      activeArchiveIds,
      provenanceRefs,
      compactionMeta: {
        lastCompactedIndex: Math.max(0, lastCompactionMessageCount - 1),
        summaryCount: lastCompactionSummaryCount,
      },
    };
    checkpointStateRef.current = state;
  }

  async function invokeCheckpoint(
    trigger: import('./checkpoint-types.ts').CheckpointTrigger,
    currentTurnNumber: number,
    currentHistory: ReadonlyArray<ConversationMessage>,
    transcriptRevision?: number,
  ): Promise<void> {
    if (!deps.checkpointFn) return;
    await updateCheckpointState(currentTurnNumber, currentHistory, transcriptRevision);
    const current = checkpointStateRef.current;
    if (!current) return;
    const snapshot = freezeSnapshot({
      turnNumber: current.turnNumber,
      toolRound: current.toolRound,
      messageIds: Array.from(current.messageIds),
      transcriptRevision: current.transcriptRevision,
      activeArchiveIds: Array.from(current.activeArchiveIds ?? []),
      provenanceRefs: Array.from(current.provenanceRefs ?? []),
      compactionMeta: {...current.compactionMeta},
    });
    try {
      await deps.checkpointFn(trigger, snapshot);
    } catch (error) {
      console.warn(`[checkpoint] ${trigger} checkpoint callback failed: ${error instanceof Error ? error.message : String(error)}`);
      if (deps.traceRecorder) {
        const structured = isConstellationError(error)
          ? error
          : wrapError(error, 'CHECKPOINT_FAILED', 'agent', {conversationId: id, trigger});
        traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
      }
    }
  }

  async function completeTurn(
    currentTurnNumber: number,
    currentHistory: ReadonlyArray<ConversationMessage>,
  ): Promise<void> {
    turnNumber = currentTurnNumber;
    completedTurnCount = currentTurnNumber;
    let revision: number | undefined;
    if (deps.historyStore) {
      try {
        revision = (await deps.historyStore.readActive(id)).revision;
      } catch (error) {
        // The terminal response and completed-turn receipt are already durable. A
        // transient projection reread must not turn a delivered response into a
        // rejected turn; omit only the optional revision from this checkpoint.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[agent] completed turn ${currentTurnNumber} revision reread failed: ${message}`);
        if (deps.traceRecorder) {
          const structured = isConstellationError(error)
            ? error
            : wrapError(error, 'HISTORY_READ_FAILED', 'agent', {conversationId: id, turnNumber: currentTurnNumber});
          traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
        }
      }
    }
    if (deps.integrityLifecycle?.recordCompletedTurn) {
      try {
        await deps.integrityLifecycle.recordCompletedTurn(currentTurnNumber);
      } catch (error) {
        throw new AgentError('INTEGRITY_FAILED', 'failed to persist completed turn counter', {conversationId: id, turnNumber: currentTurnNumber}, {cause: error instanceof Error ? error : undefined});
      }
    }
    await updateCheckpointState(currentTurnNumber, currentHistory, revision);
    const interval = deps.config.checkpoint_interval ?? 0;
    if (interval > 0 && currentTurnNumber % interval === 0) {
      await invokeCheckpoint('interval', currentTurnNumber, currentHistory, revision);
    }
  }

  async function runTurn(userMessage: string, ingressOptions?: import('@/contracts/execution.ts').ExecutionOptions): Promise<string> {
    const options = ingressOptions ?? deps.ingressOptions;
    if (deps.integrityLifecycle) {
      try {
        if (!completedTurnCountLoaded && deps.integrityLifecycle.getCompletedTurnCount) {
          const durableCount = await deps.integrityLifecycle.getCompletedTurnCount();
          completedTurnCount = Math.max(completedTurnCount, durableCount);
          turnNumber = completedTurnCount;
        }
        completedTurnCountLoaded = true;
        const persistedRecovery = await deps.integrityLifecycle.getRecoveryState();
        if (persistedRecovery.required) {
          recoveryRequired = true;
          recoveryReason = persistedRecovery.reason;
        }
      } catch (error) {
        recoveryRequired = true;
        recoveryReason = `failed to read conversation integrity state: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (recoveryRequired) {
      throw new AgentError('RECOVERY_REQUIRED', `conversation ${id} requires trusted recovery`, {
        conversationId: id,
        reason: recoveryReason ?? 'unfinished tool batch',
      }, {suggestion: 'backfill every unresolved tool outcome through the trusted recovery accessor'});
    }
    if (options?.signal?.aborted) {
      throw new AgentError('TURN_CANCELLED', 'turn cancelled before admission', {conversationId: id});
    }
    if (options?.deadline !== undefined && Date.now() >= options.deadline) {
      throw new AgentError('TURN_CANCELLED', 'turn deadline exceeded before admission', {conversationId: id});
    }
    // Allocate the turn number from the last successfully completed turn. A failure
    // therefore cannot consume an interval boundary.
    const currentTurnNumber = completedTurnCount + 1;
    turnNumber = currentTurnNumber;
    // Reset loop detector on new user message
    deps.loopDetector?.reset();

    // Step 1: Persist user message
    const currentUserMessageId = await persistMessage({
      conversation_id: id,
      role: 'user',
      content: userMessage,
    });

    // Step 2: Load the active projection; historical rows never enter context implicitly.
    let history = deps.historyStore
      ? Array.from((await deps.historyStore.readActive(id)).messages)
      : await loadConversationHistory(id);

    // Step 3: context compaction is admitted only at completed-batch boundaries.
    let compactionOccurredThisTurn = false;

    // Step 4 & 5: Build context and call model
    let roundCount = 0;
    const maxRounds = deps.config.max_tool_rounds;
    let deferredCompactionPending = false;
    let compactionAdmittedAtBoundary = false;
    if (deps.integrityLifecycle?.consumeCompactionIntent) {
      deferredCompactionPending = await deps.integrityLifecycle.consumeCompactionIntent();
    }

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
            executionOptions: options,
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

      const builtContext = await buildMessagesWithCurrent(history, deps.memory, currentUserMessageId);
      const messages = builtContext.messages;

      // Validate and shape every provider-visible exchange. The current user is
      // protected by transcript identity, not by role or position.
      const grouped = groupExchanges(messages, builtContext.currentMessage);
      if (!grouped.ok) {
        throw new AgentError('EXCHANGE_CORRUPT', grouped.error.message, {
          conversationId: id,
          exchangeError: grouped.error.code,
          toolUseId: grouped.error.toolUseId ?? null,
        }, {suggestion: 'run trusted integrity recovery to backfill missing tool outcomes'});
      }
      const modelTools = deps.registry.toModelTools();
      const requestOverhead = estimateOverheadTokens(systemPrompt, modelTools, maxTokens);
      const messageTokens = messages.reduce(
        (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
        0,
      );
      let finalMessages: Array<ModelMessage> = Array.from(messages);
      if (messageTokens + requestOverhead > Math.floor(modelMaxTokens * 0.9)) {
        const shaped = shapeExchanges(grouped.exchanges, Math.max(1, Math.floor(modelMaxTokens * 0.9) - requestOverhead));
        finalMessages = shaped.flatMap((exchange) => exchange.messages);
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

      const finalGrouped = groupExchanges(finalMessages, finalMessages.length > 0 ? finalMessages[finalMessages.length - 1] ?? null : null);
      if (!finalGrouped.ok) {
        throw new AgentError('EXCHANGE_CORRUPT', finalGrouped.error.message, {
          conversationId: id,
          exchangeError: finalGrouped.error.code,
          toolUseId: finalGrouped.error.toolUseId ?? null,
        }, {suggestion: 'run trusted integrity recovery to backfill missing tool outcomes'});
      }

      // Admission is evaluated against the actual provider-shaped request, before diagnostics and model I/O.
      const admissionWindow = resolveContextWindow({explicit: modelMaxTokens}).window;
      const admissionTools = modelTools;
      const admissionBudget = admissionWindow === null
        ? {ok: false as const, code: 'context_unfittable' as const, message: 'verified model context window is unavailable'}
        : buildRequestBudget({
            system: systemPrompt,
            messages: finalMessages,
            tools: admissionTools,
            outputReserve: maxTokens,
            contextWindow: admissionWindow,
          });
      const automaticCompactionNeeded = shouldCompress(history, deps.config.context_budget, modelMaxTokens, requestOverhead);
      const shouldAdmitCompaction = !compactionAdmittedAtBoundary &&
        (deferredCompactionPending || automaticCompactionNeeded);
      if (shouldAdmitCompaction) {
        compactionAdmittedAtBoundary = true;
        if (!deps.compactor) {
          recordTrace('compact_context', {}, 'compaction admission skipped: compactor is not configured', 0, true, null);
        } else {
          try {
            const revision = deps.historyStore ? (await deps.historyStore.readActive(id)).revision : undefined;
            await invokeCheckpoint('pre_compaction', turnNumber, history, revision);
            const compactionResult = await deps.compactor.compress(history, id);
            history = Array.from(compactionResult.history);
            const committedReplacement = compactionResult.failed !== true && compactionResult.messagesCompressed > 0;
            if (committedReplacement) {
              // Cache/snapshot state is published only after the compactor reports a
              // successful durable replacement. Failed/no-op attempts must not make
              // the next provider request observe a fabricated cache bust.
              snapshotState.reset();
              compactionOccurredThisTurn = true;
              lastCompactionMessageCount = history.length;
              lastCompactionSummaryCount = compactionResult.batchesCreated ?? 0;
              activeArchiveIds = compactionResult.archiveIds ?? [];
              provenanceRefs = compactionResult.provenanceRefs ?? (compactionResult.operationId ? [compactionResult.operationId] : []);
            }
            deferredCompactionPending = false;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            recordTrace('compact_context', {}, 'compaction admission failed; continuing without replacement', 0, false, message);
            if (deps.traceRecorder) {
              const structured = isConstellationError(error)
                ? error
                : wrapError(error, 'COMPACTION_FAILED', 'agent', {conversationId: id});
              traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
            }
          }
        }
        roundCount--;
        continue;
      }
      if (!admissionBudget.ok || !admissionBudget.budget.fits) {
        const groupedMessages = shapeExchanges(finalGrouped.exchanges, Math.max(1, Math.floor(modelMaxTokens * 0.9) - requestOverhead)).flatMap((exchange) => exchange.messages);
        const currentExchangeMessage = finalGrouped.exchanges.find((exchange) => exchange.isCurrent)?.messages.at(-1) ?? null;
        const shapedGrouped = groupExchanges(groupedMessages, currentExchangeMessage);
        if (!shapedGrouped.ok) {
          throw new AgentError('EXCHANGE_CORRUPT', shapedGrouped.error.message, {
            conversationId: id,
            exchangeError: shapedGrouped.error.code,
            toolUseId: shapedGrouped.error.toolUseId ?? null,
          }, {suggestion: 'run trusted integrity recovery to backfill missing tool outcomes'});
        }
        const regroupedMessages = shapedGrouped.exchanges.flatMap((exchange) => exchange.messages);
        const groupedBudget = buildRequestBudget({
          system: systemPrompt,
          messages: groupedMessages,
          tools: admissionTools,
          outputReserve: maxTokens,
          contextWindow: admissionWindow ?? modelMaxTokens,
        });
        if (!groupedBudget.ok || !groupedBudget.budget.fits) {
          throw new AgentError('CONTEXT_UNFITTABLE', 'context is unfittable within the resolved model budget', {
            conversationId: id,
            estimatedInputTokens: groupedBudget.ok ? groupedBudget.budget.estimatedInputTokens : null,
            contextWindow: admissionWindow,
            outputReserve: maxTokens,
          });
        }
        finalMessages = regroupedMessages;
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
         signal: options?.signal,
        deadline: options?.deadline,
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

            const haltMessageId = await persistMessage({
              conversation_id: id,
              role: 'assistant',
              content: haltMessage,
            });
            await completeTurn(turnNumber, [...history, {
              id: haltMessageId, conversation_id: id, role: 'assistant', content: haltMessage,
              created_at: new Date(),
            }]);

            return haltMessage;
          }

          // For warn/redirect, inject a system message before the next round
          const warningMessage = 'Your recent responses appear repetitive. Try a different approach.';
          const redirectHint = loopResult.action === 'redirect'
            ? ' Consider using a different tool or strategy than what you have been attempting.'
            : '';

          // Inject as system context for next model call
          // Implementation: append to conversation history as a system-injected message
          const warningContent = `[System: ${warningMessage}${redirectHint}]`;
          const warningMessageId = await persistMessage({
            conversation_id: id,
            role: 'user',
            content: warningContent,
          });
          history.push({
            id: warningMessageId,
            conversation_id: id,
            role: 'user',
            content: warningContent,
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

        // Publish checkpoint state only after the terminal assistant message is durable.
        await completeTurn(turnNumber, history);

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

        // Dispatch each tool use and collect results. Begin durable lifecycle before any effect.
        const toolResults: Array<ConversationMessage> = [];
        let batchId: string | null = null;
        const recordedCallIds = new Set<string>();
        const startedCallIds = new Set<string>();
        try {
          if (deps.integrityLifecycle) {
            try {
              batchId = await deps.integrityLifecycle.beginBatch(toolUseBlocks.map((toolUse) => toolUse.id));
            } catch (error) {
              recoveryRequired = true;
              recoveryReason = `tool batch could not be durably started: ${error instanceof Error ? error.message : String(error)}`;
              throw new AgentError('RECOVERY_REQUIRED', recoveryReason, {conversationId: id});
            }
          }
          for (const toolUse of toolUseBlocks) {
            if (options?.signal?.aborted) {
              throw new AgentError('TURN_CANCELLED', 'turn cancelled during tool batch', {conversationId: id, batchId});
            }
            if (options?.deadline !== undefined && Date.now() >= options.deadline) {
              throw new AgentError('TURN_CANCELLED', 'turn deadline exceeded during tool batch', {conversationId: id, batchId});
            }
            let toolResult: string;
            let toolOutcomeError: string | null = null;
            startedCallIds.add(toolUse.id);

          const startTime = Date.now();
          try {
            if (toolUse.name === 'execute_code') {
              // Special case: code execution
              const code = String(toolUse.input['code']);
              const stubs = deps.registry.generateStubs();
              const context = await deps.getExecutionContext?.();
              const result = await ingressContext.run(true, () => deps.runtime.execute(code, stubs, context));

              toolResult = result.success ? result.output : `Error: ${result.error ?? 'code execution failed'}`;
              toolOutcomeError = result.success ? null : 'execute_code_failed';
              recordTrace('execute_code', toolUse.input, toolResult, Date.now() - startTime, result.success, result.success ? null : (result.error ?? 'code execution failed'));
            } else if (toolUse.name === 'checkpoint') {
              // Explicit checkpoints are deferred until this complete tool batch is durable.
              explicitCheckpointPending = true;
              toolResult = JSON.stringify({accepted: true, deferred: true});
              recordTrace('checkpoint', toolUse.input, toolResult, Date.now() - startTime, true, null);
            } else if (toolUse.name === 'compact_context') {
              // Compaction is deferred until the completed-batch admission boundary.
              if (deps.integrityLifecycle?.requestCompaction) {
                await deps.integrityLifecycle.requestCompaction();
              }
              deferredCompactionPending = true;
              toolResult = JSON.stringify({accepted: true, deferred: true});
              recordTrace('compact_context', toolUse.input, toolResult, Date.now() - startTime, true, null);
            } else {
              // Regular tool dispatch
              const result = await ingressContext.run(true, () => deps.registry.dispatch(toolUse.name, toolUse.input));
              toolResult = result.output;
              toolOutcomeError = result.success ? null : (result.error ?? 'tool dispatch failed');
              recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, result.success, result.error ?? null);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toolResult = `Error executing tool ${toolUse.name}: ${errorMsg}`;
            toolOutcomeError = 'tool_dispatch_failed';
            recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, false, errorMsg);

            // Record structured error trace if available
            if (deps.traceRecorder) {
              const structured = isConstellationError(error)
                ? error
                : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { toolName: toolUse.name });
              traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
            }
          }

          // Persist the typed tool outcome together with its correlated call.
          const persistedOutcome = toToolOutcome(toolResult, toolOutcomeError !== null, toolOutcomeError ?? 'tool_failed');
          await persistMessage({
            conversation_id: id,
            role: 'tool',
            content: toolResult,
            tool_call_id: toolUse.id,
            tool_outcome: persistedOutcome,
          });

          // Collect tool result for history (added after assistant message below)
          toolResults.push({
            id: `tool-result-${toolUse.id}`,
            conversation_id: id,
            role: 'tool' as const,
            content: toolResult,
            tool_call_id: toolUse.id,
            tool_outcome: persistedOutcome,
            created_at: new Date(),
          });
          if (batchId && deps.integrityLifecycle) {
            try {
              await deps.integrityLifecycle.recordOutcome(batchId, toolUse.id, persistedOutcome);
              recordedCallIds.add(toolUse.id);
            } catch (error) {
              throw new AgentError(
                'INTEGRITY_FAILED',
                'failed to persist tool outcome',
                {conversationId: id, batchId, callId: toolUse.id},
                {cause: error instanceof Error ? error : undefined},
              );
            }
          }
        }
        if (batchId && deps.integrityLifecycle) {
          try {
            await deps.integrityLifecycle.completeBatch(batchId);
          } catch (error) {
            throw new AgentError(
              'INTEGRITY_FAILED',
              'failed to complete tool batch',
              {conversationId: id, batchId},
              {cause: error instanceof Error ? error : undefined},
            );
          }
        }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (batchId && deps.integrityLifecycle) {
            let backfillFailed = false;
            for (const toolUse of toolUseBlocks) {
              if (recordedCallIds.has(toolUse.id)) continue;
              try {
                await deps.integrityLifecycle.recordOutcome(batchId, toolUse.id, startedCallIds.has(toolUse.id)
                  ? {kind: 'outcome_unknown', code: 'outcome_persistence_failed', message: reason}
                  : {kind: 'cancelled', code: 'cancelled', message: reason});
                recordedCallIds.add(toolUse.id);
              } catch {
                backfillFailed = true;
              }
            }
            if (backfillFailed) {
              recoveryRequired = true;
              recoveryReason = `tool batch ${batchId} outcome persistence failed: ${reason}`;
              try {
                await deps.integrityLifecycle.markRecoveryRequired?.(batchId, recoveryReason);
              } catch {
                // The in-memory latch remains fail-closed if the durable marker also fails.
              }
            } else {
              try {
                await deps.integrityLifecycle.completeBatch(batchId);
              } catch {
                recoveryRequired = true;
                recoveryReason = `tool batch ${batchId} could not be completed: ${reason}`;
                try {
                  await deps.integrityLifecycle.markRecoveryRequired?.(batchId, recoveryReason);
                } catch {
                  // Preserve the local fail-closed latch.
                }
              }
            }
          }
          throw error;
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
        // A completed tool batch closes this admission boundary; the next provider request may admit once.
        compactionAdmittedAtBoundary = false;
        if (explicitCheckpointPending) {
          explicitCheckpointPending = false;
          await invokeCheckpoint('explicit', turnNumber, history);
        }
        if (deps.integrityLifecycle?.consumeCompactionIntent) {
          deferredCompactionPending = await deps.integrityLifecycle.consumeCompactionIntent();
        }

        // Continue loop for next round
        continue;
      }

      // Unknown stop reason - return empty string
      return '';
    }

    // Max rounds exceeded
    if (explicitCheckpointPending) {
      explicitCheckpointPending = false;
      await invokeCheckpoint('explicit', turnNumber, history);
    }
    if (deps.integrityLifecycle?.consumeCompactionIntent) {
      deferredCompactionPending = await deps.integrityLifecycle.consumeCompactionIntent();
    }
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

    // A max-round warning is still a successfully completed turn.
    await completeTurn(turnNumber, history);

    return warningMessage;
  }

  async function processMessage(userMessage: string, options?: import('@/contracts/execution.ts').ExecutionOptions): Promise<string> {
    if (shutdownRequested) throw new AgentError('TURN_CANCELLED', 'agent is shutting down', {conversationId: id});
    if (ingressContext.getStore() === true) {
      throw new AgentError('REENTRANT_INGRESS', 'reentrant ingress acquisition is not allowed from a tool handler', {conversationId: id});
    }
    const result = queueTail.then(() => runTurn(userMessage, options));
    queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function shutdown(): Promise<void> {
    if (shutdownCompleted) return;
    shutdownRequested = true;
    await queueTail;
    const history = deps.historyStore
      ? Array.from((await deps.historyStore.readActive(id)).messages)
      : await loadConversationHistory(id);
    await invokeCheckpoint('shutdown', completedTurnCount, history);
    shutdownCompleted = true;
  }

  async function getConversationHistory(): Promise<Array<ConversationMessage>> {
    if (deps.historyStore) return Array.from((await deps.historyStore.readActive(id)).messages);
    return loadConversationHistory(id);
  }

  async function processEvent(event: ExternalEvent, options?: import('@/contracts/execution.ts').ExecutionOptions): Promise<string> {
    const formattedMessage = formatExternalEvent(event, deps.sourceInstructions);
    return processMessage(formattedMessage, options);
  }

  function getCheckpointState(): CheckpointState | null {
    return checkpointStateRef.current;
  }

  return {
    processMessage,
    processEvent,
    getConversationHistory,
    getCheckpointState,
    shutdown,
    getRecoveryState: () => deps.integrityLifecycle
      ? deps.integrityLifecycle.getRecoveryState()
      : Promise.resolve({required: recoveryRequired, reason: recoveryRequired ? 'conversation recovery is required' : null, batchId: null, unresolvedCallIds: []}),
    recoverIntegrity: async (callIds: ReadonlyArray<string>, reason?: string): Promise<void> => {
      if (deps.integrityLifecycle) {
        try {
          await deps.integrityLifecycle.recover(callIds, reason);
        } catch (error) {
          throw new AgentError(
            'INTEGRITY_FAILED',
            'failed to recover conversation integrity state',
            {conversationId: id, callIds: Array.from(callIds)},
            {cause: error instanceof Error ? error : undefined},
          );
        }
      }
      recoveryRequired = false;
    },
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
    tool_outcome?: import('@/contracts/outcomes.ts').ToolOutcome;
    reasoning_content?: string | null;
  }): Promise<string> {
    // Generate embeddings before selecting the persistence boundary so both paths
    // have identical message semantics. Tool/system messages intentionally remain null.
    let embedding: Array<number> | null = null;
    if (msg.role === 'user' || msg.role === 'assistant') {
      embedding = await generateMessageEmbedding(msg.content);
    }
    if (deps.historyStore) {
      const historyMessage = await deps.historyStore.append({
        conversation_id: msg.conversation_id,
        role: msg.role,
        content: msg.content,
        tool_calls: msg.role === 'tool' && msg.tool_outcome !== undefined
          ? {outcome: msg.tool_outcome}
          : msg.tool_calls,
        tool_call_id: msg.tool_call_id ?? null,
        reasoning_content: msg.reasoning_content ?? null,
        embedding,
      });
      return historyMessage.id;
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
