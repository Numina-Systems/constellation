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
import { AgentError } from '@/errors/agent.ts';
import { traceError } from '@/errors/trace.ts';

// ── Memory Constraint Constants ──
const MAX_WORKING_BLOCKS = 20;
const MAX_BLOCK_CONTENT_LENGTH = 10000;
const LABEL_PATTERN = /^[a-z][a-z0-9_-]*$/;

// ── Pre-flight Validation (Tier 0) ──
type PreflightResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

function validateMemoryConstraints(
  workingMemory: ReadonlyArray<{ readonly label: string; readonly content: string }>,
): PreflightResult {
  if (workingMemory.length > MAX_WORKING_BLOCKS) {
    return {
      valid: false,
      reason: `working memory block count ${workingMemory.length} exceeds limit of ${MAX_WORKING_BLOCKS}`,
    };
  }

  for (const block of workingMemory) {
    if (!LABEL_PATTERN.test(block.label)) {
      return {
        valid: false,
        reason: `invalid memory block label "${block.label}": must match pattern ${LABEL_PATTERN.source}`,
      };
    }
    if (block.content.length > MAX_BLOCK_CONTENT_LENGTH) {
      return {
        valid: false,
        reason: `memory block "${block.label}" content length ${block.content.length} exceeds limit of ${MAX_BLOCK_CONTENT_LENGTH}`,
      };
    }
  }

  return { valid: true };
}

export type RestorationDependencies = {
  readonly persistence: PersistenceProvider;
  readonly memory: MemoryManager;
  readonly messageStore: MessageStore;
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
  const preflight = validateMemoryConstraints(checkpoint.workingMemory);
  if (!preflight.valid) {
    const error = new AgentError(
      'CHECKPOINT_FAILED',
      `pre-flight validation failed: ${preflight.reason}`,
      { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
    );
    traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
    throw error;
  }

  // ── Tier 1 + Tier 2: DB writes then memory writes, all inside transaction ──
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
    if (missingMessages.length > 0) {
      log(`checkpoint restore: ${missingMessages.length} messages no longer in conversation (likely compacted)`);
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
