// pattern: Functional Core

/**
 * Agent loop module exports
 */

export type {
  Agent,
  AgentConfig,
  AgentDependencies,
  ConversationMessage,
  ExternalEvent,
  ContextProvider,
  ProviderClassification,
  ClassifiedProvider,
} from './types.ts';
export { createAgent } from './agent.ts';
export {
  buildSystemPrompt,
  buildMessages,
  estimateTokens,
  estimateOverheadTokens,
  shouldCompress,
  truncateOldest,
} from './context.ts';
export { createSchedulingContextProvider } from './scheduling-context.ts';
export type { SnapshotMode, SnapshotResult, SnapshotState } from './snapshot.ts';
export { createSnapshotState } from './snapshot.ts';
export { buildUserMessage } from './messages.ts';
export type {
  CacheDiagnostics,
  CacheDimension,
  CacheBustEvent,
  SuppressionFlags,
  CheckForCacheBustOptions,
} from './cache-diagnostics.ts';
export { createCacheDiagnostics } from './cache-diagnostics.ts';
export type {
  SessionCheckpoint,
  CheckpointTrigger,
  CheckpointAgentState,
  AgentCheckpointState,
  CheckpointWorkingMemory,
  CheckpointPrediction,
  CheckpointInterest,
  CheckpointCompactionMeta,
  CheckpointRecallCache,
} from './checkpoint-types.ts';
export { SessionCheckpointSchema, CHECKPOINT_VERSION } from './checkpoint-types.ts';
export type { SerializeCheckpointOptions } from './checkpoint-serializer.ts';
export { serializeCheckpoint, deserializeCheckpoint } from './checkpoint-serializer.ts';
export type { CheckpointDependencies } from './checkpoint-create.ts';
export { performCheckpoint } from './checkpoint-create.ts';
export type { RestorationDependencies, RestorationResult } from './checkpoint-restore.ts';
export { restoreFromCheckpoint } from './checkpoint-restore.ts';
