/**
 * Tests for the Bluesky ambient context provider.
 * Verifies formatting, handle resolution with truncated-DID fallback, TTL
 * caching with stale-cache-on-error, and per-refresh retention pruning,
 * using a fake store, fake resolver, and injectable clock.
 */

import { describe, it, expect } from 'bun:test';
import { createBlueskyContextProvider } from './context-provider.ts';
import type { BlueskyEventStore, BlueskyStoredEvent } from './types.ts';

const OWNER = 'test-owner';
const AGENT_DID = 'did:plc:agent0000000000';
const AGENT_HANDLE = 'agent.example';

function makeStoredEvent(overrides: Partial<BlueskyStoredEvent> & { uri: string }): BlueskyStoredEvent {
  return {
    owner: OWNER,
    authorDid: 'did:plc:other000000000000',
    content: 'post content',
    replyParentUri: null,
    createdAt: new Date('2026-09-28T14:32:00Z'),
    indexedAt: new Date('2026-09-28T14:32:01Z'),
    ...overrides,
  };
}

function createFakeStore(events: ReadonlyArray<BlueskyStoredEvent> = []): {
  store: BlueskyEventStore;
  fetchCount: () => number;
  prunes: Array<Date>;
  failFetch: (error: Error) => void;
} {
  let fetchCount = 0;
  let fetchError: Error | null = null;
  const prunes: Array<Date> = [];
  const store: BlueskyEventStore = {
    async record() {
      throw new Error('record is not used by the provider');
    },
    async getRecentEvents(owner, limit) {
      if (fetchError) throw fetchError;
      fetchCount += 1;
      expect(owner).toBe(OWNER);
      return events.slice(0, limit);
    },
    async pruneEventsBefore(owner, cutoff) {
      expect(owner).toBe(OWNER);
      prunes.push(cutoff);
      return 0;
    },
  };
  return {
    store,
    fetchCount: () => fetchCount,
    prunes,
    failFetch: (error) => {
      fetchError = error;
    },
  };
}

function createHarness(overrides?: {
  events?: ReadonlyArray<BlueskyStoredEvent>;
  retentionDays?: number;
  resolveHandles?: (dids: ReadonlyArray<string>) => Promise<ReadonlyMap<string, string>>;
}) {
  const fake = createFakeStore(overrides?.events);
  let fakeNow = 1_000_000_000_000;
  const clock = () => fakeNow;
  const provider = createBlueskyContextProvider({
    store: fake.store,
    owner: OWNER,
    agentDid: AGENT_DID,
    agentHandle: AGENT_HANDLE,
    limit: 10,
    retentionDays: overrides?.retentionDays ?? 30,
    ...(overrides?.resolveHandles ? { resolveHandles: overrides.resolveHandles } : {}),
    now: clock,
  });
  return {
    provider,
    fake,
    advance: (ms: number) => {
      fakeNow += ms;
    },
    now: () => fakeNow,
  };
}

async function firstRefresh(harness: ReturnType<typeof createHarness>): Promise<string | undefined> {
  harness.provider();
  await Bun.sleep(1);
  return harness.provider();
}

