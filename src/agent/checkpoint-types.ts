// pattern: Functional Core
import {z} from 'zod';

/** Versioned checkpoint data used for crash recovery and explicit restore. */
export type CheckpointTrigger = 'explicit' | 'pre_compaction' | 'shutdown' | 'interval';

export type CheckpointWorkingMemory = {
  readonly label: string;
  readonly content: string;
};

export type CheckpointPrediction = {
  readonly id: string;
  readonly predictionText: string;
  readonly domain: string | null;
  readonly confidence: number | null;
  readonly createdAt: string;
};

export type CheckpointInterest = {
  readonly id: string;
  readonly name: string;
  readonly engagementScore: number;
  readonly status: 'active' | 'dormant' | 'abandoned';
  readonly lastEngagedAt: string;
};

export type CheckpointCompactionMeta = {
  readonly lastCompactedIndex: number;
  readonly summaryCount: number;
};

export type CheckpointRecallCache = {
  readonly decomposition: {
    readonly queries: ReadonlyArray<string>;
    readonly entities: ReadonlyArray<string>;
  } | null;
  readonly fragmentCount: number;
};

/** Minimal state supplied by the live agent to checkpoint creation. */
export type CheckpointAgentState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly transcriptRevision?: number;
  readonly activeArchiveIds?: ReadonlyArray<string>;
  readonly provenanceRefs?: ReadonlyArray<string>;
  readonly compactionMeta: CheckpointCompactionMeta;
};

export type AgentCheckpointState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly transcriptRevision?: number;
  readonly activeArchiveIds?: ReadonlyArray<string>;
  readonly provenanceRefs?: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<CheckpointWorkingMemory>;
  readonly pendingPredictions: ReadonlyArray<CheckpointPrediction>;
  readonly activeInterests: ReadonlyArray<CheckpointInterest>;
  readonly compactionMeta: CheckpointCompactionMeta;
  readonly recallCache: CheckpointRecallCache | null;
};

export type SessionCheckpointV1 = {
  readonly version: 1;
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<CheckpointWorkingMemory>;
  readonly pendingPredictions: ReadonlyArray<CheckpointPrediction>;
  readonly activeInterests: ReadonlyArray<CheckpointInterest>;
  readonly compactionMeta: CheckpointCompactionMeta;
  readonly recallCache: CheckpointRecallCache | null;
  readonly createdAt: string;
};

/** Current persisted checkpoint format. */
export type SessionCheckpointV2 = Omit<SessionCheckpointV1, 'version'> & {
  readonly version: 2;
  readonly transcriptRevision: number;
  readonly activeArchiveIds: ReadonlyArray<string>;
  readonly provenanceRefs: ReadonlyArray<string>;
  /** Present only when this v2 value was migrated from a legacy v1 wire record. */
  readonly migratedFromVersion?: 1;
};

/** v1 is accepted at typed restore boundaries; deserialization migrates it to v2. */
export type SessionCheckpoint = SessionCheckpointV1 | SessionCheckpointV2;

/** New writes always use the current version. */
export const CHECKPOINT_VERSION = 2 as const;

const CheckpointWorkingMemorySchema = z.object({
  label: z.string(),
  content: z.string(),
});

const CheckpointPredictionSchema = z.object({
  id: z.string(),
  predictionText: z.string(),
  domain: z.string().nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
});

const CheckpointInterestSchema = z.object({
  id: z.string(),
  name: z.string(),
  engagementScore: z.number(),
  status: z.enum(['active', 'dormant', 'abandoned']),
  lastEngagedAt: z.string(),
});

const CheckpointCompactionMetaSchema = z.object({
  lastCompactedIndex: z.number().int().nonnegative(),
  summaryCount: z.number().int().nonnegative(),
});

const CheckpointRecallCacheSchema = z.object({
  decomposition: z.object({
    queries: z.array(z.string()),
    entities: z.array(z.string()),
  }).nullable(),
  fragmentCount: z.number().int().nonnegative(),
}).nullable();

const commonCheckpointShape = {
  id: z.string().uuid(),
  conversationId: z.string().min(1),
  owner: z.string().min(1),
  trigger: z.enum(['explicit', 'pre_compaction', 'shutdown', 'interval']),
  turnNumber: z.number().int().nonnegative(),
  toolRound: z.number().int().nonnegative(),
  messageIds: z.array(z.string()),
  workingMemory: z.array(CheckpointWorkingMemorySchema),
  pendingPredictions: z.array(CheckpointPredictionSchema),
  activeInterests: z.array(CheckpointInterestSchema),
  compactionMeta: CheckpointCompactionMetaSchema,
  recallCache: CheckpointRecallCacheSchema,
  createdAt: z.string(),
} as const;

/** Legacy wire schema. It is intentionally retained only for migration. */
export const SessionCheckpointV1Schema = z.object({
  version: z.literal(1),
  ...commonCheckpointShape,
});

/** Current wire schema. Required v2 fields prevent silent projection loss. */
export const SessionCheckpointV2Schema = z.object({
  version: z.literal(2),
  ...commonCheckpointShape,
  transcriptRevision: z.number().int().nonnegative(),
  activeArchiveIds: z.array(z.string()),
  provenanceRefs: z.array(z.string()),
  migratedFromVersion: z.literal(1).optional(),
});

/** Union schema used by storage readers before the explicit migration step. */
export const SessionCheckpointSchema = z.discriminatedUnion('version', [
  SessionCheckpointV1Schema,
  SessionCheckpointV2Schema,
]);
