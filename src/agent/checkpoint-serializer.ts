// pattern: Functional Core

import {
  SessionCheckpointSchema,
  CHECKPOINT_VERSION,
} from './checkpoint-types.ts';
import type {
  SessionCheckpoint,
  AgentCheckpointState,
  CheckpointTrigger,
} from './checkpoint-types.ts';

/**
 * Serialization and deserialization for session checkpoints.
 * Pure functions for converting between agent state and persistent checkpoint format.
 */

export type SerializeCheckpointOptions = {
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly state: AgentCheckpointState;
  readonly createdAt: string;
};

export function serializeCheckpoint(options: SerializeCheckpointOptions): SessionCheckpoint {
  const {id, conversationId, owner, trigger, state, createdAt} = options;

  return {
    version: CHECKPOINT_VERSION,
    id,
    conversationId,
    owner,
    trigger,
    turnNumber: state.turnNumber,
    toolRound: state.toolRound,
    messageIds: Array.from(state.messageIds),
    workingMemory: Array.from(state.workingMemory),
    pendingPredictions: Array.from(state.pendingPredictions),
    activeInterests: Array.from(state.activeInterests),
    compactionMeta: state.compactionMeta,
    recallCache: state.recallCache,
    createdAt,
  };
}

export function deserializeCheckpoint(data: unknown): SessionCheckpoint {
  const result = SessionCheckpointSchema.safeParse(data);

  if (!result.success) {
    const formattedIssues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`checkpoint validation failed: ${formattedIssues}`);
  }

  return result.data;
}
