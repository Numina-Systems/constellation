---
name: constellation
description: Query the Constellation global backlink index for AT Protocol. Use when you need to find who liked/reposted/quoted/replied to a record, count interactions, or query relationships between any atproto records.
user-invocable: true
---

# constellation — global backlink index

Indexes every link in the AT Protocol network. Answers "who interacted with this?" for any record.

**Live API docs (interactive):** https://constellation.microcosm.blue
**Source:** https://github.com/at-microcosm/microcosm-rs/tree/main/constellation

## the source format

All queries use `source` as `{collection}:{path}` (path omits leading dot):

| interaction | source |
|-------------|--------|
| likes | `app.bsky.feed.like:subject.uri` |
| reposts | `app.bsky.feed.repost:subject.uri` |
| follows | `app.bsky.graph.follow:subject` |
| replies | `app.bsky.feed.post:reply.parent.uri` |
| quotes | `app.bsky.feed.post:embed.record.uri` |

Works with any lexicon, not just Bluesky.

## endpoints

**Count interactions** — `getBacklinksCount`:
```bash
curl "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount?subject=at://did:plc:hdhoaan3xa3jiuq4fg4mefid/app.bsky.feed.post/3lwcmto4tck2h&source=app.bsky.feed.like:subject.uri"
# {"total":16}
```

**List who interacted** — `getBacklinks`:
```bash
curl "https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=at://did:plc:hdhoaan3xa3jiuq4fg4mefid/app.bsky.feed.post/3lwcmto4tck2h&source=app.bsky.feed.like:subject.uri&limit=5"
# {"total":16,"records":[{"did":"did:plc:...","collection":"app.bsky.feed.like","rkey":"3lwd..."},...], "cursor":"..."}
```

**Explore all link types** — `/links/all?target={did}`:
```bash
curl "https://constellation.microcosm.blue/links/all?target=did:plc:hdhoaan3xa3jiuq4fg4mefid"
# shows every collection+path linking to this DID with counts
```

**Distinct DIDs** — `/links/distinct-dids` (legacy; XRPC `getBacklinkDids` is in source but not yet deployed). Uses dot-prefixed paths (`.subject.uri`) and `target` param.

No batch endpoint — use parallel requests for multiple subjects.

## notes

- unauthenticated, default limit 100, max 1000, pagination via opaque hex `cursor`
- `subject` can be an AT-URI or bare DID
- check the live docs for the latest — the API is evolving
