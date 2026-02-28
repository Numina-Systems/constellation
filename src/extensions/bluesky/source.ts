// pattern: Imperative Shell

import type { BskyAgent } from "@atproto/api";
import { JetstreamSubscription } from "@atcute/jetstream";
import type { CommitEvent } from "@atcute/jetstream";
import type { IncomingMessage } from "../data-source.ts";
import type { BlueskyConfig } from "@/config/schema.ts";
import type { BlueskyDataSource, BlueskyPostMetadata } from "./types.ts";

type EventRecord = {
  text?: string;
  reply?: {
    parent: { uri: string; cid: string };
    root: { uri: string; cid: string };
  };
};

export function shouldAcceptEvent(
  event: CommitEvent,
  watchedDids: Set<string>,
  agentDid: string,
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

  // Accept if post is a reply where the parent URI starts with at://<agent_did>/
  if (record.reply?.parent?.uri) {
    const parentUri = record.reply.parent.uri;
    if (parentUri.startsWith(`at://${agentDid}/`)) {
      return true;
    }
  }

  return false;
}

export function createBlueskySource(
  config: BlueskyConfig,
  agent: BskyAgent,
): BlueskyDataSource {
  let subscription: JetstreamSubscription | null = null;
  let subscriptionIterator: AsyncIterator<unknown> | null = null;
  let messageHandler: ((message: IncomingMessage) => void) | null = null;
  const watchedDids = new Set(config.watched_dids);

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
            if (!shouldAcceptEvent(commitEvent, watchedDids, agentDid)) {
              continue;
            }

            const commit = commitEvent.commit;

            if (commit.operation !== "create") {
              continue;
            }

            const record = commit.record as EventRecord;
            const rkey = commit.rkey;

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
              uri: `at://${commitEvent.did}/app.bsky.feed.post/${rkey}`,
              cid: commit.cid,
              rkey,
              ...(replyTo && { reply_to: replyTo }),
            };

            const message: IncomingMessage = {
              source: "bluesky",
              content: record.text || "",
              metadata,
              timestamp: new Date(),
            };

            messageHandler(message);
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
  };

  return adapter;
}
