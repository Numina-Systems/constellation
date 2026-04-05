// pattern: Functional Core

import type { UsageStats, StopReason } from '@/model/types.ts';

/**
 * Event bus for TUI and agent integration.
 * Discriminated union of all event types that can be published.
 */

export type AgentEvent =
  | { type: 'stream:start'; model: string; turnIndex: number }
  | { type: 'stream:chunk'; text: string; turnIndex: number }
  | { type: 'stream:thinking'; text: string; turnIndex: number }
  | { type: 'stream:end'; usage: UsageStats; stopReason: StopReason }
  | { type: 'tool:start'; toolName: string; toolId: string; input: unknown }
  | { type: 'tool:result'; toolId: string; result: string; isError: boolean }
  | { type: 'turn:start'; source: 'user' | 'event' | 'scheduled' }
  | { type: 'turn:end'; messageCount: number }
  | { type: 'compaction:start' }
  | { type: 'compaction:end'; removedTokens: number }
  | { type: 'activity:wake'; reason: string }
  | { type: 'activity:sleep' }
  | { type: 'event:received'; source: string; summary: string }
  | { type: 'error'; error: Error; context: string }
  | {
      type: 'mutation:request';
      mutationId: string;
      blockId: string;
      proposedContent: string;
      reason: string | null;
    }
  | { type: 'mutation:response'; mutationId: string; approved: boolean; feedback?: string };

export type AgentEventType = AgentEvent['type'];
export type AgentEventListener = (event: AgentEvent) => void;
export type AgentEventFilter = (event: AgentEvent) => boolean;

/**
 * Event bus interface for publishing and subscribing to agent events.
 */
export type AgentEventBus = {
  publish(event: AgentEvent): void;
  subscribe(listener: AgentEventListener, filter?: AgentEventFilter): () => void;
  clear(): void;
};

// Re-export types from model
export type { UsageStats, StopReason } from '@/model/types.ts';
