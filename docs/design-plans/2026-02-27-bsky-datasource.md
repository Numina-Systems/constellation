# Bluesky DataSource Integration Design

## Summary

Constellation is a stateful AI agent daemon — a "Machine Spirit" that maintains persistent memory, executes code in a sandboxed environment, and processes conversations through a long-running loop. This design adds Bluesky as a live input channel: the agent connects to the AT Protocol's Jetstream firehose, watches for posts from a configured list of accounts and replies to her own handle, and processes each incoming post as an autonomous decision point — she can reply, like, quote, or ignore.

The approach follows an "Optimised Agency" pattern: the DataSource adapter is a thin, passive listener responsible only for filtering and translating raw firehose events into typed `ExternalEvent` objects. All active outgoing behaviour — posting, replying, liking — is handled by agent-authored code that runs in the Deno sandbox at the agent's own discretion. Credentials are managed by the host process, which holds the long-lived app password exclusively and injects short-lived JWT tokens into each sandbox execution, scoped to the Bluesky conversation context only. The agent never touches the secret directly.

## Definition of Done

1. **Bluesky DataSource adapter** — implements the `DataSource` interface, connects to Jetstream, filters `app.bsky.feed.post` by configurable DID allowlist and replies to the agent's own account, and translates incoming posts into `ExternalEvent` objects
2. **Agent extension** — `processEvent()` method on the Agent that accepts external events with source metadata, processes them in a dedicated long-running Bluesky conversation, and returns the agent's response
3. **Template code in memory** — BskyAgent login/post/reply/like reference code seeded into archival memory so the agent can write and execute Bluesky API calls in the Deno sandbox
4. **Config + auth** — `[bluesky]` section in config.toml with handle, app password, DID allowlist, agent DID; env var overrides for secrets (`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`)
5. **Wiring** — composition root connects Bluesky DataSource to the agent loop, Deno sandbox allows outgoing connections to `bsky.social`

## Acceptance Criteria

### bsky-datasource.AC1: Bluesky DataSource Adapter
- **bsky-datasource.AC1.1 Success:** DataSource connects to Jetstream and receives `app.bsky.feed.post` events
- **bsky-datasource.AC1.2 Success:** Posts from DIDs in `watched_dids` config are passed to the message handler
- **bsky-datasource.AC1.3 Success:** Replies to the agent's own `did` are passed to the message handler (regardless of author DID)
- **bsky-datasource.AC1.4 Failure:** Posts from DIDs not in `watched_dids` and not replies to agent are filtered out
- **bsky-datasource.AC1.5 Success:** IncomingMessage metadata contains platform, did, handle, uri, cid, rkey, and reply_to (when applicable)
- **bsky-datasource.AC1.6 Success:** BskyAgent session is established on connect, access/refresh tokens are accessible via getter methods

### bsky-datasource.AC2: Agent processEvent()
- **bsky-datasource.AC2.1 Success:** `processEvent()` creates/reuses a dedicated Bluesky conversation distinct from REPL
- **bsky-datasource.AC2.2 Success:** Event is formatted as a structured message with author DID/handle, post URI/CID, reply context, and post text
- **bsky-datasource.AC2.3 Success:** Agent can use tools (memory, code execution) during event processing
- **bsky-datasource.AC2.4 Edge:** Bluesky conversation persists across daemon restarts (deterministic conversation_id)

### bsky-datasource.AC3: Credential Injection
- **bsky-datasource.AC3.1 Success:** Sandbox executions from Bluesky conversation receive BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE as constants
- **bsky-datasource.AC3.2 Failure:** Sandbox executions from REPL conversation do not receive Bluesky credentials
- **bsky-datasource.AC3.3 Success:** Injected constants are valid JavaScript/TypeScript that can be referenced by agent-written code

### bsky-datasource.AC4: Config & Auth
- **bsky-datasource.AC4.1 Success:** `[bluesky]` section in config.toml parses with all fields (enabled, handle, app_password, did, watched_dids, jetstream_url)
- **bsky-datasource.AC4.2 Failure:** Config validation fails when `enabled: true` but required fields (handle, app_password, did) are missing
- **bsky-datasource.AC4.3 Success:** `BLUESKY_HANDLE` env var overrides `bluesky.handle` in TOML
- **bsky-datasource.AC4.4 Success:** `BLUESKY_APP_PASSWORD` env var overrides `bluesky.app_password` in TOML
- **bsky-datasource.AC4.5 Edge:** `watched_dids` can be empty (agent only receives replies to own account)
- **bsky-datasource.AC4.6 Success:** Feature is entirely disabled when `enabled: false` or `[bluesky]` section absent

