// pattern: Functional Core

import type {ConversationMessage} from '@/agent/types.ts';

export type Continuation = Readonly<{
  readonly objective: string;
  readonly explicitConstraints: ReadonlyArray<string>;
  readonly recentToolStatus: ReadonlyArray<string>;
  readonly outstandingWork: ReadonlyArray<string>;
  readonly text: string;
}>;

function toolStatus(message: Readonly<ConversationMessage>): string | null {
  if (message.role !== 'tool') return null;
  const status = message.tool_outcome?.kind ?? 'legacy_unknown';
  const code = message.tool_outcome?.kind === 'success' ? '' : `/${message.tool_outcome?.code ?? 'unknown'}`;
  return `call ${message.tool_call_id ?? 'unknown'}: ${status}${code}`;
}

function explicitConstraint(text: string): boolean {
  return /\b(?:must|shall|required|constraint|cannot|don't|do not|never|only)\b/i.test(text);
}

function objectiveMessage(history: ReadonlyArray<ConversationMessage>): ConversationMessage | null {
  return [...history].reverse().find((message) => message.role === 'user') ?? null;
}

/** Derives bounded continuation only from explicit transcript evidence. */
export function deriveContinuation(
  history: ReadonlyArray<ConversationMessage>,
  maxChars = 2000,
): Continuation {
  const objective = objectiveMessage(history)?.content.trim() ?? '';
  const constraints = history.filter((message) => message.role === 'user' && explicitConstraint(message.content))
    .map((message) => message.content.trim()).filter(Boolean).slice(-4);
  const statuses = history.map(toolStatus).filter((status): status is string => status !== null).slice(-6);
  const outstanding = history.filter((message) => message.role === 'user' && /\b(?:todo|pending|outstanding|follow[- ]?up|next)\b/i.test(message.content))
    .map((message) => message.content.trim()).filter(Boolean).slice(-3);
  const lines = [
    objective ? `Current objective (original): ${objective}` : '',
    constraints.length > 0 ? `Explicit constraints (original): ${constraints.join(' | ')}` : '',
    statuses.length > 0 ? `Recent correlated tool status: ${statuses.join(' | ')}` : '',
    outstanding.length > 0 ? `Structurally known outstanding work: ${outstanding.join(' | ')}` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  return {
    objective,
    explicitConstraints: constraints,
    recentToolStatus: statuses,
    outstandingWork: outstanding,
    text: text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 25))}… [continuation omitted]`,
  };
}
