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
export type { CacheDiagnostics, CacheDimension, CacheBustEvent, SuppressionFlags } from './cache-diagnostics.ts';
export { createCacheDiagnostics } from './cache-diagnostics.ts';
