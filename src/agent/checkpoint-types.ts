// pattern: Functional Core

import {z} from 'zod';

/**
 * Checkpoint types for session persistence.
 * Defines the structure of session snapshots that capture agent state at a point in time.
 */

export type CheckpointTrigger = 'explicit' | 'pre_compaction' | 'shutdown' | 'interval';

/**
 * Minimal agent runtime state that the agent loop tracks and passes to checkpoint creation.
 * The checkpoint creation helper collects subsystem data (memory, predictions, interests, recall)
 * and combines with this minimal state to build the full AgentCheckpointState for serialization.
 */
export type CheckpointAgentState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly compactionMeta: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
};

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

export type SessionCheckpoint = {
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

export type AgentCheckpointState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<CheckpointWorkingMemory>;
  readonly pendingPredictions: ReadonlyArray<CheckpointPrediction>;
  readonly activeInterests: ReadonlyArray<CheckpointInterest>;
  readonly compactionMeta: CheckpointCompactionMeta;
  readonly recallCache: CheckpointRecallCache | null;
};

export const CHECKPOINT_VERSION = 1 as const;

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

export const SessionCheckpointSchema = z.object({
  version: z.literal(1),
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
});
