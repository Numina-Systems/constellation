# microcosm API quick reference

Consolidated endpoint reference for all Microcosm services. All services are unauthenticated and support CORS.

## slingshot — identity and record cache

Base: `https://slingshot.microcosm.blue`

| endpoint | method | params | returns |
|----------|--------|--------|---------|
| `/xrpc/blue.microcosm.identity.resolveMiniDoc` | GET | `identifier` (handle or DID) | `{did, handle, pds, signing_key}` |
| `/xrpc/blue.microcosm.repo.getRecordByUri` | GET | `at_uri` | `{uri, cid, value}` |
| `/xrpc/com.atproto.repo.getRecord` | GET | `repo`, `collection`, `rkey` | `{uri, cid, value}` |
| `/xrpc/com.atproto.identity.resolveHandle` | GET | `handle` | `{did}` |

`repo` accepts handles or DIDs. `listRecords` is not supported — use the user's PDS directly (get URL from `resolveMiniDoc`).

## constellation — backlink index

Base: `https://constellation.microcosm.blue`

| endpoint | method | params | returns |
|----------|--------|--------|---------|
| `/xrpc/blue.microcosm.links.getBacklinksCount` | GET | `subject`, `source` | `{total}` |
| `/xrpc/blue.microcosm.links.getBacklinks` | GET | `subject`, `source`, `limit`, `cursor` | `{total, records: [{did, collection, rkey}], cursor}` |
| `/links/all` | GET | `target` (DID) | all collection+path combos linking to this DID with counts |
| `/links/distinct-dids` | GET | `target`, `source` (dot-prefixed: `.subject.uri`) | distinct DIDs |

- `subject`: AT-URI or bare DID
- `source` format: `{collection}:{path}` (path omits leading dot)
- default limit 100, max 1000, pagination via opaque hex `cursor`

### common source values

| interaction | source |
|-------------|--------|
| likes | `app.bsky.feed.like:subject.uri` |
| reposts | `app.bsky.feed.repost:subject.uri` |
| follows | `app.bsky.graph.follow:subject` |
| replies | `app.bsky.feed.post:reply.parent.uri` |
| quotes | `app.bsky.feed.post:embed.record.uri` |

Works with any lexicon, not just Bluesky.

## spacedust — real-time firehose

Base: `wss://spacedust.microcosm.blue`

**Connect:** `wss://spacedust.microcosm.blue/subscribe?wantedSources=...&wantedSubjectDids=...`

Sources use the same `collection:path` format as Constellation.

| param | filters | max values |
|-------|---------|-----------|
| `wantedSubjects` | specific AT-URIs | 50,000 |
| `wantedSubjectDids` | DIDs (all interactions with their content) | 10,000 |
| `wantedSubjectPrefixes` | URI/DID prefixes | 100 |
| `wantedSources` | interaction types | 1,000 |
| `instant` | bypass 21-second delay buffer | boolean |

**Filter logic:** subject params are OR'd together. Sources are AND'd with subjects.

**Message format:**
```json
{"kind":"link","origin":"live","link":{"operation":"create","source":"app.bsky.feed.like:subject.uri","source_record":"at://did:plc:.../app.bsky.feed.like/3lv...","subject":"at://did:plc:.../app.bsky.feed.post/3lg..."}}
```

**Dynamic filter updates** — send on open connection:
```json
{"type": "options_update", "payload": {"wantedSubjectDids": ["did:plc:..."], "wantedSources": ["app.bsky.graph.follow:subject"]}}
```

## ufos — lexicon stats

Base: `https://ufos-api.microcosm.blue`

| endpoint | method | params | returns |
|----------|--------|--------|---------|
| `/collections` | GET | `sort`, `limit`, `prefix` | `{collections: [{nsid, creates, updates, deletes, dids_estimate}]}` |
| `/collection/{nsid}` | GET | — | stats, timeseries, sample records |

- `sort`: `dids-estimate` (most users) or `records-created` (most records). Default is alphabetical (useless — returns junk NSIDs).
- `prefix`: filter by namespace, e.g. `prefix=app.bsky`
