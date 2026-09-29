// pattern: Imperative Shell

import type { BskyAgent } from "@atproto/api";
import { JetstreamSubscription } from "@atcute/jetstream";
import type { CommitEvent } from "@atcute/jetstream";
import type { IncomingMessage } from "../data-source.ts";
import type { BlueskyConfig } from "@/config/schema.ts";
import type { BlueskyDataSource, BlueskyPostMetadata, BlueskyEventStore } from "./types.ts";

type EventRecord = {
  text?: string;
  reply?: {
    parent: { uri: string; cid: string };
    root: { uri: string; cid: string };
  };
};

export function shouldAcceptEvent(
  event: CommitEvent,
  watchedDids: ReadonlySet<string>,
  agentDid: string,
  scheduleDids?: ReadonlySet<string>,
): boolean {
  const commit = event.commit;

  if (commit.operation !== "create") {
    return false;
  }

  const did = event.did;
  const record = commit.record as EventRecord;

  // Accept if author DID is in watched_dids set
  if (watchedDids.has(did)) {
    return true;
  }

  // Accept if author DID is in schedule_dids set
  if (scheduleDids?.has(did)) {
    return true;
  }

  // Accept if post is a reply where the parent URI starts with at://<agent_did>/
  if (record.reply?.parent?.uri) {
    const parentUri = record.reply.parent.uri;
    if (parentUri.startsWith(`at://${agentDid}/`)) {
      return true;
    }
  }

  return false;
}

export type HandleCommitEventDeps = {
  readonly watchedDids: ReadonlySet<string>;
  readonly scheduleDids?: ReadonlySet<string>;
  readonly agentDid: string;
  readonly owner: string;
  readonly eventStore?: BlueskyEventStore;
  readonly dispatch: (message: IncomingMessage) => void;
};

/**
 * Per-event accept/record/dispatch decision for one Jetstream commit event.
 * Own posts take the record-only branch first and it is terminal for them:
 * it alone decides record and dispatch, so the accepted-event path below can
 * never double-record an own post or dispatch a self-thread reply back into
 * the agent. Non-create own commits (delete/update) carry no usable record
 * payload and are ignored entirely — building a message from one would throw
 * inside the subscription loop and permanently kill ingestion.
 */
// pattern: Functional Core
export function handleCommitEvent(event: CommitEvent, deps: HandleCommitEventDeps): void {
  if (event.did === deps.agentDid) {
    const commit = event.commit;
    if (commit.operation !== "create") {
      return;
    }

    recordEvent(event, deps);

    // Loop prevention: an own post replying to the agent's own post must not
    // re-enter the agent as a fresh incoming message. Dispatch only when the
    // agent explicitly watches its own DID, preserving existing semantics
    // for that configuration.
    if (deps.watchedDids.has(deps.agentDid)) {
      deps.dispatch(toIncomingMessage(event));
    }
    return;
  }

  if (!shouldAcceptEvent(event, deps.watchedDids, deps.agentDid, deps.scheduleDids)) {
    return;
  }

  // Redundant defensive check: shouldAcceptEvent already verifies create.
  // Guards message construction if that filter logic ever changes.
  if (event.commit.operation !== "create") {
    return;
  }

  const message = toIncomingMessage(event);
  recordEvent(event, deps);
  deps.dispatch(message);
}

function toIncomingMessage(commitEvent: CommitEvent): IncomingMessage {
  const commit = commitEvent.commit;
  if (commit.operation !== "create") {
    throw new Error("cannot build an incoming message from a non-create commit");
  }

  const record = commit.record as EventRecord;

  const replyTo =
    record.reply?.parent?.uri && record.reply?.root?.uri
      ? {
          parent_uri: record.reply.parent.uri,
          parent_cid: record.reply.parent.cid,
          root_uri: record.reply.root.uri,
          root_cid: record.reply.root.cid,
        }
      : undefined;

  const metadata: BlueskyPostMetadata = {
    platform: "bluesky",
    did: commitEvent.did,
    handle: commitEvent.did,
    uri: `at://${commitEvent.did}/app.bsky.feed.post/${commit.rkey}`,
    cid: commit.cid,
    rkey: commit.rkey,
    ...(replyTo && { reply_to: replyTo }),
  };

  return {
    source: "bluesky",
    content: record.text || "",
    metadata,
    timestamp: new Date(),
  };
}