### bsky-datasource.AC5: Template Code & Memory Seeding
- **bsky-datasource.AC5.1 Success:** `bluesky:post`, `bluesky:reply`, `bluesky:like` memory blocks seeded on first run with bluesky enabled
- **bsky-datasource.AC5.2 Success:** Templates are complete, working code examples using `npm:@atproto/api` and injected constants
- **bsky-datasource.AC5.3 Failure:** Templates are not seeded when `bluesky.enabled` is false
- **bsky-datasource.AC5.4 Edge:** Re-running with bluesky enabled does not duplicate templates (idempotent)

### bsky-datasource.AC6: Wiring & Error Handling
- **bsky-datasource.AC6.1 Success:** Full pipeline: Jetstream event → DataSource filter → processEvent → agent response
- **bsky-datasource.AC6.2 Success:** Backpressure queue caps at 50 events, drops oldest when full
- **bsky-datasource.AC6.3 Edge:** REPL starts normally even if Jetstream is unreachable
- **bsky-datasource.AC6.4 Success:** DataSource disconnects cleanly on daemon shutdown
- **bsky-datasource.AC6.5 Failure:** processEvent errors are logged but do not crash the Jetstream listener

## Glossary

- **AT Protocol**: The open, federated social networking protocol underlying Bluesky. Defines the data formats, identity system (DIDs), and record structure used by all Bluesky content.
- **Jetstream**: A lightweight WebSocket service that streams a filtered subset of the AT Protocol firehose. Used here as the real-time event source for incoming Bluesky posts.
- **DID (Decentralised Identifier)**: A stable, globally unique identifier for an AT Protocol account. Unlike handles, DIDs do not change when a user renames their account.
- **Handle**: The human-readable username portion of a Bluesky identity (e.g. `spirit.bsky.social`). Subject to change; the DID is the canonical identifier.
- **URI (AT Protocol record URI)**: A stable address for a specific record in the AT Protocol network. Format: `at://did/collection/rkey`.
- **CID (Content Identifier)**: A content-addressed hash of a specific version of a record. Used together with a URI to pin a reference to an exact, immutable snapshot of a post.
- **rkey (Record Key)**: The unique key within a DID's collection that identifies a single record (e.g. a specific post within `app.bsky.feed.post`).
- **`app.bsky.feed.post`**: The AT Protocol Lexicon type for a Bluesky post record. The event type this integration exclusively filters for.
- **BskyAgent**: The session manager class from `@atproto/api`. Handles login, token storage, and provides a typed API client for Bluesky API calls.
- **`@atproto/api`**: The official AT Protocol client library. Used in agent-authored sandbox code to interact with Bluesky.
- **`@atcute/jetstream`**: A lightweight client library for subscribing to the Jetstream WebSocket stream.
- **App Password**: A Bluesky-specific restricted credential (distinct from the account password) used for API login. Grants API access without exposing the master account password.
- **JWT (JSON Web Token)**: The short-lived access and refresh tokens issued by Bluesky after login. The access token authenticates API calls; the refresh token obtains a new access token when the old one expires.
- **DataSource**: Constellation's extension interface for external message streams. Defines `connect()`, `disconnect()`, `onMessage()`, and an optional `send()`.
- **ExternalEvent**: A typed envelope for events originating outside the REPL conversation. Carries source, content, timestamp, and platform-specific metadata.
- **Deno sandbox**: An isolated Deno subprocess used to execute agent-authored code. Enforces network, filesystem, and subprocess permissions via Deno's permission system.
- **Credential injection**: The pattern of prepending constant declarations into the assembled sandbox script before execution, making credentials available to agent-written code without env vars.
- **Backpressure queue**: An in-memory buffer (capped at 50 events, dropping oldest when full) between the Jetstream listener and the agent loop.
- **DID allowlist (`watched_dids`)**: The configured list of DIDs whose posts the DataSource will pass through.
- **Memory seeding**: The startup process of writing initial archival memory blocks so the agent has reference code available from the start.
- **Composition root**: `src/index.ts` — the single location where all dependencies are instantiated and wired together.
- **`npm:@atproto/api`**: Deno's npm specifier syntax for importing an npm package directly inside Deno code without a separate install step.
- **Cursor (Jetstream)**: A sequence number used to resume a Jetstream subscription from a specific point after a disconnect.

## Architecture

Optimized Agency pattern: thin Jetstream listener for incoming posts, all outgoing actions via agent-authored code in the Deno sandbox.

