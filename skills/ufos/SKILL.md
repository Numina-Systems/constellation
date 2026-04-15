---
name: ufos
description: Query the UFOs API for AT Protocol lexicon timeseries statistics. Use when you need to discover what lexicons/apps exist in the network or track collection activity over time.
user-invocable: true
---

# ufos — lexicon timeseries stats

UFOs tracks every collection (lexicon) ever observed in the AT Protocol firehose with timeseries stats and sample records.

**Web explorer:** https://ufos.microcosm.blue
**API:** https://ufos-api.microcosm.blue
**Source:** https://github.com/at-microcosm/microcosm-rs/tree/main/ufos

Use it to discover what atproto apps exist beyond Bluesky, check if a lexicon is active, or understand what records look like in an unfamiliar collection. The web explorer is useful to suggest to users for interactive browsing.

## API endpoints

**List collections** — sorted by activity:
```bash
curl "https://ufos-api.microcosm.blue/collections?sort=dids-estimate&limit=20"
# sort options: "dids-estimate" (most users) or "records-created" (most records)
# returns {"collections":[{"nsid":"app.bsky.feed.post","creates":...,"updates":...,"deletes":...,"dids_estimate":...},...]}
```

The default sort is alphabetical, which returns junk/namespace-probing NSIDs. Always specify `sort=dids-estimate` or `sort=records-created`. Use `prefix=` to filter to a known namespace (e.g. `prefix=app.bsky`).

**Collection detail** — timeseries and sample records:
```bash
curl "https://ufos-api.microcosm.blue/collection/app.bsky.feed.post"
# returns stats, timeseries data, and sample records for the collection
```

**Search collections by prefix:**
```bash
curl "https://ufos-api.microcosm.blue/collections?prefix=app.bsky&sort=dids-estimate"
```
