---
name: spacedust
description: Connect to the Spacedust real-time interactions firehose for AT Protocol. Use when building live notifications, real-time counters, activity feeds, or any feature that needs to react to interactions as they happen.
user-invocable: true
---

# spacedust — real-time interactions firehose

Streams link events from the entire AT Protocol network over WebSocket with client-side filtering.

**Live docs:** https://spacedust.microcosm.blue
**Source:** https://github.com/at-microcosm/microcosm-rs/tree/main/spacedust

## connecting

```
wss://spacedust.microcosm.blue/subscribe?wantedSources=...&wantedSubjectDids=...
```

Sources use the same `collection:path` format as Constellation.

## filter params

| parameter | what it filters | max values |
|-----------|----------------|-----------|
| `wantedSubjects` | specific AT-URIs | 50,000 |
| `wantedSubjectDids` | DIDs (all interactions with their content) | 10,000 |
| `wantedSubjectPrefixes` | URI/DID prefixes | 100 |
| `wantedSources` | interaction types | 1,000 |
| `instant` | bypass 21-second delay buffer | boolean |

**Filter logic:** subject params are **OR**. Sources are **AND** with subjects. So `wantedSubjectDids=X&wantedSources=app.bsky.feed.like:subject.uri` = "likes on X's content."

## message format

```json
{"kind":"link","origin":"live","link":{"operation":"create","source":"app.bsky.feed.like:subject.uri","source_record":"at://did:plc:.../app.bsky.feed.like/3lv4ouczo2b2a","subject":"at://did:plc:.../app.bsky.feed.post/3lgwdn7vd722r"}}
```

`operation` is `create` or `delete`.

## dynamic filter updates

Send JSON on the open connection to replace filters without reconnecting:

```json
{"type": "options_update", "payload": {"wantedSubjectDids": ["did:plc:..."], "wantedSources": ["app.bsky.graph.follow:subject"]}}
```

## quick start

```bash
# watch for new followers of bsky.app
websocat "wss://spacedust.microcosm.blue/subscribe?wantedSources=app.bsky.graph.follow:subject&wantedSubjectDids=did:plc:z72i7hdynmk6r22z27h6tvur"
```

## notes

- events are buffered 21 seconds to filter quickly-undone interactions; `instant=true` bypasses this
- unauthenticated, no API key needed
