// pattern: Functional Core

/**
 * Structured message builders for summarization LLM calls.
 * Replaces the old interpolation approach with proper role context via ModelRequest.system
 * and structured conversation messages.
 */

import type { Message, ModelRequest } from '../model/types.js';
import type { ConversationMessage } from '../agent/types.js';

export const DEFAULT_SYSTEM_PROMPT = `You are summarizing a conversation history to preserve essential context while compacting it. Create a concise narrative summary that maintains chronological order and preserves the causal chain of decisions.`;

export const DEFAULT_DIRECTIVE = `Summarize the conversation above. Follow these priorities:

PRESERVE: Decisions made and their rationale. Tool outcomes (successes and failures). User constraints and preferences explicitly stated. Causal chains explaining why decisions were made.

CONDENSE: Repetitive exchanges into single statements. Verbose tool output into key results. Conversational filler and acknowledgements.

PRIORITIZE: Recent context over older context. Actionable information over historical detail. Unresolved questions and pending tasks.

REMOVE: Greetings and small talk. Redundant confirmations. Formatting artifacts.

Output only the summary text as a flowing narrative, not bullet points.`;

export type BuildSummarizationRequestOptions = {
  readonly systemPrompt: string | null;
  readonly previousSummary: string | null;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly modelName: string;
  readonly maxTokens: number;
};

export function buildSummarizationRequest(
  options: BuildSummarizationRequestOptions,
): ModelRequest {
  const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const messages: Array<Message> = [];

  // Previous summary as system-role message (AC1.2, AC1.5)
  if (options.previousSummary) {
    messages.push({
      role: 'system',
      content: `Previous summary of conversation:\n${options.previousSummary}`,
    });
  }

  // Conversation messages with original roles preserved (AC1.3)
  for (const msg of options.messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    } else if (msg.role === 'tool') {
      // Tool messages become user messages with context
      messages.push({
        role: 'user',
        content: `[Tool result]: ${msg.content}`,
      });
    }
    // system messages in the conversation are intentionally skipped —
    // they are clip-archives injected by prior compaction cycles and their
    // content is already captured by the previousSummary parameter.
    // Any future role additions to ConversationMessage should be handled
    // explicitly here.
  }

  // Directive as final user message (AC1.4)
  messages.push({
    role: 'user',
    content: DEFAULT_DIRECTIVE,
  });

  return {
    system,
    messages,
    model: options.modelName,
    max_tokens: options.maxTokens,
    temperature: 0,
  };
}

export type BuildResummarizationRequestOptions = {
  readonly systemPrompt: string | null;
  readonly batchContents: ReadonlyArray<string>;
  readonly modelName: string;
  readonly maxTokens: number;
};

export function buildResummarizationRequest(
  options: BuildResummarizationRequestOptions,
): ModelRequest {
  const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const messages: Array<Message> = [];

  // Each batch as a system-role message providing context
  for (const batchContent of options.batchContents) {
    messages.push({
      role: 'system',
      content: `Summary batch:\n${batchContent}`,
    });
  }

  // Directive as final user message
  messages.push({
    role: 'user',
    content: DEFAULT_DIRECTIVE,
  });

  return {
    system,
    messages,
    model: options.modelName,
    max_tokens: options.maxTokens,
    temperature: 0,
  };
}
