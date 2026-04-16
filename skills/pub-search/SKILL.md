---
name: pub-search
description: Search published writing across AT Protocol platforms (Leaflet, Whitewind, Pckt, Offprint, Greengale). Use when researching prior art, finding tutorials, looking up how others have built things, or discovering announcements and writeups in the atmosphere.
user-invocable: true
---

# pub-search — search the atmosphere's published writing

Indexes content from Leaflet, Whitewind, Pckt, Offprint, Greengale, and other standard.site publishers. Use it to find prior art when building on atproto.

## MCP tools

Available directly via the bundled MCP server:

| tool | what it does |
|------|-------------|
| `search` | keyword search with BM25 ranking (~9ms) |
| `search_semantic` | meaning-based vector search — finds related content without keyword overlap (~350ms) |
| `search_hybrid` | combines both via reciprocal rank fusion — best default for research |
| `get_document` | fetch full text by AT-URI |
| `find_similar` | find related documents to a given URI |
| `get_tags` | list all tags with counts |
| `get_stats` | index statistics |

## choosing a search mode

- **keyword**: fast, use when you know the terms
- **semantic**: slower, finds conceptually related content even without matching words
- **hybrid**: best for research — catches both exact and related matches

## filters

`platform`, `tag`, `since` (ISO date), `limit` — available on keyword search. Semantic and hybrid support `platform` and `limit`.

## research workflow

1. `search_hybrid` for the concept
2. `get_document` on the best results to read full text
3. `find_similar` to expand from a good result
