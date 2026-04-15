---
name: slingshot
description: Use the Slingshot edge cache for fast AT Protocol record fetching and identity resolution. Use when you need to hydrate AT-URIs into full records, resolve handles to DIDs, or get identity details quickly.
user-invocable: true
---

# slingshot — edge record and identity cache

Fast cache of atproto records and identities, pre-warmed from the firehose. Use instead of hitting individual PDS instances for reads.

**Live API docs (interactive, OpenAPI spec):** https://slingshot.microcosm.blue
**Source:** https://github.com/at-microcosm/microcosm-rs/tree/main/slingshot

## endpoints

**Resolve identity** — DID, handle, PDS URL, signing key in one call:
```bash
curl "https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=zzstoatzz.io"
```

**Fetch record by AT-URI:**
```bash
curl "https://slingshot.microcosm.blue/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=at://did:plc:.../app.bsky.actor.profile/self"
```

**Fetch record (standard atproto API)** — `repo` accepts handles or DIDs:
```bash
curl "https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord?repo=did:plc:xbtmt2zjwlrfegqvch7fboei&collection=app.bsky.actor.profile&rkey=self"
# {"uri":"at://...","cid":"bafy...","value":{...}}
```

**Resolve handle to DID only:**
```bash
curl "https://slingshot.microcosm.blue/xrpc/com.atproto.identity.resolveHandle?handle=zzstoatzz.io"
# {"did":"did:plc:xbtmt2zjwlrfegqvch7fboei"}
```

## when to use slingshot vs PDS directly

- **slingshot**: reading public records, resolving identities, hydrating Constellation results
- **PDS directly**: writing records, `listRecords` (not supported by Slingshot — get the PDS URL from `resolveMiniDoc`)
- **pdsx**: CRUD operations, authenticated actions

## notes

- unauthenticated
- `com.bad-example.*` namespace is migrating to `blue.microcosm.*` — both work, prefer new
- check the live API docs for the latest endpoints
