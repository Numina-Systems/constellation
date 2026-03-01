# Bluesky DataSource

Last verified: 2026-02-28

## Purpose
First concrete `DataSource` implementation. Connects the agent to Bluesky via the AT Protocol, receiving posts/replies from a Jetstream firehose subscription and providing credentials for sandbox code to post back.

## Contracts
- **Exposes**: `BlueskyDataSource` (extends `DataSource` with `getAccessToken()`, `getRefreshToken()`), `BlueskyPostMetadata`, `EventQueue`, `createBlueskySource(config, agent)`, `createEventQueue(capacity)`, `seedBlueskyTemplates(store, embedding)`
- **Guarantees**:
  - Jetstream subscription filters to `app.bsky.feed.post` collection only
  - Events accepted only from `watched_dids` or replies to the agent's own posts
  - Event queue is bounded (drops oldest on overflow)
  - Template seeding is idempotent (checks for both `bluesky:post` AND `bluesky:capabilities` blocks; partial seeding is repaired)
  - Jetstream failure does not block the REPL (caught at composition root)
  - Capabilities block is seeded into working memory (pinned, readonly) so the agent sees it every turn
- **Expects**: `BlueskyConfig` with `enabled: true`, valid `handle`, `app_password`, and `did`. `@atproto/api` BskyAgent instance injected.

## Dependencies
- **Uses**: `src/extensions/data-source.ts` (DataSource/IncomingMessage), `src/config/schema.ts` (BlueskyConfig), `src/memory/store.ts` + `src/embedding/` (template seeding), `@atproto/api`, `@atcute/jetstream`
- **Used by**: `src/index.ts` (composition root)
- **Boundary**: This module does not import from `src/agent/` or `src/model/`. Event routing happens in the composition root.

## Key Decisions
- Jetstream over Firehose: Lower overhead, WebSocket-native, collection-filtered server-side
- Credential injection over SDK bundling: Sandbox gets raw JWT tokens via `ExecutionContext`, uses `npm:@atproto/api` inside Deno
- Event queue over direct dispatch: Prevents concurrent `processEvent` calls, bounded backpressure
- Templates in archival memory: Agent discovers Bluesky API patterns via memory search, not hardcoded tool definitions
- Capabilities in working memory: A pinned `bluesky:capabilities` block in working memory ensures the agent always knows it can use Bluesky, without needing to search archival first

## Key Files
- `types.ts` -- `BlueskyPostMetadata`, `BlueskyDataSource`
- `source.ts` -- Jetstream subscription, event filtering (`shouldAcceptEvent`), adapter factory
- `event-queue.ts` -- Bounded FIFO queue for incoming messages
- `seed.ts` -- Idempotent memory seeding (3 archival templates + 1 working capabilities block)
- `templates.ts` -- Bluesky post/reply/like code templates
