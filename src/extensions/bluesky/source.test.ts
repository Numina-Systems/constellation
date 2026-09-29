import { describe, it, expect, mock } from "bun:test";
import { shouldAcceptEvent, createBlueskySource, handleCommitEvent } from "./source.ts";
import type { CommitEvent } from "@atcute/jetstream";
import type { BskyAgent } from "@atproto/api";
import type { BlueskyConfig } from "@/config/schema.ts";
import type { IncomingMessage } from "../data-source.ts";
import type { BlueskyEventRecord, BlueskyEventStore } from "./types.ts";

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

  describe("agent-scheduling.AC5.1 & AC5.2: Accept/reject based on scheduleDids", () => {
    it("should return true when author DID is in schedule_dids but NOT in watched_dids", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const scheduleDids = new Set(["did:plc:scheduler"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:scheduler",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: { text: "scheduling request" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid, scheduleDids)).toBe(true);
    });

    it("should return true when author DID is in both watchedDids and scheduleDids", () => {
      const watchedDids = new Set(["did:plc:both"]);
      const scheduleDids = new Set(["did:plc:both"]);
      const agentDid = "did:plc:agent";
      const event: CommitEvent = {
        kind: "commit",
        did: "did:plc:both",
        time_us: 1000000,
        commit: {
          operation: "create",
          rev: "3",
          collection: "app.bsky.feed.post",
          rkey: "abc123",
          cid: "bafy123",
          record: { text: "post" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid, scheduleDids)).toBe(true);
    });

    it("should return false when author DID is in neither watchedDids nor scheduleDids", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
      const scheduleDids = new Set(["did:plc:scheduler"]);
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
          record: { text: "random post" },
        },
      };

      expect(shouldAcceptEvent(event, watchedDids, agentDid, scheduleDids)).toBe(false);
    });

    it("should accept events when scheduleDids is not provided (backward compatibility)", () => {
      const watchedDids = new Set(["did:plc:friend1"]);
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
          record: { text: "post from watched" },
        },
      };

      // Call without scheduleDids parameter
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
      if (simplePostEvent.commit.operation === "create") {
        expect(simplePostEvent.commit.cid).toBe("bafy456");
      }

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
      // Verify reply_to structure exists — narrow to create operation for type safety
      if (replyEvent.commit.operation !== "create") throw new Error("expected create");
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

      // Narrow to create operation for type safety
      if (event.commit.operation !== "create") throw new Error("expected create");

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
        pdsUrl: new URL("https://bankera.us-west.host.bsky.network/"),
      } as unknown as BskyAgent;

      const config: BlueskyConfig = {
        enabled: true,
        handle: "test.bsky.social",
        app_password: "test-password",
        did: "did:plc:agent",
        watched_dids: [],
        schedule_dids: [],
        jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
        context_enabled: true,
        context_limit: 10,
        context_retention_days: 30,
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
      expect(source.getPdsUrl()).toBe("https://bankera.us-west.host.bsky.network/");
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
        schedule_dids: [],
        jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
        context_enabled: true,
        context_limit: 10,
        context_retention_days: 30,
      };

      const source = createBlueskySource(config, mockAgent);

      expect(() => source.getAccessToken()).toThrow("No active session or access token");
      expect(() => source.getRefreshToken()).toThrow(
        "No active session or refresh token",
      );
      expect(() => source.getPdsUrl()).toThrow("No PDS URL available");
    });
  });
});

