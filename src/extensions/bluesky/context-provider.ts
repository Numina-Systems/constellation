// pattern: Imperative Shell

/**
 * Ambient Bluesky context provider. Surfaces the most recent persisted posts
 * (incoming and the agent's own) as a dynamic provider section so recent
 * Bluesky activity survives conversation compaction.
 *
 * Mirrors the activity provider's cached async refresh pattern: 60 s TTL,
 * single-flight refresh, and stale-cache-on-error. The output intentionally
 * carries no `##` header — the snapshot pipeline composes the section as
 * `## bluesky-activity`.
 */

import type { ContextProvider } from '../../agent/types.ts';
import type { BlueskyEventStore, BlueskyStoredEvent } from './types.ts';

export type BlueskyContextProviderDeps = {
  readonly store: BlueskyEventStore;
  readonly owner: string;
  readonly agentDid: string;
  /** Own handle from config; own posts never need a profile lookup. */
  readonly agentHandle: string;
  readonly limit: number;
  readonly retentionDays: number;
  /** Resolves author DIDs to handles; absent means always fall back to truncated DIDs. */
  readonly resolveHandles?: (dids: ReadonlyArray<string>) => Promise<ReadonlyMap<string, string>>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
};

const CACHE_TTL = 60_000; // 60 seconds, matching the activity provider
const CONTENT_TRUNCATE = 200;
const MS_PER_DAY = 86_400_000;

function truncateDid(did: string): string {
  if (did.length <= 16) return did;
  return `${did.slice(0, 12)}…${did.slice(-4)}`;
}

function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}

function formatContent(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > CONTENT_TRUNCATE
    ? `${collapsed.slice(0, CONTENT_TRUNCATE)}…`
    : collapsed;
}

function formatEvent(event: BlueskyStoredEvent, agentDid: string, agentHandle: string, handle: string): string {
  const isOwn = event.authorDid === agentDid;
  const isReplyToYou = event.replyParentUri !== null && event.replyParentUri.startsWith(`at://${agentDid}/`);

  const tags: Array<string> = [];
  if (isOwn) tags.push('you');
  if (isReplyToYou) tags.push('reply to you');
  const tagSuffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';

  const shownHandle = isOwn ? agentHandle : handle;
  return `- ${formatTimestamp(event.createdAt)} @${shownHandle}${tagSuffix}: ${formatContent(event.content)}`;
}

export function createBlueskyContextProvider(deps: BlueskyContextProviderDeps): ContextProvider {
  const now = deps.now ?? (() => Date.now());
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;

    // Retention prune rides along with each refresh; failures are non-fatal.
    const cutoff = new Date(now() - deps.retentionDays * MS_PER_DAY);
    deps.store
      .pruneEventsBefore(deps.owner, cutoff)
      .catch((error: unknown) => {
        console.warn('[bluesky] context provider: prune failed', error);
      });

    deps.store
      .getRecentEvents(deps.owner, deps.limit)
      .then(async (events): Promise<string | undefined> => {
        if (events.length === 0) return undefined;

        const distinctOtherDids = [...new Set(events.filter((event) => event.authorDid !== deps.agentDid).map((event) => event.authorDid))];
        let handles = new Map<string, string>();
        if (distinctOtherDids.length > 0 && deps.resolveHandles) {
          try {
            handles = new Map(await deps.resolveHandles(distinctOtherDids));
          } catch (error) {
            // Profile lookup is best-effort; every unresolved DID falls back
            // to a truncated DID below.
            console.warn('[bluesky] context provider: handle resolution failed', error);
          }
        }

        const lines = events.map((event) =>
          formatEvent(event, deps.agentDid, deps.agentHandle, handles.get(event.authorDid) ?? truncateDid(event.authorDid)),
        );
        return `[Bluesky] Recent activity (${events.length} newest posts):\n${lines.join('\n')}`;
      })
      .then((result) => {
        cached = { result, timestamp: now() };
      })
      .catch((error: unknown) => {
        // Keep the last cached value on refresh failure.
        console.warn('[bluesky] context provider: failed to refresh', error);
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return () => {
    if (!cached || now() - cached.timestamp >= CACHE_TTL) {
      refresh();
    }
    return cached?.result;
  };
}
