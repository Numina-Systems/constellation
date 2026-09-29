import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import {createPostgresBlueskyEventStore} from './postgres-event-store.ts';
import type {BlueskyEventRecord} from './types.ts';

let database: TestDatabase | null = null;
let persistence: PersistenceProvider | null = null;

function requirePersistence(): PersistenceProvider {
  if (persistence === null) throw new Error('integration database was not initialized');
  return persistence;
}

function makeEvent(overrides: Partial<BlueskyEventRecord> & {uri: string}): BlueskyEventRecord {
  return {
    owner: overrides.owner ?? 'integration-agent',
    authorDid: overrides.authorDid ?? 'did:plc:author',
    content: overrides.content ?? 'post content',
    replyParentUri: overrides.replyParentUri ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-09-28T12:00:00.000Z'),
    ...overrides,
  };
}

describe('bluesky event store real PostgreSQL integration (required)', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    persistence = database.persistence;
  });

  afterEach(async () => {
    await requirePersistence().query('DELETE FROM bluesky_events');
  });

  afterAll(async () => {
    if (database !== null) await teardownTestDatabase(database);
  });

  it('record_then_read_back_newest_first_and_owner_scoped', async () => {
    const store = createPostgresBlueskyEventStore(requirePersistence());

    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/old', createdAt: new Date('2026-09-27T10:00:00.000Z')}));
    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/new', createdAt: new Date('2026-09-28T14:00:00.000Z')}));
    // Same post time, later ingestion sorts last within the tie.
    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/tie-1', createdAt: new Date('2026-09-28T14:00:00.000Z')}));
    // Different owner must never surface for integration-agent.
    await store.record(makeEvent({uri: 'at://did:plc:b/app.bsky.feed.post/other-owner', owner: 'other-agent'}));

    const events = await store.getRecentEvents('integration-agent', 10);

    expect(events.map((event) => event.uri)).toEqual([
      'at://did:plc:a/app.bsky.feed.post/tie-1',
      'at://did:plc:a/app.bsky.feed.post/new',
      'at://did:plc:a/app.bsky.feed.post/old',
    ]);

    const first = events[0]!;
    expect(first.owner).toBe('integration-agent');
    expect(first.authorDid).toBe('did:plc:author');
    expect(first.content).toBe('post content');
    expect(first.replyParentUri).toBeNull();
    expect(first.createdAt.toISOString()).toBe('2026-09-28T14:00:00.000Z');
    expect(first.indexedAt instanceof Date).toBe(true);
  });

  it('record_is_idempotent_per_uri', async () => {
    const store = createPostgresBlueskyEventStore(requirePersistence());
    const event = makeEvent({
      uri: 'at://did:plc:a/app.bsky.feed.post/dup',
      replyParentUri: 'at://did:plc:agent/app.bsky.feed.post/parent',
    });

    await store.record(event);
    // Redelivery after reconnect: same uri, must not duplicate or error.
    await store.record(event);

    const events = await store.getRecentEvents('integration-agent', 10);
    expect(events).toHaveLength(1);
    expect(events[0]!.uri).toBe('at://did:plc:a/app.bsky.feed.post/dup');
    expect(events[0]!.replyParentUri).toBe('at://did:plc:agent/app.bsky.feed.post/parent');
  });

  it('getRecent_events_respects_limit', async () => {
    const store = createPostgresBlueskyEventStore(requirePersistence());

    for (let i = 0; i < 5; i++) {
      await store.record(makeEvent({uri: `at://did:plc:a/app.bsky.feed.post/${i}`, createdAt: new Date(2026, 8, 20 + i)}));
    }

    const events = await store.getRecentEvents('integration-agent', 2);
    expect(events.map((event) => event.uri)).toEqual([
      'at://did:plc:a/app.bsky.feed.post/4',
      'at://did:plc:a/app.bsky.feed.post/3',
    ]);
  });

  it('prune_removes_only_older_rows_for_owner_and_returns_count', async () => {
    const store = createPostgresBlueskyEventStore(requirePersistence());
    const cutoff = new Date('2026-09-28T00:00:00.000Z');

    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/older', createdAt: new Date('2026-09-26T00:00:00.000Z')}));
    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/newer', createdAt: new Date('2026-09-28T12:00:00.000Z')}));
    // Old row belonging to another owner must survive the prune.
    await store.record(makeEvent({uri: 'at://did:plc:b/app.bsky.feed.post/other-owner-old', owner: 'other-agent', createdAt: new Date('2026-09-26T00:00:00.000Z')}));

    const deleted = await store.pruneEventsBefore('integration-agent', cutoff);
    expect(deleted).toBe(1);

    const remaining = await store.getRecentEvents('integration-agent', 10);
    expect(remaining.map((event) => event.uri)).toEqual(['at://did:plc:a/app.bsky.feed.post/newer']);

    const otherOwner = await store.getRecentEvents('other-agent', 10);
    expect(otherOwner.map((event) => event.uri)).toEqual(['at://did:plc:b/app.bsky.feed.post/other-owner-old']);
  });

  it('prune_returns_zero_when_nothing_matches', async () => {
    const store = createPostgresBlueskyEventStore(requirePersistence());
    await store.record(makeEvent({uri: 'at://did:plc:a/app.bsky.feed.post/new', createdAt: new Date('2026-09-28T12:00:00.000Z')}));

    const deleted = await store.pruneEventsBefore('integration-agent', new Date('2026-09-01T00:00:00.000Z'));
    expect(deleted).toBe(0);
  });
});
