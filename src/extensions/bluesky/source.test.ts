// pattern: Functional Core

import { describe, it, expect, beforeEach, mock } from "bun:test";
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