The Bluesky DataSource (`src/extensions/bluesky/`) connects to the AT Protocol firehose via `@atcute/jetstream`, filtering for `app.bsky.feed.post` events from a configurable DID allowlist and replies to the agent's own account. Incoming posts are translated into `ExternalEvent` objects and routed to a new `processEvent()` method on the Agent.

The agent processes events in a dedicated long-running Bluesky conversation (isolated from REPL). She decides autonomously whether to reply, quote, like, or ignore each post. When she acts, she writes code using `npm:@atproto/api` that executes in the Deno sandbox.

The host manages a persistent `BskyAgent` session and injects fresh access/refresh JWT tokens into sandbox executions originating from the Bluesky conversation. The agent never sees the app password — only short-lived tokens. REPL code executions receive no Bluesky credentials.

**Key contracts:**

```typescript
type ExternalEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

type BlueskyPostMetadata = {
  platform: 'bluesky';
  did: string;
  handle: string;
  uri: string;
  cid: string;
  rkey: string;
  reply_to?: {
    parent_uri: string;
    parent_cid: string;
    root_uri: string;
    root_cid: string;
  };
};
```

```typescript
// Extended Agent interface
interface Agent {
  processMessage(userMessage: string): Promise<string>;
  processEvent(event: ExternalEvent): Promise<string>;
  getConversationHistory(): Promise<Array<ConversationMessage>>;
  conversationId: string;
}
```

```typescript
// Extended DataSource (Bluesky-specific additions beyond interface)
interface BlueskyDataSource extends DataSource {
  getAccessToken(): string;
  getRefreshToken(): string;
}
```

```typescript
// Extended executor context
type ExecutionContext = {
  bluesky?: {
    service: string;
    accessToken: string;
    refreshToken: string;
    did: string;
    handle: string;
  };
};
```

```typescript
// Config shape
type BlueskyConfig = {
  enabled: boolean;
  handle: string;
  app_password: string;
  did: string;
  watched_dids: string[];
  jetstream_url: string;
};
```

**Data flow:**

1. Jetstream → BlueskyDataSource (filter by DID allowlist + reply detection)
2. BlueskyDataSource → `agent.processEvent(event)` (via onMessage handler in composition root)
3. Agent decides action → writes code using template from memory
4. Agent calls `execute_code` → executor injects Bluesky credentials → Deno sandbox runs code against `bsky.social`

## Existing Patterns

**DataSource interface** (`src/extensions/data-source.ts`): The Bluesky adapter implements this directly. `connect()` opens the Jetstream subscription and logs into BskyAgent. `disconnect()` closes both. `onMessage()` registers the event handler. `send()` is not implemented — outgoing actions go through the sandbox.

**Factory function pattern**: `createBlueskySource(config)` returns `BlueskyDataSource`, consistent with `createAgent()`, `createDenoExecutor()`, etc.

**Env var override pattern** (`src/config/config.ts`): `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD` override TOML values, same as `ANTHROPIC_API_KEY` and `DATABASE_URL`.

**Memory seeding pattern** (`src/index.ts:seedCoreMemory`): Bluesky template blocks are seeded conditionally on first run when `bluesky.enabled` is true, checking for existing blocks before writing.

**Tool stub injection pattern** (`src/runtime/executor.ts`): Credential constants are injected into the assembled script in the same location as tool stubs — between runtime bridge code and user code.

**Functional Core / Imperative Shell**: Types and config schema are Functional Core. DataSource adapter, agent loop extension, and executor changes are Imperative Shell.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Config & Schema
**Goal:** Bluesky configuration section with Zod validation and env var overrides

**Components:**
- Zod schema for `BlueskyConfig` in `src/config/schema.ts`
- Env var override logic for `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD` in `src/config/config.ts`
- `config.toml.example` updated with `[bluesky]` section
- `BlueskyConfig` type exported from `src/config/`

**Dependencies:** None

**Done when:** Config loads with `[bluesky]` section, env overrides work, validation rejects missing required fields when `enabled: true`. Tests verify: valid config parses, invalid config rejected, env vars override TOML values. Covers `bsky-datasource.AC4.1` through `bsky-datasource.AC4.4`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Bluesky DataSource Adapter
**Goal:** Jetstream listener with DID filtering and BskyAgent session management

**Components:**
- `BlueskyDataSource` implementation in `src/extensions/bluesky/source.ts`
- `BlueskyPostMetadata` type in `src/extensions/bluesky/types.ts`
- Factory function `createBlueskySource(config)` in `src/extensions/bluesky/`
- Barrel export from `src/extensions/bluesky/index.ts`
- Updated `src/extensions/index.ts` to re-export Bluesky module

