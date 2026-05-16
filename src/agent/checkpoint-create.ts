// pattern: Imperative Shell

/**
 * Checkpoint creation helper.
 * Collects agent state from subsystem dependencies and delegates to serialization and storage.
 * Wrapped in try/catch so failures never block the agent loop (AC1.6).
 */

import {randomUUID} from 'node:crypto';
import {serializeCheckpoint} from './checkpoint-serializer.ts';
import type {
  CheckpointTrigger,
  CheckpointWorkingMemory,
  CheckpointPrediction,
  CheckpointInterest,
  AgentCheckpointState,
} from './checkpoint-types.ts';
import type {CheckpointStore} from '@/persistence/checkpoint-store.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {PredictionStore} from '@/reflexion/types.ts';
import type {InterestRegistry} from '@/subconscious/types.ts';
import type {RecallContextState} from '@/recall/context.ts';

export type CheckpointDependencies = {
  readonly checkpointStore: CheckpointStore;
  readonly memory: MemoryManager;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
  readonly owner: string;
  readonly conversationId: string;
  readonly retentionCount: number;
};

export type CheckpointAgentState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly compactionMeta: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
};

export async function performCheckpoint(
  trigger: CheckpointTrigger,
  agentState: CheckpointAgentState,
  deps: CheckpointDependencies,
): Promise<string | null> {
  try {
    // Collect working memory
    const workingMemoryBlocks = await deps.memory.list('working');
    const workingMemory: ReadonlyArray<CheckpointWorkingMemory> = workingMemoryBlocks.map(
      b => ({
        label: b.label,
        content: b.content,
      }),
    );

    // Collect pending predictions
    let pendingPredictions: ReadonlyArray<CheckpointPrediction> = [];
    if (deps.predictionStore) {
      const predictions = await deps.predictionStore.listPredictions(
        deps.owner,
        'pending',
      );
      pendingPredictions = predictions.map(p => ({
        id: p.id,
        predictionText: p.predictionText,
        domain: p.domain,
        confidence: p.confidence,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      }));
    }

    // Collect active interests
    let activeInterests: ReadonlyArray<CheckpointInterest> = [];
    if (deps.interestRegistry) {
      const interests = await deps.interestRegistry.listInterests(deps.owner, {
        status: 'active',
      });
      activeInterests = interests.map(i => ({
        id: i.id,
        name: i.name,
        engagementScore: i.engagementScore,
        status: i.status,
        lastEngagedAt: i.lastEngagedAt instanceof Date ? i.lastEngagedAt.toISOString() : i.lastEngagedAt,
      }));
    }

    // Collect recall cache
    let recallCache: {readonly decomposition: null; readonly fragmentCount: number} | null = null;
    if (deps.recallContextState) {
      const result = deps.recallContextState.getResult();
      if (result) {
        recallCache = {
          decomposition: null,
          fragmentCount: result.fragments.length,
        };
      }
    }

    // Build checkpoint state
    const checkpointState: AgentCheckpointState = {
      turnNumber: agentState.turnNumber,
      toolRound: agentState.toolRound,
      messageIds: agentState.messageIds,
      workingMemory,
      pendingPredictions,
      activeInterests,
      compactionMeta: agentState.compactionMeta,
      recallCache,
    };

    // Generate ID and timestamp
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Serialize checkpoint
    const checkpoint = serializeCheckpoint({
      id,
      conversationId: deps.conversationId,
      owner: deps.owner,
      trigger,
      state: checkpointState,
      createdAt,
    });

    // Save and prune
    await deps.checkpointStore.save(checkpoint);
    await deps.checkpointStore.prune(deps.conversationId, deps.retentionCount);

    return checkpoint.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[checkpoint] failed to create ${trigger} checkpoint: ${message}`);
    return null;
  }
}
