// pattern: Imperative Shell

import type {ConversationMessage} from '@/agent/types.ts';
import type {PersistenceProvider} from './types.ts';
import {createConversationHistoryStore, type ConversationHistoryStore} from './conversation-history-store.ts';

export type MessageStore = {
  count(conversationId: string): Promise<number>;
  listIds(conversationId: string): Promise<Array<string>>;
  /** Returns the N most recent active messages, ordered most-recent-first (DESC). */
  getLatest(conversationId: string, limit: number): Promise<Array<ConversationMessage>>;
};

export function createMessageStore(
  persistence: PersistenceProvider,
  history: ConversationHistoryStore = createConversationHistoryStore(persistence),
): MessageStore {
  async function count(conversationId: string): Promise<number> {
    const active = await history.readActive(conversationId);
    return active.messages.length;
  }

  async function listIds(conversationId: string): Promise<Array<string>> {
    const active = await history.readActive(conversationId);
    return active.messages.map((message) => message.id);
  }

  async function getLatest(
    conversationId: string,
    limit: number,
  ): Promise<Array<ConversationMessage>> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('message limit must be a positive integer');
    const active = await history.readActive(conversationId);
    return active.messages.slice(-limit).reverse();
  }

  return {count, listIds, getLatest};
}