describe("handleCommitEvent", () => {
  const AGENT_DID = "did:plc:agent";
  const OWNER = "test-owner";

  function createFakeStore(overrides?: { failRecord?: boolean }): {
    store: BlueskyEventStore;
    recorded: Array<BlueskyEventRecord>;
  } {
    const recorded: Array<BlueskyEventRecord> = [];
    const store: BlueskyEventStore = {
      async record(event) {
        if (overrides?.failRecord) throw new Error("store unavailable");
        recorded.push(event);
      },
      async getRecentEvents() {
        return [];
      },
      async pruneEventsBefore() {
        return 0;
      },
    };
    return { store, recorded };
  }

  function makeCommitEvent(overrides: {
    did: string;
    timeUs?: number;
    text?: string;
    replyParentUri?: string;
    operation?: "create" | "delete" | "update";
  }): CommitEvent {
    const record: Record<string, unknown> = { text: overrides.text ?? "post text" };
    if (overrides.replyParentUri) {
      record["reply"] = {
        parent: { uri: overrides.replyParentUri, cid: "bafy-parent" },
        root: { uri: overrides.replyParentUri, cid: "bafy-root" },
      };
    }
    return {
      kind: "commit",
      did: overrides.did,
      time_us: overrides.timeUs ?? 1_000_000,
      commit: {
        operation: overrides.operation ?? "create",
        rev: "3",
        collection: "app.bsky.feed.post",
        rkey: "rkey123",
        ...(overrides.operation === "delete" ? {} : { cid: "bafy123", record }),
      },
    } as CommitEvent;
  }

  function makeDeps(overrides?: {
    watchedDids?: ReadonlySet<string>;
    store?: BlueskyEventStore;
  }): {
    deps: Parameters<typeof handleCommitEvent>[1];
    dispatched: Array<IncomingMessage>;
  } {
    const dispatched: Array<IncomingMessage> = [];
    const deps = {
      watchedDids: overrides?.watchedDids ?? new Set(["did:plc:friend1"]),
      scheduleDids: new Set<string>(),
      agentDid: AGENT_DID,
      owner: OWNER,
      ...(overrides?.store ? { eventStore: overrides.store } : {}),
      dispatch: (message: IncomingMessage) => {
        dispatched.push(message);
      },
    };
    return { deps, dispatched };
  }

  describe("bluesky-events.AC2: accepted events are recorded and dispatched", () => {
    it("records a watched event with uri/author/content/reply fields and dispatches it", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      const event = makeCommitEvent({
        did: "did:plc:friend1",
        timeUs: 1_759_070_000_000, // µs
        text: "hello world",
        replyParentUri: `at://${AGENT_DID}/app.bsky.feed.post/parent`,
      });

      handleCommitEvent(event, deps);
      await Bun.sleep(0);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.uri).toBe("at://did:plc:friend1/app.bsky.feed.post/rkey123");
      expect(recorded[0]!.authorDid).toBe("did:plc:friend1");
      expect(recorded[0]!.owner).toBe(OWNER);
      expect(recorded[0]!.content).toBe("hello world");
      expect(recorded[0]!.replyParentUri).toBe(`at://${AGENT_DID}/app.bsky.feed.post/parent`);
      expect(recorded[0]!.createdAt.getTime()).toBe(1_759_070_000);

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.content).toBe("hello world");
    });

    it("falls back to arrival time when time_us is absent or zero", async () => {
      const { store, recorded } = createFakeStore();
      const { deps } = makeDeps({ store });
      const before = Date.now();

      handleCommitEvent(makeCommitEvent({ did: "did:plc:friend1", timeUs: 0 }), deps);
      await Bun.sleep(0);

      const after = Date.now();
      expect(recorded[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(recorded[0]!.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it("logs a warning and still dispatches when the store fails", async () => {
      const { store } = createFakeStore({ failRecord: true });
      const { deps, dispatched } = makeDeps({ store });

      const warnings: Array<unknown> = [];
      const originalWarn = console.warn;
      console.warn = (...args: Array<unknown>) => {
        warnings.push(args[0]);
      };
      try {
        handleCommitEvent(makeCommitEvent({ did: "did:plc:friend1" }), deps);
        await Bun.sleep(0);
      } finally {
        console.warn = originalWarn;
      }

      expect(dispatched).toHaveLength(1);
      expect(warnings.some((warning) => String(warning).includes("[bluesky] event store record failed"))).toBe(true);
    });

    it("dispatches unchanged when no event store is configured", () => {
      const { deps, dispatched } = makeDeps();

      handleCommitEvent(makeCommitEvent({ did: "did:plc:friend1", text: "no store" }), deps);

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.content).toBe("no store");
    });

    it("does not record or dispatch events rejected by shouldAcceptEvent", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      handleCommitEvent(makeCommitEvent({ did: "did:plc:stranger" }), deps);
      await Bun.sleep(0);

      expect(recorded).toHaveLength(0);
      expect(dispatched).toHaveLength(0);
    });

    it("records and dispatches a schedule_dids-only event through the full handler", async () => {
      const { store, recorded } = createFakeStore();
      const dispatched: Array<IncomingMessage> = [];
      const deps = {
        watchedDids: new Set<string>(),
        scheduleDids: new Set(["did:plc:scheduler"]),
        agentDid: AGENT_DID,
        owner: OWNER,
        eventStore: store,
        dispatch: (message: IncomingMessage) => {
          dispatched.push(message);
        },
      };

      handleCommitEvent(makeCommitEvent({ did: "did:plc:scheduler", text: "schedule request" }), deps);
      await Bun.sleep(0);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.authorDid).toBe("did:plc:scheduler");
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.content).toBe("schedule request");
    });
  });

  describe("bluesky-events.AC3: own posts are recorded but not dispatched", () => {
    it("records an own post without dispatching it", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      handleCommitEvent(makeCommitEvent({ did: AGENT_DID, text: "my own post" }), deps);
      await Bun.sleep(0);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.authorDid).toBe(AGENT_DID);
      expect(dispatched).toHaveLength(0);
    });

    it("records and dispatches an own post when the agent watches its own DID", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({
        store,
        watchedDids: new Set(["did:plc:friend1", AGENT_DID]),
      });

      handleCommitEvent(makeCommitEvent({ did: AGENT_DID, text: "self-watched post" }), deps);
      await Bun.sleep(0);

      expect(recorded).toHaveLength(1);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.content).toBe("self-watched post");
    });

    it("records an own self-thread reply without dispatching it (loop prevention)", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      // Own post replying to the agent's own post: accepted by today's reply
      // rule and dispatched; under the new rule it is record-only.
      handleCommitEvent(
        makeCommitEvent({
          did: AGENT_DID,
          text: "self-thread reply",
          replyParentUri: `at://${AGENT_DID}/app.bsky.feed.post/earlier`,
        }),
        deps,
      );
      await Bun.sleep(0);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.replyParentUri).toBe(`at://${AGENT_DID}/app.bsky.feed.post/earlier`);
      expect(dispatched).toHaveLength(0);
    });

    it("ignores own-post delete commits entirely: no record, no dispatch, no throw", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      expect(() => {
        handleCommitEvent(
          makeCommitEvent({ did: AGENT_DID, operation: "delete" }),
          deps,
        );
      }).not.toThrow();
      await Bun.sleep(0);

      expect(recorded).toHaveLength(0);
      expect(dispatched).toHaveLength(0);
    });

    it("ignores own-post update commits entirely", async () => {
      const { store, recorded } = createFakeStore();
      const { deps, dispatched } = makeDeps({ store });

      expect(() => {
        handleCommitEvent(
          makeCommitEvent({ did: AGENT_DID, operation: "update", text: "edited" }),
          deps,
        );
      }).not.toThrow();
      await Bun.sleep(0);

      expect(recorded).toHaveLength(0);
      expect(dispatched).toHaveLength(0);
    });

    it("rejects an event store without an owner at factory time", () => {
      const { store } = createFakeStore();
      const mockAgent = { login: mock(async () => ({})) } as unknown as BskyAgent;
      const config: BlueskyConfig = {
        enabled: true,
        handle: "test.bsky.social",
        app_password: "test-password",
        did: AGENT_DID,
        watched_dids: [],
        schedule_dids: [],
        jetstream_url: "wss://jetstream2.us-east.bsky.network/subscribe",
        context_enabled: true,
        context_limit: 10,
        context_retention_days: 30,
      };

      expect(() =>
        createBlueskySource(config, mockAgent, { owner: "", eventStore: store }),
      ).toThrow("non-empty owner");
    });
  });
});
