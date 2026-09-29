// pattern: Functional Core

import type { DataSource } from "../data-source.ts";

export type BlueskyPostMetadata = {
  readonly platform: "bluesky";
  readonly did: string;
  readonly handle: string;
  readonly uri: string;
  readonly cid: string;
  readonly rkey: string;
  readonly reply_to?: {
    readonly parent_uri: string;
    readonly parent_cid: string;
    readonly root_uri: string;
    readonly root_cid: string;
  };
};

export interface BlueskyDataSource extends DataSource {
  getAccessToken(): string;
  getRefreshToken(): string;
  getPdsUrl(): string;
  startSessionRefresh(intervalMs?: number): void;
  stopSessionRefresh(): void;
}

/**
 * A post observed on the Jetstream stream, to be persisted for ambient context.
 * `uri` is the AT-URI of the post record and doubles as the idempotency key.
 */
export type BlueskyEventRecord = {
  readonly uri: string;
  readonly owner: string;
  readonly authorDid: string;
  readonly content: string;
  readonly replyParentUri: string | null;
  readonly createdAt: Date;
};

export type BlueskyStoredEvent = BlueskyEventRecord & {
  readonly indexedAt: Date;
};

export interface BlueskyEventStore {
  /** Idempotent insert keyed by `uri`; redelivered events are a no-op. */
  record(event: BlueskyEventRecord): Promise<void>;
  /** Newest-first events for one owner, ordered by post time then ingestion. */
  getRecentEvents(owner: string, limit: number): Promise<ReadonlyArray<BlueskyStoredEvent>>;
  /** Delete events older than `cutoff` for one owner; returns the deleted count. */
  pruneEventsBefore(owner: string, cutoff: Date): Promise<number>;
}
