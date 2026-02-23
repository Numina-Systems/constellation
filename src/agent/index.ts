// pattern: Functional Core

/**
 * Agent loop module exports
 */

export type { Agent, AgentConfig, AgentDependencies, ConversationMessage } from './types.ts';
export { createAgent } from './agent.ts';
export {
  buildSystemPrompt,
  buildMessages,
  estimateTokens,
  shouldCompress,
} from './context.ts';
