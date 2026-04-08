// pattern: Functional Core

/**
 * TUI module exports
 */

export type { AgentEvent, AgentEventBus, AgentEventType, AgentEventListener, AgentEventFilter, UsageStats, StopReason } from './types.ts';
export { createAgentEventBus } from './event-bus.ts';
export { useAgentEvents, useLatestAgentEvent } from './hooks/use-agent-events.ts';
export { renderApp } from './app.tsx';
export { createMutationPromptViaBus } from './mutation-bridge.ts';
export type { TuiDetectionResult } from './detect.ts';
export { detectTuiMode } from './detect.ts';
