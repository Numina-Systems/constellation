// pattern: Functional Core (barrel export)

export type { DataSource, IncomingMessage, OutgoingMessage } from './data-source.ts';
export type { Coordinator, CoordinationPattern, AgentRef, AgentResponse } from './coordinator.ts';
export type { Scheduler, ScheduledTask } from './scheduler.ts';
export type { ToolProvider } from './tool-provider.ts';
export type { BlueskyPostMetadata, BlueskyDataSource } from './bluesky/index.ts';
export { createBlueskySource } from './bluesky/index.ts';
export type { GameState, GameStateManager, SpaceMoltEvent } from './spacemolt/types.ts';
export type { SpaceMoltToolProviderOptions } from './spacemolt/tool-provider.ts';
export type { SpaceMoltSourceOptions } from './spacemolt/source.ts';
export type { SpaceMoltLifecycle, SpaceMoltLifecycleOptions } from './spacemolt/lifecycle.ts';
export type { EventTier } from './spacemolt/events.ts';
export {
  createSpaceMoltSource,
  createSpaceMoltToolProvider,
  createGameStateManager,
  createSpaceMoltLifecycle,
  seedSpaceMoltCapabilities,
  isHighPriority,
  cycleSpaceMoltTools,
  filterToolsByState,
} from './spacemolt/index.ts';
