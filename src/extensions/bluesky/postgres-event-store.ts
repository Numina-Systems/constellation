// pattern: Imperative Shell

import type { PersistenceProvider } from '../../persistence/types.ts';
import type { BlueskyEventRecord, BlueskyEventStore, BlueskyStoredEvent } from './types.ts';

type BlueskyEventRow = {
  readonly uri: string;
  readonly owner: string;
  readonly author_did: string;
  readonly content: string;
  readonly reply_parent_uri: string | null;
  readonly created_at: Date;
  readonly indexed_at: Date;
};

function parseStoredEvent(row: BlueskyEventRow): BlueskyStoredEvent {
  return {
    uri: row.uri,
    owner: row.owner,
    authorDid: row.author_did,
    content: row.content,
    replyParentUri: row.reply_parent_uri,
    createdAt: row.created_at,
    indexedAt: row.indexed_at,
  };
}

export function createPostgresBlueskyEventStore(persistence: PersistenceProvider): BlueskyEventStore {
  return {
    async record(event: BlueskyEventRecord): Promise<void> {
      await persistence.query(
        `INSERT INTO bluesky_events (uri, owner, author_did, content, reply_parent_uri, created_at, indexed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (owner, uri) DO NOTHING`,
        [event.uri, event.owner, event.authorDid, event.content, event.replyParentUri, event.createdAt],
      );
    },

    async getRecentEvents(owner: string, limit: number): Promise<ReadonlyArray<BlueskyStoredEvent>> {
      const rows = await persistence.query<BlueskyEventRow>(
        `SELECT uri, owner, author_did, content, reply_parent_uri, created_at, indexed_at
         FROM bluesky_events
         WHERE owner = $1
         ORDER BY created_at DESC, indexed_at DESC
         LIMIT $2`,
        [owner, limit],
      );
      return rows.map(parseStoredEvent);
    },

    async pruneEventsBefore(owner: string, cutoff: Date): Promise<number> {
      const rows = await persistence.query<{ readonly uri: string }>(
        `DELETE FROM bluesky_events
         WHERE owner = $1 AND created_at < $2
         RETURNING uri`,
        [owner, cutoff],
      );
      return rows.length;
    },
  };
}
