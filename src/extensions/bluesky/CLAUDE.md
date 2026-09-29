# Bluesky DataSource

Last verified: 2026-09-29

## Purpose
First concrete `DataSource` implementation. Connects the agent to Bluesky via the AT Protocol, receiving posts/replies from a Jetstream firehose subscription and providing credentials for sandbox code to post back.

## Contracts
- **Exposes**: `BlueskyDataSource` (extends `DataSource` with `getAccessToken()`, `getRefreshToken()`, `startSessionRefresh()`, `stopSessionRefresh()`), `BlueskyPostMetadata`, `BlueskyEventRecord`, `BlueskyStoredEvent`, `BlueskyEventStore` (port), `EventQueue`, `createBlueskySource(config, agent, deps?)`, `handleCommitEvent(event, deps)`, `createPostgresBlueskyEventStore(persistence)`, `createBlueskyContextProvider(deps)`, `createEventQueue(capacity)`, `seedBlueskyTemplates(store, embedding)`
- **Guarantees**:
  - Jetstream subscription filters to `app.bsky.feed.post` collection only
  - Events accepted from `watched_dids`, `schedule_dids`, or replies to the agent's own posts
  - Event queue is bounded (drops oldest on overflow)
  - Template seeding is idempotent (checks for both `bluesky:post` AND `bluesky:capabilities` blocks; partial seeding is repaired)
  - Jetstream failure does not block the REPL (caught at composition root)
  - Capabilities block is seeded into working memory (pinned, readonly) so the agent sees it every turn
  - Session tokens are proactively refreshed hourly; falls back to re-login with app password if refresh fails
  - `handleCommitEvent` owns the per-event accept/record/dispatch decision: accepted events are dispatched and recorded fire-and-forget (store failure logs a warning, never blocks dispatch); own posts (`event.did === agentDid`, create only) are recorded but NOT dispatched unless the agent's DID is in `watched_dids` — this deliberately makes own self-thread replies record-only (loop prevention). Non-create own commits are ignored entirely (no record, no dispatch, no throw)
  - Event store records are idempotent per `uri` (`ON CONFLICT (uri) DO NOTHING`); `getRecentEvents` returns owner-scoped newest-first rows; `pruneEventsBefore` deletes only older rows and returns the count
  - The context provider renders the newest posts as an inline `[Bluesky] Recent activity (N newest posts):` list (no `##` header — the snapshot pipeline adds `## bluesky-activity`), with resolved handles (truncated-DID fallback), `(you)` and `(reply to you)` tags, 200-char content truncation; 60 s TTL cache, stale-cache-on-error; returns `undefined` for an empty store; prunes once per refresh at `context_retention_days`
- **Expects**: `BlueskyConfig` with `enabled: true`, valid `handle`, `app_password`, and `did`. `@atproto/api` BskyAgent instance injected. Optional `deps: {owner, eventStore}` on `createBlueskySource` for ambient persistence.

## Dependencies
- **Uses**: `src/extensions/data-source.ts` (DataSource/IncomingMessage), `src/config/schema.ts` (BlueskyConfig), `src/memory/store.ts` + `src/embedding/` (template seeding), `@atproto/api`, `@atcute/jetstream`
- **Used by**: `src/index.ts` (composition root), `src/orchestration/` (EventDrain wraps EventQueue for serialized agent processing)
- **Boundary**: This module does not import from `src/model/`. It imports only the `ContextProvider` type from `src/agent/types.ts` (same as the activity provider); event routing happens in the composition root.

## Key Decisions
- Jetstream over Firehose: Lower overhead, WebSocket-native, collection-filtered server-side
- Credential injection over SDK bundling: Sandbox gets raw JWT tokens via `ExecutionContext`, uses `npm:@atproto/api` inside Deno
- Event queue over direct dispatch: Prevents concurrent `processEvent` calls, bounded backpressure
- Templates in archival memory: Agent discovers Bluesky API patterns via memory search, not hardcoded tool definitions
- Capabilities in working memory: A pinned `bluesky:capabilities` block in working memory ensures the agent always knows it can use Bluesky, without needing to search archival first

## Key Files
- `types.ts` -- `BlueskyPostMetadata`, `BlueskyDataSource`, `BlueskyEventRecord`/`BlueskyStoredEvent`/`BlueskyEventStore` (persistence port)
- `source.ts` -- Jetstream subscription, event filtering (`shouldAcceptEvent`), per-event `handleCommitEvent` (accept/record/dispatch), adapter factory, periodic session refresh
- `postgres-event-store.ts` -- `BlueskyEventStore` adapter over `PersistenceProvider` (`bluesky_events` table, migration 019)
- `context-provider.ts` -- ambient `bluesky-activity` section provider (60 s TTL, handle resolution, retention prune)
- `event-queue.ts` -- Bounded FIFO queue for incoming messages
- `seed.ts` -- Idempotent memory seeding (3 archival templates + 1 working capabilities block)
- `templates.ts` -- Bluesky post/reply/like code templates
