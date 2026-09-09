// pattern: Functional Core

import type {ConversationMessage} from '@/agent/types.ts';
import {scoreMessage} from './scoring.ts';
import type {ImportanceScoringConfig} from './types.ts';

export type ExchangeGroup = Readonly<{
  readonly index: number;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly score: number;
  readonly isCurrent: boolean;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly toolCallIds: ReadonlyArray<string>;
}>;

export type ProjectedExchange = Readonly<{
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly sourceMessageIds: ReadonlyArray<string>;
  readonly omitted: ReadonlyArray<string>;
}>;

export type GroupingResult = Readonly<{
  readonly groups: ReadonlyArray<ExchangeGroup>;
  readonly error: string | null;
}>;

type ToolCall = Readonly<{id?: unknown; name?: unknown; input?: unknown}>;

function toolCalls(message: Readonly<ConversationMessage>): ReadonlyArray<ToolCall> {
  if (!Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.filter((call): call is ToolCall => typeof call === 'object' && call !== null);
}

function callIds(message: Readonly<ConversationMessage>): ReadonlyArray<string> {
  return toolCalls(message).flatMap((call) => typeof call.id === 'string' ? [call.id] : []);
}

function minTime(messages: ReadonlyArray<ConversationMessage>): Date {
  return new Date(Math.min(...messages.map((message) => message.created_at.getTime())));
}

function maxTime(messages: ReadonlyArray<ConversationMessage>): Date {
  return new Date(Math.max(...messages.map((message) => message.created_at.getTime())));
}

/** Groups assistant tool calls with their correlated results without timestamp sorting. */
export function groupConversationExchanges(
  history: ReadonlyArray<ConversationMessage>,
  currentMessageId: string | null = null,
  scoringConfig?: Readonly<ImportanceScoringConfig>,
): GroupingResult {
  const groups: Array<ExchangeGroup> = [];
  const owners = new Map<string, number>();
  const consumedResults = new Set<string>();

  for (const message of history) {
    const ids = callIds(message);
    if (message.role === 'tool') {
      const callId = message.tool_call_id;
      if (!callId) return {groups: [], error: 'tool result is missing its call id'};
      if (consumedResults.has(callId)) return {groups: [], error: `duplicate tool result for ${callId}`};
      const ownerIndex = owners.get(callId);
      if (ownerIndex === undefined) return {groups: [], error: `orphan tool result for ${callId}`};
      const owner = groups[ownerIndex];
      if (!owner) return {groups: [], error: 'tool-call owner disappeared while grouping'};
      consumedResults.add(callId);
      groups[ownerIndex] = {
        ...owner,
        messages: [...owner.messages, message],
        startTime: minTime([...owner.messages, message]),
        endTime: maxTime([...owner.messages, message]),
        isCurrent: owner.isCurrent || message.id === currentMessageId,
      };
      continue;
    }

    const group: ExchangeGroup = {
      index: groups.length,
      messages: [message],
      score: scoreMessage(message, groups.length, history.length, scoringConfig),
      isCurrent: message.id === currentMessageId,
      startTime: message.created_at,
      endTime: message.created_at,
      toolCallIds: ids,
    };
    groups.push(group);
    for (const id of ids) {
      if (owners.has(id)) return {groups: [], error: `duplicate tool call id ${id}`};
      owners.set(id, groups.length - 1);
    }
  }

  for (const [id] of owners) {
    if (!consumedResults.has(id)) return {groups: [], error: `missing tool result for ${id}`};
  }
  return {groups, error: null};
}

/** Returns complete groups in stable transcript order, protecting the recent suffix. */
export function selectCompactionGroups(
  groups: ReadonlyArray<ExchangeGroup>,
  keepRecentMessages: number,
): Readonly<{source: ReadonlyArray<ExchangeGroup>; keep: ReadonlyArray<ExchangeGroup>}> {
  const protectedCount = Math.max(0, keepRecentMessages);
  let suffixCount = 0;
  let split = groups.length;
  while (split > 0 && suffixCount < protectedCount) {
    const group = groups[split - 1];
    if (!group) break;
    suffixCount += group.messages.length;
    split -= 1;
  }
  return {source: groups.slice(0, split), keep: groups.slice(split)};
}

function boundedJson(value: unknown, maxChars: number): Readonly<{text: string; omitted: boolean}> {
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'null';
  } catch {
    return {text: '[omitted: unserializable arguments]', omitted: true};
  }
  if (text.length <= maxChars) return {text, omitted: false};
  return {text: `${text.slice(0, Math.max(0, maxChars - 25))}… [omitted: arguments]`, omitted: true};
}

function projectionContent(message: Readonly<ConversationMessage>): Readonly<{text: string; omitted: ReadonlyArray<string>}> {
  const omitted: Array<string> = [];
  if (message.role === 'assistant' && toolCalls(message).length > 0) {
    const calls = toolCalls(message).map((call) => {
      const id = typeof call.id === 'string' ? call.id : '[omitted: call id]';
      const name = typeof call.name === 'string' ? call.name : '[omitted: call name]';
      const args = boundedJson(call.input, 768);
      if (args.omitted) omitted.push(`${id}:arguments`);
      return `${id} ${name} args=${args.text}`;
    });
    return {text: `[assistant tool calls at ${message.created_at.toISOString()}]\n${calls.join('\n')}\n${message.content}`, omitted};
  }
  if (message.role === 'tool') {
    const outcome = message.tool_outcome;
    const status = outcome?.kind ?? 'legacy_unknown';
    return {text: `[tool result ${message.tool_call_id ?? '[omitted: call id]'} status=${status} at ${message.created_at.toISOString()}]\n${message.content}`, omitted};
  }
  return {text: `[${message.role} at ${message.created_at.toISOString()}]\n${message.content}`, omitted};
}

/** Projects a group for prompting while retaining complete source IDs for durable provenance. */
export function projectExchangeGroup(
  group: Readonly<ExchangeGroup>,
  maxMessages: number,
): ProjectedExchange {
  const limit = Math.max(1, maxMessages);
  const selected = group.messages.slice(0, limit);
  const omitted: Array<string> = [];
  const messages = selected.map((message) => {
    const projection = projectionContent(message);
    omitted.push(...projection.omitted);
    return {...message, content: projection.text};
  });
  if (group.messages.length > selected.length) omitted.push('messages');
  return {
    messages,
    sourceMessageIds: group.messages.map((message) => message.id),
    omitted,
  };
}

/** Sorts selected groups by importance for selection, then restores durable transcript order. */
export function orderSelectedGroups(
  groups: ReadonlyArray<ExchangeGroup>,
  maxGroups: number,
): ReadonlyArray<ExchangeGroup> {
  const ranked = [...groups].sort((left, right) => left.score - right.score || left.index - right.index);
  const selected = new Set(ranked.slice(0, Math.max(0, maxGroups)).map((group) => group.index));
  return groups.filter((group) => selected.has(group.index));
}
