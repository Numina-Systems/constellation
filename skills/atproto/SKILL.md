---
name: atproto
description: Orientation for building on the AT Protocol. Use this skill whenever the task involves AT Protocol, atproto, Bluesky, decentralized social, or any app that reads/writes atproto records. Even if the user doesn't mention it explicitly, use this skill if they're working with DIDs, AT-URIs, lexicons, or PDS records.
user-invocable: true
---

# atproto — building on the AT Protocol

## the mental model

Users own **repositories** of JSON records, identified by a permanent **DID** and a human-readable **handle** (a DNS name). Records are organized into **collections** defined by **lexicon** schemas (e.g. `app.bsky.feed.post`). A user's **PDS** (Personal Data Server) hosts their repo, handles auth, and syncs changes to **relays**, which produce a firehose of events. **AppViews** consume that firehose to build products — feeds, search, notifications. Identity is location-independent: a DID resolves to the current PDS, so users can migrate without losing their data or social graph.

For deeper grounding: https://atproto.com/guides/understanding-atproto

## what's available to you

This plugin gives you several complementary tools. Use what fits the task.

**Microcosm services** — free, unauthenticated infrastructure that indexes the entire AT Protocol network (not just Bluesky):

- **Slingshot** — fast record fetching and identity resolution. Invoke `/protopack:slingshot`.
- **Constellation** — backlink index for engagement data (likes, reposts, follows, replies). Invoke `/protopack:constellation`.
- **Spacedust** — real-time WebSocket firehose of interactions. Invoke `/protopack:spacedust`.
- **UFOs** — discover what lexicons/apps exist in the network. Invoke `/protopack:ufos`.

**MCP tools** — available directly in your tool list:

- **pdsx** — AT Protocol record CRUD (list, get, create, update, delete)
- **atproto-mcp** — search atproto docs, lexicon schemas, cookbook examples (search_atproto_docs, get_lexicon, etc.)
- **pub-search** — search published writing across Leaflet, Whitewind, and other atmosphere platforms. Invoke `/protopack:pub-search`.

**Deployment:**

- **wisp.place** — deploy static sites to the AT Protocol. Invoke `/protopack:wisp`.

## combining services

Invoke `/protopack:app-patterns` for common patterns — e.g. using Constellation for historical data + Slingshot to hydrate records + Spacedust for live updates.
