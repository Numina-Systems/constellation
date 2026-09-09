// pattern: Imperative Shell

/**
 * Checkpoint restoration function.
 * Reads a checkpoint from the store and replays state into the agent's subsystems.
 * Integrated into the composition root startup sequence, before the agent loop begins.
 */

import type {SessionCheckpoint} from './checkpoint-types.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {PredictionStore, TraceRecorder} from '@/reflexion/types.ts';
import type {InterestRegistry} from '@/subconscious/types.ts';
import type {RecallContextState} from '@/recall/context.ts';
import type {MessageStore} from '@/persistence/message-store.ts';
import type {ConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import { AgentError } from '@/errors/agent.ts';
import { traceError } from '@/errors/trace.ts';

// ── Pre-flight Validation (Tier 0) ──
type PreflightResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/** Shared checkpoint validation deliberately avoids legacy live-memory limits. */
function validateWorkingMemory(
  workingMemory: ReadonlyArray<{ readonly label: string; readonly content: string }>,
): PreflightResult {
  for (const block of workingMemory) {
    if (!block.label.trim()) return {valid: false, reason: 'working memory labels must not be empty'};
    if (typeof block.content !== 'string') return {valid: false, reason: 'working memory content must be text'};
  }
  return {valid: true};
}

export type RestorationDependencies = {
  readonly persistence: PersistenceProvider;
  readonly memory: MemoryManager;
  readonly messageStore: MessageStore;
  /** Exact restore boundary; required for production checkpoint restoration. */
  readonly historyStore?: ConversationHistoryStore;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
  readonly traceRecorder: TraceRecorder;
  readonly owner: string;
  readonly log?: (message: string) => void;
};

export type RestorationResult = {
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly compactionMeta: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
  readonly messageCount: number;
};

export async function restoreFromCheckpoint(
  checkpoint: SessionCheckpoint,
  deps: RestorationDependencies,
): Promise<RestorationResult> {
  const log = deps.log ?? console.log;

  // ── Tier 0: Pre-flight Validation ──
  const preflight = validateWorkingMemory(checkpoint.workingMemory);
  if (!preflight.valid) {
    const error = new AgentError('CHECKPOINT_FAILED', `pre-flight validation failed: ${preflight.reason}`, {
      conversationId: checkpoint.conversationId, checkpointId: checkpoint.id,
    });
    traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
    throw error;
  }

  // Production restoration is durable-first: active membership and its receipt commit before any in-memory publication.
  if (deps.historyStore) {
    const isNativeV2 = checkpoint.version === 2 && checkpoint.migratedFromVersion !== 1;
    if (isNativeV2 && checkpoint.messageIds.length === 0) {
      throw new AgentError('CHECKPOINT_FAILED', 'cannot restore checkpoint: v2 active history is empty', {conversationId: checkpoint.conversationId, checkpointId: checkpoint.id});
    }
    if (!isNativeV2) log('checkpoint restore: v1 provenance gap; archive selection cannot be resolved from legacy metadata');
    const current = await deps.historyStore.readActive(checkpoint.conversationId);
    const restored = await deps.historyStore.restoreExactHistory({
      operationId: `checkpoint-restore-${checkpoint.id}`,
      conversationId: checkpoint.conversationId,
      expectedRevision: current.revision,
      messageIds: checkpoint.messageIds,
      checkpointId: checkpoint.id,
      sourceArchiveIds: isNativeV2 ? checkpoint.activeArchiveIds : [],
      provenanceRefs: isNativeV2 ? checkpoint.provenanceRefs : [],
    });
    if (deps.memory.replaceWorkingMemory) {
      await deps.memory.replaceWorkingMemory(checkpoint.workingMemory);
    } else {
      throw new AgentError('CHECKPOINT_FAILED', 'working memory replacement is unavailable', {conversationId: checkpoint.conversationId, checkpointId: checkpoint.id});
    }
    if (deps.recallContextState) deps.recallContextState.setResult(null);
    return {
      conversationId: checkpoint.conversationId,
      turnNumber: checkpoint.turnNumber,
      toolRound: checkpoint.toolRound,
      compactionMeta: checkpoint.compactionMeta,
      messageCount: restored.history.messages.length,
    };
  }

  // ── Legacy compatibility path for callers without the history-store boundary ──
  return await deps.persistence.withTransaction(async () => {
    // Tier 1: DB operations (rolled back on any failure)

    // Verify conversation exists via MessageStore
    const messageCount = await deps.messageStore.count(checkpoint.conversationId);
    if (messageCount === 0 && checkpoint.messageIds.length > 0) {
      const error = new AgentError(
        'CHECKPOINT_FAILED',
        'cannot restore checkpoint: conversation has no messages (deleted or missing)',
        { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
      );
      traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
      throw error;
    }

    // Verify message coverage
    const existingIds = await deps.messageStore.listIds(checkpoint.conversationId);
    const existingIdSet = new Set(existingIds);
    const missingMessages = checkpoint.messageIds.filter(id => !existingIdSet.has(id));
    if (missingMessages.length > 0 && checkpoint.version === 2 && checkpoint.migratedFromVersion !== 1) {
      const error = new AgentError(
        'CHECKPOINT_FAILED',
        `cannot restore checkpoint: missing retained message IDs (${missingMessages.join(', ')})`,
        { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
      );
      traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
      throw error;
    }
    if (missingMessages.length > 0) {
      log(`checkpoint restore: ${missingMessages.length} legacy v1 messages no longer in conversation (provenance unavailable)`);
    }

    // Verify predictions (read-only check, no writes)
    if (deps.predictionStore && checkpoint.pendingPredictions.length > 0) {
      const pending = await deps.predictionStore.listPredictions(deps.owner, 'pending');
      const pendingIds = new Set(pending.map(p => p.id));
      const missingPredictions = checkpoint.pendingPredictions.filter(p => !pendingIds.has(p.id));
      if (missingPredictions.length > 0) {
        log(`checkpoint restore: ${missingPredictions.length} predictions no longer pending`);
      }
    }

    // Restore interest engagement scores (DB writes)
    if (deps.interestRegistry && checkpoint.activeInterests.length > 0) {
      const dbInterests = await deps.interestRegistry.listInterests(deps.owner);
      const dbInterestMap = new Map(dbInterests.map(i => [i.id, i]));
      for (const checkpointInterest of checkpoint.activeInterests) {
        const dbInterest = dbInterestMap.get(checkpointInterest.id);
        if (!dbInterest) {
          log(`checkpoint restore: interest "${checkpointInterest.name}" no longer exists`);
          continue;
        }
        if (dbInterest.engagementScore !== checkpointInterest.engagementScore) {
          await deps.interestRegistry.updateInterest(checkpointInterest.id, {
            engagementScore: checkpointInterest.engagementScore,
          });
        }
      }
    }

    // ── Tier 2: Memory writes (last, inside transaction) ──
    try {
      const currentBlocks = await deps.memory.list('working');
      const checkpointLabels = new Set(checkpoint.workingMemory.map(b => b.label));

      // Write all checkpoint blocks
      for (const block of checkpoint.workingMemory) {
        await deps.memory.write(block.label, block.content, 'working');
      }

      // Delete blocks not in checkpoint
      for (const existing of currentBlocks) {
        if (!checkpointLabels.has(existing.label)) {
          await deps.memory.deleteBlock(existing.id);
        }
      }
    } catch (memoryError) {
      // Best-effort clear working memory before rethrowing
      try {
        const remainingBlocks = await deps.memory.list('working');
        for (const block of remainingBlocks) {
          await deps.memory.deleteBlock(block.id);
        }
      } catch {
        // Ignore cleanup failures — the DB rollback is what matters
      }
      throw memoryError; // Propagates to withTransaction, triggers ROLLBACK
    }

    // Clear recall cache
    if (deps.recallContextState) {
      deps.recallContextState.setResult(null);
    }

    return {
      conversationId: checkpoint.conversationId,
      turnNumber: checkpoint.turnNumber,
      toolRound: checkpoint.toolRound,
      compactionMeta: checkpoint.compactionMeta,
      messageCount,
    };
  });
}