/** Fire-and-forget persistence; a slow or failing store must never stall the loop or block dispatch. */
function recordEvent(event: CommitEvent, deps: Pick<HandleCommitEventDeps, "owner" | "eventStore">): void {
  const store = deps.eventStore;
  if (!store) return;

  const commit = event.commit;
  if (commit.operation !== "create") return;

  const record = commit.record as EventRecord;
  const createdAt =
    event.time_us && event.time_us > 0 ? new Date(event.time_us / 1000) : new Date();

  store
    .record({
      uri: `at://${event.did}/app.bsky.feed.post/${commit.rkey}`,
      owner: deps.owner,
      authorDid: event.did,
      content: record.text ?? "",
      replyParentUri: record.reply?.parent?.uri ?? null,
      createdAt,
    })
    .catch((error: unknown) => {
      console.warn("[bluesky] event store record failed:", error);
    });
}

const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function createBlueskySource(
  config: BlueskyConfig,
  agent: BskyAgent,
  deps?: { owner: string; eventStore: BlueskyEventStore },
): BlueskyDataSource {
  let subscription: JetstreamSubscription | null = null;
  let subscriptionIterator: AsyncIterator<unknown> | null = null;
  let messageHandler: ((message: IncomingMessage) => void) | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const watchedDids = new Set(config.watched_dids);
  const scheduleDids = new Set(config.schedule_dids);
  const owner = deps?.owner ?? "";
  const eventStore = deps?.eventStore;

  async function refreshSession(): Promise<void> {
    try {
      await agent.sessionManager.refreshSession();
      console.log("[bluesky] session refreshed");
    } catch (refreshError) {
      console.error("[bluesky] session refresh failed, attempting re-login:", refreshError);
      try {
        await agent.login({
          identifier: config.handle!,
          password: config.app_password!,
        });
        console.log("[bluesky] re-login successful");
      } catch (loginError) {
        console.error("[bluesky] re-login failed:", loginError);
      }
    }
  }

  const adapter: BlueskyDataSource = {
    name: "bluesky",

    async connect(): Promise<void> {
      if (!config.handle || !config.app_password || !config.did) {
        throw new Error("bluesky config requires handle, app_password, and did");
      }

      const agentDid = config.did;

      await agent.login({
        identifier: config.handle,
        password: config.app_password,
      });

      subscription = new JetstreamSubscription({
        url: config.jetstream_url,
        wantedCollections: ["app.bsky.feed.post"],
      });

      subscriptionIterator = subscription[Symbol.asyncIterator]();

      (async () => {
        try {
          for await (const event of subscription!) {
            if (!messageHandler) continue;

            if (event.kind !== "commit") {
              continue;
            }

            const commitEvent = event as CommitEvent;
            handleCommitEvent(commitEvent, {
              watchedDids,
              scheduleDids,
              agentDid,
              owner,
              eventStore,
              dispatch: messageHandler,
            });
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message !== "The operation was aborted"
          ) {
            console.error("[bluesky] Jetstream subscription error:", error);
          }
        }
      })();
    },

    async disconnect(): Promise<void> {
      adapter.stopSessionRefresh();
      if (subscriptionIterator) {
        await subscriptionIterator.return?.();
        subscriptionIterator = null;
      }
      subscription = null;
      messageHandler = null;
    },

    onMessage(handler: (message: IncomingMessage) => void): void {
      messageHandler = handler;
    },

    startSessionRefresh(intervalMs?: number): void {
      if (refreshTimer) return;
      const interval = intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
      refreshTimer = setInterval(() => void refreshSession(), interval);
      console.log(`[bluesky] session refresh scheduled every ${interval / 1000}s`);
    },

    stopSessionRefresh(): void {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    },

    getAccessToken(): string {
      const session = agent.session;
      if (!session || !session.accessJwt) {
        throw new Error("No active session or access token");
      }
      return session.accessJwt;
    },

    getRefreshToken(): string {
      const session = agent.session;
      if (!session || !session.refreshJwt) {
        throw new Error("No active session or refresh token");
      }
      return session.refreshJwt;
    },

    getPdsUrl(): string {
      const pdsUrl = agent.pdsUrl;
      if (!pdsUrl) {
        throw new Error("No PDS URL available (not logged in?)");
      }
      return pdsUrl.toString();
    },
  };

  return adapter;
}
