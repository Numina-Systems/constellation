---
name: atproto
description: Orientation for the AT Protocol. Use this skill whenever the task involves AT Protocol, atproto, Bluesky, decentralized social, or any work with DIDs, AT-URIs, lexicons, or PDS records.
user-invocable: true
---

# atproto — building on the AT Protocol

## the mental model

Users own **repositories** of JSON records, identified by a permanent **DID** and a human-readable **handle** (a DNS name). Records are organized into **collections** defined by **lexicon** schemas (e.g. `app.bsky.feed.post`). A user's **PDS** (Personal Data Server) hosts their repo, handles auth, and syncs changes to **relays**, which produce a firehose of events. **AppViews** consume that firehose to build products — feeds, search, notifications. Identity is location-independent: a DID resolves to the current PDS, so users can migrate without losing their data or social graph.

For deeper grounding: https://atproto.com/guides/understanding-atproto

## what's available to you

### Writing (posts, replies, likes)

Use `execute_code` with `@atproto/api` in the Deno sandbox. Your Bluesky credentials are pre-injected as constants. See the `bluesky-posting` skill for full details on facets, embeds, and threading.

### Reading records and resolving identities

Use `web_fetch` to hit the **Microcosm services** — free, unauthenticated HTTP APIs that index the entire AT Protocol network:

**Slingshot** — fast record fetching and identity resolution:
```
https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier={handle_or_did}
https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord?repo={did}&collection={nsid}&rkey={rkey}
https://slingshot.microcosm.blue/xrpc/com.atproto.identity.resolveHandle?handle={handle}
```

**Constellation** — backlink index (who liked/reposted/replied/quoted a record):
```
https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount?subject={at_uri}&source={collection}:{path}
https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject={at_uri}&source={collection}:{path}&limit=10
```

Common source patterns:
- Likes: `app.bsky.feed.like:subject.uri`
- Reposts: `app.bsky.feed.repost:subject.uri`
- Replies: `app.bsky.feed.post:reply.parent.uri`
- Quotes: `app.bsky.feed.post:embed.record.uri`
- Follows: `app.bsky.graph.follow:subject`

### Looking up lexicon schemas

Use `web_fetch` to query **Lexicon Garden** — a public lexicon browser with an API:
```
https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid={collection_nsid}
```

Returns the full JSON schema definition for any collection. Use this when you need to understand a record's structure, required fields, or valid values before creating or interpreting records.

### When to use what

| Task | Tool | Service |
|------|------|---------|
| Post, reply, like | `execute_code` | @atproto/api (sandbox) |
| Resolve handle → DID | `web_fetch` | Slingshot |
| Fetch a public record | `web_fetch` | Slingshot |
| Count likes/reposts/replies | `web_fetch` | Constellation |
| List who interacted | `web_fetch` | Constellation |
| Look up a lexicon schema | `web_fetch` | Lexicon Garden |

## key concepts

**AT-URI format:** `at://{did}/{collection}/{rkey}`
- Example: `at://did:plc:xyz/app.bsky.feed.post/3lwcmto4tck2h`

**StrongRef:** A pair of `{uri, cid}` that uniquely identifies a record version. Used in replies, quotes, and likes.

**Collections** are namespaced like Java packages: `app.bsky.feed.post`, `app.bsky.actor.profile`, `app.bsky.graph.follow`.
