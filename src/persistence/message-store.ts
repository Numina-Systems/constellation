// pattern: Functional Core

import type { ConversationMessage } from '@/agent/types.ts';
import type { PersistenceProvider } from './types.ts';

export type MessageStore = {
  count(conversationId: string): Promise<number>;
  listIds(conversationId: string): Promise<Array<string>>;
  getLatest(conversationId: string, limit: number): Promise<Array<ConversationMessage>>;
};

type MessageRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: string;
  readonly content: string;
  readonly tool_calls: unknown;
  readonly tool_call_id: string | null;
  readonly reasoning_content: string | null;
  readonly created_at: Date;
};

function parseMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role as ConversationMessage['role'],
    content: row.content,
    tool_calls: row.tool_calls ?? undefined,
    tool_call_id: row.tool_call_id ?? undefined,
    reasoning_content: row.reasoning_content,
    created_at: row.created_at,
  };
}

export function createMessageStore(
  persistence: PersistenceProvider,
): MessageStore {
  async function count(conversationId: string): Promise<number> {
    const rows = await persistence.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM messages WHERE conversation_id = $1',
      [conversationId],
    );

    // count() always returns exactly one row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return rows[0]!.count;
  }

  async function listIds(conversationId: string): Promise<Array<string>> {
    const rows = await persistence.query<{ id: string }>(
      'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId],
    );

    return rows.map(row => row.id);
  }

  async function getLatest(
    conversationId: string,
    limit: number,
  ): Promise<Array<ConversationMessage>> {
    const rows = await persistence.query<MessageRow>(
      `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit],
    );

    return rows.map(parseMessage);
  }

  return {
    count,
    listIds,
    getLatest,
  };
}
