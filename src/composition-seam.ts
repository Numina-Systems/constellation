// pattern: Imperative Shell

import {createAgent as createAgentFactory} from '@/agent/agent.ts';
import type {Agent, AgentDependencies, ExternalEvent} from '@/agent/types.ts';
import type {Compactor, CompactorStatus} from '@/compaction/types.ts';
import type {SessionCheckpoint} from '@/agent/checkpoint-types.ts';
import type {RestorationDependencies, RestorationResult} from '@/agent/checkpoint-restore.ts';
import {restoreFromCheckpoint} from '@/agent/checkpoint-restore.ts';
import type {ActiveHistory, ConversationHistoryStore} from '@/persistence/conversation-history-store.ts';

export type StartupSelection = Readonly<{
  readonly mode: 'fresh' | 'auto_resume' | 'explicit_restore' | 'recovery_required';
  readonly conversationId: string;
  readonly history: ActiveHistory | null;
  readonly checkpoint: SessionCheckpoint | null;
  readonly recoveryReason: string | null;
}>;

export type CompositionSeam = {
  readonly createAgent: (dependencies: AgentDependencies, conversationId?: string) => Agent;
  readonly processMessage: (agent: Agent, message: string) => Promise<string>;
  readonly processEvent: (agent: Agent, event: ExternalEvent) => Promise<string>;
  readonly selectStartup: (options: {readonly conversationId: string; readonly historyStore: ConversationHistoryStore; readonly autoResume: boolean; readonly checkpoint?: SessionCheckpoint | null; readonly recovery?: Agent['getRecoveryState']}) => Promise<StartupSelection>;
  readonly restoreCheckpoint: (checkpoint: SessionCheckpoint, dependencies: RestorationDependencies) => Promise<RestorationResult>;
  readonly getCompactionStatus: (compactor: Compactor) => CompactorStatus | null;
  readonly resetCompactionBreaker: (compactor: Compactor) => void;
};

export function createCompositionSeam(): CompositionSeam {
  return {
    createAgent: (dependencies, conversationId) => {
      // Importing this seam only exposes factories; it does not load config, connect, or start the REPL.
      return createAgentFromDependencies(dependencies, conversationId);
    },
    processMessage: (agent, message) => agent.processMessage(message),
    processEvent: (agent, event) => agent.processEvent(event),
    selectStartup: async (options) => {
      const recovery = options.recovery ? await options.recovery() : null;
      if (recovery?.required) return {mode: 'recovery_required', conversationId: options.conversationId, history: null, checkpoint: null, recoveryReason: recovery.reason};
      const history = options.autoResume ? await options.historyStore.readActive(options.conversationId) : null;
      if (options.checkpoint) return {mode: 'explicit_restore', conversationId: options.conversationId, history, checkpoint: options.checkpoint, recoveryReason: null};
      return {mode: options.autoResume ? 'auto_resume' : 'fresh', conversationId: options.conversationId, history, checkpoint: null, recoveryReason: null};
    },
    restoreCheckpoint: (checkpoint, dependencies) => restoreFromCheckpoint(checkpoint, dependencies),
    getCompactionStatus: (compactor) => compactor.status ? compactor.status() : null,
    resetCompactionBreaker: (compactor) => {
      if (compactor.reset) compactor.reset();
    },
  };
}

function createAgentFromDependencies(dependencies: AgentDependencies, conversationId?: string): Agent {
  return createAgentFactory(dependencies, conversationId);
}
