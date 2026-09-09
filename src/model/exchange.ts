// pattern: Functional Core

import type {ContentBlock, Message, ToolResultBlock, ToolUseBlock} from "./types.js";

export type Exchange = {
  readonly messages: ReadonlyArray<Message>;
  readonly toolCallIds: ReadonlyArray<string>;
  readonly isCurrent: boolean;
};

export type ExchangeErrorCode = "duplicate_tool_result" | "orphan_tool_result" | "missing_tool_result" | "invalid_tool_batch";
export type ExchangeError = {readonly code: ExchangeErrorCode; readonly message: string; readonly toolUseId?: string};
export type ExchangeGroupingResult = {readonly ok: true; readonly exchanges: ReadonlyArray<Exchange>} | {readonly ok: false; readonly error: ExchangeError};

type IndexedMessage = {readonly message: Message; readonly index: number};

function blocks(message: Message, type: ContentBlock["type"]): Array<ContentBlock> {
  return typeof message.content === "string" ? [] : message.content.filter((block) => block.type === type);
}

function toolUseIds(message: Message): Array<string> {
  return blocks(message, "tool_use").map((block) => (block as ToolUseBlock).id);
}

function toolResultIds(message: Message): Array<string> {
  return blocks(message, "tool_result").map((block) => (block as ToolResultBlock).tool_use_id);
}

/** Groups assistant tool calls with exactly their correlated result messages. */
export function groupExchanges(messages: ReadonlyArray<Message>, currentMessage: Message | null = null): ExchangeGroupingResult {
  const consumed = new Set<string>();
  const exchanges: Array<Exchange> = [];
  const pending = new Map<string, IndexedMessage>();
  const seenResults = new Set<string>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const uses = toolUseIds(message);
    const results = toolResultIds(message);

    for (const id of results) {
      if (seenResults.has(id)) return {ok: false, error: {code: "duplicate_tool_result", message: `duplicate tool result for ${id}`, toolUseId: id}};
      seenResults.add(id);
      const owner = pending.get(id);
      if (!owner) return {ok: false, error: {code: "orphan_tool_result", message: `orphan tool result for ${id}`, toolUseId: id}};
      pending.delete(id);
      consumed.add(id);
      const ownerIndex = owner.index;
      const ownerMessage = messages[ownerIndex];
      if (!ownerMessage) return {ok: false, error: {code: "invalid_tool_batch", message: "tool-call batch disappeared while grouping"}};
      const existing = exchanges.find((exchange) => exchange.messages.includes(ownerMessage));
      if (existing && !existing.messages.includes(message)) {
        const replacement: Exchange = {messages: [...existing.messages, message], toolCallIds: existing.toolCallIds, isCurrent: existing.isCurrent || message === currentMessage};
        exchanges[exchanges.indexOf(existing)] = replacement;
      }
    }

    if (message.role === "assistant" && uses.length > 0) {
      if (new Set(uses).size !== uses.length || uses.some((id) => pending.has(id) || consumed.has(id))) return {ok: false, error: {code: "invalid_tool_batch", message: "duplicate tool call id in assistant batch"}};
      const exchange: Exchange = {messages: [message], toolCallIds: uses, isCurrent: message === currentMessage};
      exchanges.push(exchange);
      for (const id of uses) pending.set(id, {message, index});
    }
  }

  const missing = [...pending.keys()][0] ?? null;
  if (missing) return {ok: false, error: {code: "missing_tool_result", message: `missing tool result for ${missing}`, toolUseId: missing}};

  const grouped = new Set<Message>();
  const ordered: Array<Exchange> = [];
  for (const message of messages) {
    if (grouped.has(message)) continue;
    const exchange = exchanges.find((candidate) => candidate.messages.includes(message));
    if (exchange) {
      ordered.push(exchange);
      for (const member of exchange.messages) grouped.add(member);
    } else {
      ordered.push({messages: [message], toolCallIds: [], isCurrent: message === currentMessage});
      grouped.add(message);
    }
  }
  return {ok: true, exchanges: ordered};
}

/** Emergency shaping removes only complete older exchanges; current exchange is never removed. */
export function shapeExchanges(exchanges: ReadonlyArray<Exchange>, maxMessages: number): ReadonlyArray<Exchange> {
  if (maxMessages < 0) return [];
  const retained: Array<Exchange> = [];
  let count = 0;
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = exchanges[index];
    if (!exchange) continue;
    const size = exchange.messages.length;
    if (count + size <= maxMessages || exchange.isCurrent) {
      retained.unshift(exchange);
      count += size;
    }
  }
  return retained;
}
