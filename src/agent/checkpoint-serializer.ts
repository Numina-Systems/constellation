// pattern: Functional Core
import {
  SessionCheckpointV1Schema,
  SessionCheckpointV2Schema,
  CHECKPOINT_VERSION,
} from './checkpoint-types.ts';
import type {
  SessionCheckpointV2,
  AgentCheckpointState,
  CheckpointTrigger,
} from './checkpoint-types.ts';

export type SerializeCheckpointOptions = {
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly state: AgentCheckpointState;
  readonly createdAt: string;
};

/** Serialize only the current v2 representation; arrays are copied for immutability. */
export function serializeCheckpoint(options: SerializeCheckpointOptions): SessionCheckpointV2 {
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
    transcriptRevision: state.transcriptRevision ?? 0,
    activeArchiveIds: Array.from(state.activeArchiveIds ?? []),
    provenanceRefs: Array.from(state.provenanceRefs ?? []),
    createdAt,
  };
}

/**
 * Decode persisted data and migrate v1 explicitly. The returned value is always v2,
 * making provenance loss visible as empty refs rather than silently treating v1 as v2.
 */
export function deserializeCheckpoint(data: unknown): SessionCheckpointV2 {
  const v2 = SessionCheckpointV2Schema.safeParse(data);
  if (v2.success) return v2.data;

  const v1 = SessionCheckpointV1Schema.safeParse(data);
  if (v1.success) {
    return {
      ...v1.data,
      version: 2,
      transcriptRevision: 0,
      activeArchiveIds: [],
      provenanceRefs: [],
      migratedFromVersion: 1,
    };
  }

  const parsed = data as {version?: unknown} | null;
  if (parsed && typeof parsed === 'object' && parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(`checkpoint validation failed: version: unsupported checkpoint version ${String(parsed.version)}`);
  }
  const issues = [...v2.error.issues, ...v1.error.issues]
    .map(i => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  throw new Error(`checkpoint validation failed: ${issues}`);
}
