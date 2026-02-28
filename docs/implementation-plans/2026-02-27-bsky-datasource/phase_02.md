# Bluesky DataSource Implementation Plan — Phase 2: Bluesky DataSource Adapter

**Goal:** Implement the Jetstream listener with DID filtering, reply detection, and BskyAgent session management as a DataSource adapter.

**Architecture:** `BlueskyDataSource` implements the `DataSource` interface from `src/extensions/data-source.ts`. It connects to Jetstream via the `@atcute/jetstream` package (which provides a typed WebSocket wrapper with event parsing), filters `app.bsky.feed.post` commit events by DID allowlist and reply-to-agent detection, translates them into `IncomingMessage` objects with `BlueskyPostMetadata`, and manages a `BskyAgent` session for token access. Factory function `createBlueskySource(config)` returns the adapter.

**Tech Stack:** `@atproto/api` (BskyAgent session), `@atcute/jetstream` (typed Jetstream WebSocket client), Bun test

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC1: Bluesky DataSource Adapter
- **bsky-datasource.AC1.1 Success:** DataSource connects to Jetstream and receives `app.bsky.feed.post` events
- **bsky-datasource.AC1.2 Success:** Posts from DIDs in `watched_dids` config are passed to the message handler
- **bsky-datasource.AC1.3 Success:** Replies to the agent's own `did` are passed to the message handler (regardless of author DID)
- **bsky-datasource.AC1.4 Failure:** Posts from DIDs not in `watched_dids` and not replies to agent are filtered out
- **bsky-datasource.AC1.5 Success:** IncomingMessage metadata contains platform, did, handle, uri, cid, rkey, and reply_to (when applicable)
- **bsky-datasource.AC1.6 Success:** BskyAgent session is established on connect, access/refresh tokens are accessible via getter methods

---

<!-- START_TASK_1 -->
### Task 1: Install dependencies

**Verifies:** None (infrastructure)

**Files:**
- Modify: `package.json` (add dependencies)

**Implementation:**

Install the AT Protocol packages:

```bash
bun add @atproto/api @atcute/jetstream
```

**Verification:**
Run: `bun install`
Expected: Installs without errors

Run: `bun run build`
Expected: Type-check still passes

**Commit:** `chore: add @atproto/api and @atcute/jetstream dependencies`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Create BlueskyPostMetadata type and BlueskyDataSource extension interface

**Verifies:** bsky-datasource.AC1.5

**Files:**
- Create: `src/extensions/bluesky/types.ts`

**Implementation:**

Create the types file with `BlueskyPostMetadata` (the metadata shape carried in `IncomingMessage.metadata`) and `BlueskyDataSource` (extends `DataSource` with token getters):

```typescript
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
}
```

No tests needed — TypeScript compiler verifies types.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(bluesky): add BlueskyPostMetadata and BlueskyDataSource types`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Implement BlueskyDataSource adapter and factory function

**Verifies:** bsky-datasource.AC1.1, bsky-datasource.AC1.2, bsky-datasource.AC1.3, bsky-datasource.AC1.4, bsky-datasource.AC1.6

**Files:**
- Create: `src/extensions/bluesky/source.ts`

**Implementation:**

Create the adapter implementing `BlueskyDataSource`. The adapter must satisfy the full `DataSource` interface including `readonly name: string`.

Key behaviours:

1. **`name` property**: The `DataSource` interface requires `readonly name: string`. Set this to `"bluesky"` — it identifies the data source in logs and message routing.

2. **`connect()`**: Logs in via `BskyAgent` to establish session, then opens Jetstream WebSocket with `wantedCollections: ["app.bsky.feed.post"]`. Handle resolution uses the agent session's DID.

3. **Event filtering logic** (core business logic, should be a pure function `shouldAcceptEvent()`):
   - Accept if author DID is in `watched_dids` set
   - Accept if post is a reply where the parent URI starts with `at://<agent_did>/`
   - Reject otherwise

4. **Event translation**: Convert Jetstream commit events to `IncomingMessage` with `BlueskyPostMetadata` in the metadata field. The `handle` field can be resolved later or set to DID initially (handle resolution is not critical for filtering).

5. **`disconnect()`**: Close WebSocket, clear handler reference.

6. **`getAccessToken()` / `getRefreshToken()`**: Return current session tokens from `BskyAgent.session`.

7. **Factory function**: `createBlueskySource(config: BlueskyConfig): BlueskyDataSource` — instantiates and returns the adapter.

The Jetstream WebSocket URL is constructed as: `${config.jetstream_url}?wantedCollections=app.bsky.feed.post`

Use `@atcute/jetstream`'s `Jetstream` class for the WebSocket connection — it provides typed event parsing and automatic reconnection. The `Jetstream` constructor accepts a URL and options including `wantedCollections`. Listen for events via the `on('event', handler)` pattern.

The `shouldAcceptEvent()` filter function should be extracted as a separate pure function for testability.

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC1.1: Verify that `connect()` establishes the BskyAgent session (mock the agent login) and opens WebSocket connection
- bsky-datasource.AC1.2: Verify `shouldAcceptEvent()` returns true when author DID is in watched_dids set
- bsky-datasource.AC1.3: Verify `shouldAcceptEvent()` returns true when post reply parent URI matches agent DID, regardless of author DID
- bsky-datasource.AC1.4: Verify `shouldAcceptEvent()` returns false when author DID not in watched_dids and post is not a reply to agent
- bsky-datasource.AC1.6: Verify that after connect, `getAccessToken()` and `getRefreshToken()` return string values from the session

Test file: `src/extensions/bluesky/source.test.ts` (unit test)

Focus tests on the pure `shouldAcceptEvent()` filter function — this is the core business logic and can be tested without any network or mock dependencies. For the connect/session tests, create a minimal mock that satisfies the BskyAgent interface.

**Verification:**
Run: `bun test src/extensions/bluesky/source.test.ts`
Expected: All tests pass

**Commit:** `feat(bluesky): implement BlueskyDataSource adapter with Jetstream listener`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Create barrel exports for bluesky module and update extensions index

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/extensions/bluesky/index.ts`
- Modify: `src/extensions/index.ts:1-6`

**Implementation:**

Create `src/extensions/bluesky/index.ts`:
```typescript
// pattern: Functional Core (barrel export)

export type { BlueskyPostMetadata, BlueskyDataSource } from "./types.ts";
export { createBlueskySource } from "./source.ts";
```

Add to `src/extensions/index.ts` (after line 6):
```typescript
export type { BlueskyPostMetadata, BlueskyDataSource } from './bluesky/index.ts';
export { createBlueskySource } from './bluesky/index.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(bluesky): add barrel exports for bluesky extension module`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Run full test suite

**Verifies:** None (verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All previously-passing tests still pass (116 + new Phase 1 and Phase 2 tests). Pre-existing PostgreSQL failures expected.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_5 -->
