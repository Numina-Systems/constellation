// pattern: Functional Core

/**
 * Agent types for the core agent loop.
 * These types define the agent's configuration, message format, dependencies,
 * and the public interface for the agent.
 */

import type { ModelProvider } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ToolRegistry } from '../tool/types.ts';
import type { CodeRuntime, ExecutionContext } from '../runtime/types.ts';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { Compactor } from '../compaction/types.ts';
import type { TraceRecorder } from '../reflexion/types.ts';
import type { SkillRegistry } from '../skill/types.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { RecallContextState } from '../recall/index.js';
import type { SearchStore } from '../search/store.js';
import type { CheckpointTrigger, CheckpointAgentState } from './checkpoint-types.ts';
import type { LoopDetector } from '@/loop-detection/types.js';

export type AgentConfig = {
  max_tool_rounds: number;
  context_budget: number;
  model_max_tokens?: number; // Model's context window size (default: 200000 for Claude 3 Sonnet)
  model_name?: string; // LLM model name (default: claude-3-sonnet-20250219)
  max_tokens?: number; // Token limit per request (default: 24576)
  max_skills_per_turn?: number; // Maximum skills to include per turn (default: 3)
  skill_threshold?: number; // Minimum similarity threshold for skill inclusion (default: 0.3)
  recall_enabled?: boolean;
  recall_token_budget?: number;
  cache_diagnostics?: boolean;
  checkpoint_interval?: number;
  checkpoint_retention?: number;
  auto_resume?: boolean;
  resume_checkpoint?: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  reasoning_content?: string | null;
  created_at: Date;
};

export type ExternalEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type ContextProvider = () => string | undefined;

export type ProviderClassification = 'stable' | 'dynamic';

export type ClassifiedProvider = {
  readonly name: string;
  readonly provider: ContextProvider;
  readonly classification: ProviderClassification;
};

export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  embedding?: EmbeddingProvider;
  getExecutionContext?: () => ExecutionContext;
  compactor?: Compactor;
  traceRecorder?: TraceRecorder;
  owner?: string;
  contextProviders?: ReadonlyArray<ContextProvider>;
  classifiedProviders?: ReadonlyArray<ClassifiedProvider>;
  skills?: SkillRegistry;
  sourceInstructions?: ReadonlyMap<string, string>;
  recallContextState?: RecallContextState;
  searchStore?: SearchStore;
  summarizationModel?: ModelProvider;
  summarizationModelName?: string;
  checkpointFn?: (trigger: CheckpointTrigger) => Promise<string | null>;
  checkpointStateRef?: { current: CheckpointAgentState };
  loopDetector?: LoopDetector;
};

export type Agent = {
  processMessage(userMessage: string): Promise<string>;
  processEvent(event: ExternalEvent): Promise<string>;
  getConversationHistory(): Promise<Array<ConversationMessage>>;
  conversationId: string;
};
