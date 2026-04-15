---
name: app-patterns
description: Common patterns for building AT Protocol applications with Microcosm services. Use when building or architecting an atproto app that needs engagement data, real-time updates, or record hydration. Covers how to compose Constellation, Slingshot, and Spacedust together.
user-invocable: true
---

# app patterns — building with microcosm

## the compose pattern

Most atproto apps combine three services:

1. **Constellation** — historical queries ("how many likes?", "who follows?")
2. **Slingshot** — hydrate references into full records and identities
3. **Spacedust** — real-time updates via WebSocket

Typical flow: get initial counts from Constellation, resolve identities/records via Slingshot, then open a Spacedust WebSocket to keep things live.

## example: engagement counters

1. Fetch like/repost counts from Constellation's `getBacklinksCount` (parallel requests, one per source type per post URI)
2. Resolve author identities via Slingshot's `resolveMiniDoc` to get handles and avatars
3. Open a Spacedust WebSocket filtered to the post URIs + wanted sources to increment/decrement counts live

## writes and listRecords

Go through the user's PDS directly — Slingshot is read-only and doesn't support `listRecords`. Get the PDS URL from `resolveMiniDoc`, then call `com.atproto.repo.listRecords` on that PDS. For writes, use **pdsx** or hit the PDS XRPC endpoints directly with auth.

## bundled tools

- **pdsx** — record CRUD (create, update, delete), auth, batch operations
- **atproto-mcp** — search atproto docs, lexicon schemas, cookbook examples
- **pub-search** — search published writing across atmosphere platforms for prior art

## using the Bluesky public API

`public.api.bsky.app` is useful alongside Microcosm — especially for feeds, profiles, and content that Bluesky's AppView has already assembled.

**Works without auth:** `app.bsky.actor.getProfile`, `app.bsky.feed.getFeed`, `app.bsky.feed.getPostThread`, `app.bsky.feed.getPosts`, `app.bsky.unspecced.getPopularFeedGenerators`

**Requires auth or is heavily rate-limited:** `app.bsky.feed.searchPosts`, `app.bsky.feed.getTimeline`, `app.bsky.notification.*`

## API reference

For endpoint tables, parameter details, response shapes, and source format values across all Microcosm services, see [references/microcosm-api.md](references/microcosm-api.md).

## notes

- all Microcosm services are unauthenticated and support CORS — safe to call directly from client-side apps
- `public.api.bsky.app` also supports CORS
- for lexicons beyond `app.bsky.*`, use UFOs to discover what exists
- check each service's live docs for the latest API details
