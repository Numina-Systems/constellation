// pattern: Functional Core (types only)

import type { IncomingMessage } from './data-source.ts';

/**
 * Coordinator handles multi-agent routing and orchestration.
 * Determines which agent should handle an incoming message when multiple agents are available.
 *
 * Coordination patterns include:
 * - Supervisor: a lead agent delegates to specialists
 * - RoundRobin: rotate through agents sequentially
 * - Pipeline: chain agents in sequence
 * - Voting: multiple agents respond, consensus selects winner
 */
export type CoordinationPattern = 'supervisor' | 'round_robin' | 'pipeline' | 'voting';

export type AgentRef = {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ReadonlyArray<string>;
};

export type AgentResponse = {
  readonly agentId: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
};

export interface Coordinator {
  readonly pattern: CoordinationPattern;
  route(message: IncomingMessage, agents: ReadonlyArray<AgentRef>): Promise<AgentRef>;
  onAgentResponse?(agent: AgentRef, response: AgentResponse): Promise<void>;
}