**Dependencies:** Phase 1 (BlueskyConfig type)

**Done when:** DataSource connects to Jetstream, filters posts by DID allowlist and reply detection, translates events to IncomingMessage with BlueskyPostMetadata, manages BskyAgent session with token access, handles reconnection via cursor. Tests verify: DID filtering logic, reply detection, event translation, session token exposure. Covers `bsky-datasource.AC1.1` through `bsky-datasource.AC1.6`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Agent Extension — processEvent()
**Goal:** External event processing with dedicated Bluesky conversation

**Components:**
- `ExternalEvent` type in `src/agent/types.ts`
- `processEvent()` method in `src/agent/agent.ts`
- Event message formatting (structured header with metadata + post content)
- Deterministic Bluesky conversation_id generation

**Dependencies:** Phase 1 (config), Phase 2 (BlueskyPostMetadata type)

**Done when:** Agent can receive ExternalEvent, process it in a dedicated conversation, and return a response. Bluesky conversation is isolated from REPL. Event formatting includes all metadata (DID, handle, URI, CID, reply context). Tests verify: event processing produces agent response, conversation isolation, message formatting includes metadata. Covers `bsky-datasource.AC2.1` through `bsky-datasource.AC2.4`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Credential Injection
**Goal:** Sandbox receives Bluesky tokens for Bluesky-context executions only

**Components:**
- `ExecutionContext` type in `src/runtime/types.ts`
- Updated `execute()` signature in `src/runtime/executor.ts` to accept optional context
- Credential constants block generation and injection into assembled script
- Agent loop passes Bluesky context when dispatching `execute_code` from Bluesky conversation

**Dependencies:** Phase 2 (DataSource token access), Phase 3 (Bluesky conversation detection)

**Done when:** Sandbox code in Bluesky conversation receives `BSKY_SERVICE`, `BSKY_ACCESS_TOKEN`, `BSKY_REFRESH_TOKEN`, `BSKY_DID`, `BSKY_HANDLE` as constants. REPL executions do not receive credentials. Tests verify: credentials injected for Bluesky context, credentials absent for REPL context, injected constants are syntactically valid. Covers `bsky-datasource.AC3.1` through `bsky-datasource.AC3.3`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Template Code & Memory Seeding
**Goal:** Bluesky API reference code seeded into agent memory

**Components:**
- Template content for `bluesky:post`, `bluesky:reply`, `bluesky:like` memory blocks
- Seeding logic in `src/index.ts` (conditional on `bluesky.enabled`, idempotent)
- Templates use `npm:@atproto/api` with injected constants

**Dependencies:** Phase 4 (credential injection — templates reference injected constants)

**Done when:** Templates seeded on first run with bluesky enabled, not re-seeded on subsequent runs. Each template is a complete working code example. Agent can retrieve templates via `memory_read`. Tests verify: templates seeded when enabled, not seeded when disabled, idempotent on re-run. Covers `bsky-datasource.AC5.1` through `bsky-datasource.AC5.4`.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Composition Root Wiring & Error Handling
**Goal:** Everything connected end-to-end with graceful error handling

**Components:**
- Bluesky DataSource creation and connection in `src/index.ts`
- Event routing: `dataSource.onMessage()` → `agent.processEvent()`
- Token getter references passed to executor
- Backpressure queue (in-memory, capped at 50 events)
- Graceful startup (Jetstream failure doesn't block REPL)
- Graceful shutdown (DataSource disconnect on exit)
- Error logging for processEvent failures

**Dependencies:** All previous phases

**Done when:** Full pipeline works: Jetstream event → DataSource → Agent → sandbox code → Bluesky API. Backpressure queue drops oldest when full. Startup continues if Jetstream is unreachable. Shutdown disconnects cleanly. Errors are logged without crashing. Covers `bsky-datasource.AC6.1` through `bsky-datasource.AC6.5`.
<!-- END_PHASE_6 -->

## Additional Considerations

**Security:** App password never enters the Deno sandbox. Only short-lived JWTs are injected. Access tokens typically expire in ~2 hours. The refresh token allows the sandbox to self-heal on expiry, but both tokens are scoped to a single execution and not persisted by sandbox code.

**Backpressure:** The in-memory event queue (cap 50, drop oldest) is a pragmatic first pass. If the agent consistently falls behind, the dropped events are the oldest (least relevant). Future work could add priority (e.g., mentions over watched-DID posts) but this is out of scope.

**npm package caching:** First Deno sandbox execution with `npm:@atproto/api` will be slower due to npm resolution and download. Subsequent executions use Deno's cache. This is a one-time cost per Deno cache lifecycle.
