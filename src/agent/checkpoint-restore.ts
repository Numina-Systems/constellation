// pattern: Imperative Shell

/**
 * Checkpoint restoration function.
 * Reads a checkpoint from the store and replays state into the agent's subsystems.
 * Integrated into the composition root startup sequence, before the agent loop begins.
 */

import type {SessionCheckpoint} from './checkpoint-types.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {PredictionStore} from '@/reflexion/types.ts';
import type {InterestRegistry} from '@/subconscious/types.ts';
import type {RecallContextState} from '@/recall/context.ts';

export type RestorationDependencies = {
  readonly persistence: PersistenceProvider;
  readonly memory: MemoryManager;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
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
  const logWarning = deps.log ?? console.warn;

  // AC3.6: Verify conversation exists
  const countResult = await deps.persistence.query<{readonly count: number}>(
    'SELECT COUNT(*)::int as count FROM messages WHERE conversation_id = $1',
    [checkpoint.conversationId],
  );

  const messageCount = countResult[0]?.count ?? 0;

  if (messageCount === 0 && checkpoint.messageIds.length > 0) {
    throw new Error(
      `cannot restore checkpoint ${checkpoint.id}: conversation ${checkpoint.conversationId} has no messages (deleted or missing)`,
    );
  }

  // AC3.1: Verify message coverage (log warning if some are missing)
  if (checkpoint.messageIds.length > 0) {
    const existingMessages = await deps.persistence.query<{readonly id: string}>(
      'SELECT id FROM messages WHERE conversation_id = $1',
      [checkpoint.conversationId],
    );

    const existingIds = new Set(existingMessages.map(m => m.id));
    const missingIds = checkpoint.messageIds.filter(id => !existingIds.has(id));

    if (missingIds.length > 0) {
      logWarning(
        `[checkpoint] ${missingIds.length} message(s) from checkpoint are missing from conversation ${checkpoint.conversationId} (may have been pruned by compaction)`,
      );
    }
  }

  // AC3.2: Restore working memory
  const currentWorkingBlocks = await deps.memory.list('working');

  // Update or create blocks from checkpoint
  for (const block of checkpoint.workingMemory) {
    await deps.memory.write(block.label, block.content, 'working');
  }

  // Delete blocks that existed in current state but not in checkpoint
  const checkpointLabels = new Set(checkpoint.workingMemory.map(b => b.label));
  for (const currentBlock of currentWorkingBlocks) {
    if (!checkpointLabels.has(currentBlock.label)) {
      await deps.memory.deleteBlock(currentBlock.id);
    }
  }

  // AC3.3: Verify pending predictions (log any discrepancies)
  if (deps.predictionStore) {
    const dbPredictions = await deps.predictionStore.listPredictions(deps.owner, 'pending');
    const dbPredictionIds = new Set(dbPredictions.map(p => p.id));

    const missingPredictionIds = checkpoint.pendingPredictions
      .map(p => p.id)
      .filter(id => !dbPredictionIds.has(id));

    if (missingPredictionIds.length > 0) {
      logWarning(
        `[checkpoint] ${missingPredictionIds.length} pending prediction(s) from checkpoint are no longer in database (may have been evaluated or expired)`,
      );
    }
  }

  // AC3.4: Restore active interests
  if (deps.interestRegistry) {
    const dbInterests = await deps.interestRegistry.listInterests(deps.owner);
    const dbInterestsById = new Map(dbInterests.map(i => [i.id, i]));

    for (const checkpointInterest of checkpoint.activeInterests) {
      const dbInterest = dbInterestsById.get(checkpointInterest.id);
      if (dbInterest) {
        // Restore engagement score to checkpoint value if different
        if (dbInterest.engagementScore !== checkpointInterest.engagementScore) {
          await deps.interestRegistry.updateInterest(checkpointInterest.id, {
            engagementScore: checkpointInterest.engagementScore,
          });
        }
      } else {
        logWarning(
          `[checkpoint] interest ${checkpointInterest.id} from checkpoint no longer exists in database`,
        );
      }
    }
  }

  // AC3.7 (idempotency): recall cache is just cleared, no state to restore
  // AC3.5: Clear recall cache (it will be rebuilt on next turn)
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
}