describe('Bluesky context provider', () => {
  describe('AC4: formatting', () => {
    it('renders newest events with resolved handles, own-post and reply-to-you tags, and truncation', async () => {
      const longContent = `x`.repeat(250);
      const harness = createHarness({
        events: [
          makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' }),
          makeStoredEvent({
            uri: 'at://did:plc:agent0000000000/app.bsky.feed.post/2',
            authorDid: AGENT_DID,
            createdAt: new Date('2026-09-28T13:10:00Z'),
          }),
          makeStoredEvent({
            uri: 'at://did:plc:replier000000000/app.bsky.feed.post/3',
            authorDid: 'did:plc:replier000000000',
            content: longContent,
            replyParentUri: `at://${AGENT_DID}/app.bsky.feed.post/parent`,
          }),
        ],
        resolveHandles: async () =>
          new Map([
            ['did:plc:other000000000000', 'alice.example'],
            ['did:plc:replier000000000', 'bob.example'],
          ]),
      });

      const output = await firstRefresh(harness);

      expect(output).toBeDefined();
      expect(output).toContain('[Bluesky] Recent activity (3 newest posts):');
      expect(output).toContain('- 2026-09-28T14:32Z @alice.example: post content');
      expect(output).toContain(`- 2026-09-28T13:10Z @${AGENT_HANDLE} (you): post content`);
      expect(output!.split('\n').some((line) => line.startsWith(`- 2026-09-28T14:32Z @bob.example (reply to you): ${'x'.repeat(200)}…`))).toBe(true);
      // No unresolved raw DIDs leak into the rendered section.
      expect(output).not.toContain('did:plc:other');
    });

    it('collapses multi-line post content onto one line', async () => {
      const harness = createHarness({
        events: [makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1', content: 'line one\nline two\ttabbed' })],
        resolveHandles: async () => new Map([['did:plc:other000000000000', 'alice.example']]),
      });

      const output = await firstRefresh(harness);
      expect(output).toContain('@alice.example: line one line two tabbed');
    });

    it('returns undefined for an empty store', async () => {
      const harness = createHarness({ events: [] });

      const output = await firstRefresh(harness);
      expect(output).toBeUndefined();
    });

    it('falls back to a truncated DID when the resolver omits or fails a DID', async () => {
      const harness = createHarness({
        events: [
          makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' }),
          makeStoredEvent({
            uri: 'at://did:plc:unknown00000000/app.bsky.feed.post/2',
            authorDid: 'did:plc:unknown00000000',
            createdAt: new Date('2026-09-28T13:00:00Z'),
          }),
        ],
        // Resolver resolves nothing — every DID falls back.
        resolveHandles: async () => new Map(),
      });

      const output = await firstRefresh(harness);
      expect(output).toContain(`@did:plc:othe…0000:`);
      expect(output).toContain(`@did:plc:unkn…0000:`);
    });

    it('falls back to truncated DIDs when handle resolution throws', async () => {
      const warnings: Array<string> = [];
      const originalWarn = console.warn;
      console.warn = (...args: Array<unknown>) => {
        warnings.push(String(args[0]));
      };
      try {
        const harness = createHarness({
          events: [makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' })],
          resolveHandles: async () => {
            throw new Error('PDS unreachable');
          },
        });

        const output = await firstRefresh(harness);
        expect(output).toContain(`@did:plc:othe…0000:`);
        expect(warnings.some((warning) => warning.includes('handle resolution failed'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('never resolves the agent DID and renders own posts without a lookup', async () => {
      const resolved: Array<ReadonlyArray<string>> = [];
      const harness = createHarness({
        events: [makeStoredEvent({ uri: 'at://did:plc:agent0000000000/app.bsky.feed.post/1', authorDid: AGENT_DID })],
        resolveHandles: async (dids) => {
          resolved.push(dids);
          return new Map();
        },
      });

      const output = await firstRefresh(harness);
      expect(output).toContain(`@${AGENT_HANDLE} (you):`);
      // No other-author DIDs existed, so the resolver is never invoked.
      expect(resolved).toHaveLength(0);
    });
  });

  describe('AC4: TTL caching and failure retention', () => {
    it('does not re-fetch inside the 60s window and re-fetches after it', async () => {
      const harness = createHarness({ events: [makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' })] });

      harness.provider();
      await Bun.sleep(1);
      expect(harness.fake.fetchCount()).toBe(1);

      // Reads inside the TTL serve the cache.
      harness.provider();
      harness.advance(59_999);
      harness.provider();
      expect(harness.fake.fetchCount()).toBe(1);

      // Past the TTL the next read triggers a refresh.
      harness.advance(1);
      harness.provider();
      await Bun.sleep(1);
      expect(harness.fake.fetchCount()).toBe(2);
    });

    it('retains the last cached output when a refresh fails', async () => {
      const harness = createHarness({ events: [makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' })] });
      const first = await firstRefresh(harness);
      expect(first).toBeDefined();

      harness.fake.failFetch(new Error('database unavailable'));
      harness.advance(120_000);

      const warnings: Array<string> = [];
      const originalWarn = console.warn;
      console.warn = (...args: Array<unknown>) => {
        warnings.push(String(args[0]));
      };
      try {
        const stale = harness.provider();
        await Bun.sleep(1);
        expect(harness.provider()).toBe(first);
        expect(stale).toBe(first);
      } finally {
        console.warn = originalWarn;
      }
      expect(warnings.some((warning) => warning.includes('failed to refresh'))).toBe(true);
    });
  });

  describe('AC5: retention pruning', () => {
    it('prunes with the retention cutoff on each refresh outside the TTL', async () => {
      const harness = createHarness({
        events: [makeStoredEvent({ uri: 'at://did:plc:other000000000000/app.bsky.feed.post/1' })],
        retentionDays: 30,
      });
      const startTime = harness.now();

      harness.provider();
      await Bun.sleep(1);
      expect(harness.fake.prunes).toHaveLength(1);
      expect(harness.fake.prunes[0]!.getTime()).toBe(startTime - 30 * 86_400_000);

      // Inside the TTL: no further prune.
      harness.provider();
      expect(harness.fake.prunes).toHaveLength(1);

      // Outside the TTL: prune rides along with the next refresh.
      harness.advance(60_001);
      harness.provider();
      await Bun.sleep(1);
      expect(harness.fake.prunes).toHaveLength(2);
      expect(harness.fake.prunes[1]!.getTime()).toBe(startTime + 60_001 - 30 * 86_400_000);
    });
  });
});
