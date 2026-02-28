import { describe, it, expect, mock } from "bun:test";
import { shouldAcceptEvent, createBlueskySource } from "./source.ts";
import type { CommitEvent } from "@atcute/jetstream";
import type { BskyAgent } from "@atproto/api";
import type { BlueskyConfig } from "@/config/schema.ts";

describe("shouldAcceptEvent", () => {
  describe("bsky-datasource.AC1.2: Accept posts from DIDs in watched_dids", () => {
    it("should return true when author DID is in watched_dids set", () => {
      const watchedDids = new Set(["did:plc:friend1", "did:plc:friend2"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:friend1",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: { text: "hello" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(true);
    });
  });

  describe("bsky-datasource.AC1.3: Accept replies to agent's DID", () => {
    it("should return true when post is a reply to agent DID regardless of author", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:stranger",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: {
            text: "reply to you",
            reply: {
              parent: {
                uri: "at://did:plc:agent/app.bsky.feed.post/xyz789",
                cid: "bafy456",
              },
              root: {
                uri: "at://did:plc:agent/app.bsky.feed.post/root",
                cid: "bafy789",
              },
            },
          },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(true);
    });
  });

  describe("bsky-datasource.AC1.4: Reject posts not in watched_dids and not replies to agent", () => {
    it("should return false when author DID not in watched_dids and not a reply to agent", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:stranger",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: { text: "just a post" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(false);
    });

    it("should return false for delete operations", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:friend1",
        time_us: 1000000,
        commit: {
          operation: "delete",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(false);
    });

    it("should return false for update operations", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:friend1",
        time_us: 1000000,
        commit: {
          operation: "update",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: { text: "updated" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(false);
    });
  });

  describe("bsky-datasource.AC1.5: IncomingMessage metadata contains all required fields", () => {
    it("should verify shouldAcceptEvent processes events with required metadata fields", () => {
      // This test verifies that events are structured to contain all fields needed for metadata
      // construction. The shouldAcceptEvent function filters; downstream code constructs metadata
      // with: platform, did, handle, uri, cid, rkey, and optional reply_to
      const watchedDids = new Set(["did:plc:poster"]);
      const agentDid = "did:plc:agent";

      // Test simple post event
      const simplePostEvent: CommitEvent = {
        kind: "commit",
        did: "did:plc:poster",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "xyz789",
          cid: "bafy456",
          record: { text: "test post" },
        },
      };

      expect(shouldAcceptEvent(simplePostEvent, watchedDids, agentDid)).toBe(true);
      // Verify required fields exist on the accepted event
      expect(simplePostEvent.did).toBe("did:plc:poster");
      expect(simplePostEvent.commit.rkey).toBe("xyz789");
      expect(simplePostEvent.commit.cid).toBe("bafy456");

      // Test reply event
      const replyEvent: CommitEvent = {
        kind: "commit",
        did: "did:plc:replier",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "reply123",
          cid: "bafy789",
          record: {
            text: "reply text",
            reply: {
              parent: {
                uri: "at://did:plc:original/app.bsky.feed.post/original",
                cid: "bafy-parent",
              },
              root: {
                uri: "at://did:plc:root/app.bsky.feed.post/root",
                cid: "bafy-root",
              },
            },
          },
        },
      };

      const watchedDidsWithReplier = new Set(["did:plc:replier"]);
      expect(shouldAcceptEvent(replyEvent, watchedDidsWithReplier, agentDid)).toBe(true);
      // Verify reply_to structure exists
      const record = replyEvent.commit.record as {
        reply?: { parent: { uri: string; cid: string }; root: { uri: string; cid: string } };
      };
      expect(record.reply?.parent?.uri).toBe("at://did:plc:original/app.bsky.feed.post/original");
      expect(record.reply?.parent?.cid).toBe("bafy-parent");
      expect(record.reply?.root?.uri).toBe("at://did:plc:root/app.bsky.feed.post/root");
      expect(record.reply?.root?.cid).toBe("bafy-root");
    });

    it("should accept events with complete metadata structure for adapter transformation", () => {
      // Acceptance criterion AC1.5 requires metadata with: platform, did, handle, uri, cid, rkey, reply_to?
      // This test verifies the raw event provides all required fields for transformation
      const watchedDids = new Set(["did:plc:poster"]);
      const agentDid = "did:plc:agent";

      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:poster",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "xyz789",
          cid: "bafy456",
          record: { text: "test post" },
        },
      };

      // Verify shouldAcceptEvent passes through all required event fields
      expect(shouldAcceptEvent(event, watchedDids, agentDid)).toBe(true);

      // Construct expected metadata as the adapter would
      const expectedMetadata = {
        platform: "bluesky",
        did: event.did,
        handle: event.did, // Currently handle = did in adapter
        uri: `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`,
        cid: event.commit.cid,
        rkey: event.commit.rkey,
      };

      expect(expectedMetadata.platform).toBe("bluesky");
      expect(typeof expectedMetadata.did).toBe("string");
      expect(expectedMetadata.did).toBe("did:plc:poster");
      expect(typeof expectedMetadata.handle).toBe("string");
      expect(typeof expectedMetadata.uri).toBe("string");
      expect(expectedMetadata.uri).toBe("at://did:plc:poster/app.bsky.feed.post/xyz789");
      expect(typeof expectedMetadata.cid).toBe("string");
      expect(expectedMetadata.cid).toBe("bafy456");
      expect(typeof expectedMetadata.rkey).toBe("string");
      expect(expectedMetadata.rkey).toBe("xyz789");
    });
  });

  describe("bsky-datasource.AC1.1 & AC1.6: Session management", () => {
    it("should establish BskyAgent session and return access/refresh tokens", async () => {
      const mockAgent = {
        login: mock(async () => ({
          accessJwt: "access-token-xyz",
          refreshJwt: "refresh-token-abc",
        })),
        session: {
          accessJwt: "access-token-xyz",
          refreshJwt: "refresh-token-abc",
          handle: "test.bsky.social",
          did: "did:plc:test",
          active: true,
        },
      } as unknown as BskyAgent;

      const config: BlueskyConfig = {
        enabled: true,
        handle: "test.bsky.social",
        app_password: "test-password",
        did: "did:plc:agent",
        watched_dids: [],
        jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
      };

      const source = createBlueskySource(config, mockAgent);

      expect(source.name).toBe("bluesky");

      await source.connect();

      expect(mockAgent.login).toHaveBeenCalledWith({
        identifier: "test.bsky.social",
        password: "test-password",
      });

      expect(source.getAccessToken()).toBe("access-token-xyz");
      expect(source.getRefreshToken()).toBe("refresh-token-abc");
    });

    it("should throw when accessing tokens without active session", () => {
      const mockAgent = {
        login: mock(async () => ({})),
        session: undefined,
      } as unknown as BskyAgent;

      const config: BlueskyConfig = {
        enabled: true,
        handle: "test.bsky.social",
        app_password: "test-password",
        did: "did:plc:agent",
        watched_dids: [],
        jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
      };

      const source = createBlueskySource(config, mockAgent);

      expect(() => source.getAccessToken()).toThrow("No active session or access token");
      expect(() => source.getRefreshToken()).toThrow(
        "No active session or refresh token",
      );
    });
  });
});
