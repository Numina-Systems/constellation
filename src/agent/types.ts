// pattern: Functional Core

/**
 * Agent types for the core agent loop.
 * These types define the agent's configuration, message format, dependencies,
 * and the public interface for the agent.
 */

import type { ModelProvider } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ToolRegistry } from '../tool/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { PersistenceProvider } from '../persistence/types.ts';

export type AgentConfig = {
  max_tool_rounds: number;
  context_budget: number;
  model_max_tokens?: number; // Model's context window size (default: 200000 for Claude 3 Sonnet)
  model_name?: string; // LLM model name (default: claude-3-sonnet-20250219)
  max_tokens?: number; // Token limit per request (default: 4096)
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  created_at: Date;
};

export type ExternalEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
};

export type Agent = {
  processMessage(userMessage: string): Promise<string>;
  processEvent(event: ExternalEvent): Promise<string>;
  getConversationHistory(): Promise<Array<ConversationMessage>>;
  conversationId: string;
};
