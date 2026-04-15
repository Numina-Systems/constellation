// pattern: Imperative Shell

import { buildIntrospectionEvent } from './introspection';
import type { ExternalEvent } from '@/agent/types';
import type { InterestRegistry } from './types';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';

type IntrospectionAssemblerDeps = {
  readonly persistence: PersistenceProvider;
  readonly interestRegistry: InterestRegistry;
  readonly memoryStore: MemoryStore;
  readonly owner: string;
  readonly subconsciousConversationId: string;
  readonly lookbackHours: number;
};

export type IntrospectionAssembler = {
  assembleIntrospection(): Promise<ExternalEvent>;
};

type ReviewMessage = {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly created_at: Date;
};

export function createIntrospectionAssembler(
  deps: Readonly<IntrospectionAssemblerDeps>,
): IntrospectionAssembler {
  async function fetchRecentMessages(): Promise<ReadonlyArray<ReviewMessage>> {
    const since = new Date(Date.now() - deps.lookbackHours * 3600_000);
    const rows = await deps.persistence.query<{
      role: string;
      content: string;
      created_at: Date;
    }>(
      `SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = $1
         AND role != 'tool'
         AND created_at >= $2
       ORDER BY created_at ASC`,
      [deps.subconsciousConversationId, since],
    );

    return rows.map((row) => ({
      role: row.role as ReviewMessage['role'],
      content: row.content,
      created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }));
  }

  async function fetchCurrentDigest(): Promise<string | null> {
    const block = await deps.memoryStore.getBlockByLabel(deps.owner, 'introspection-digest');
    return block?.content ?? null;
  }

  async function assembleIntrospection(): Promise<ExternalEvent> {
    const [messages, interests, currentDigest] = await Promise.all([
      fetchRecentMessages(),
      deps.interestRegistry.listInterests(deps.owner, { status: 'active' }),
      fetchCurrentDigest(),
    ]);

    return buildIntrospectionEvent({
      messages,
      interests,
      currentDigest,
      timestamp: new Date(),
    });
  }

  return { assembleIntrospection };
}
