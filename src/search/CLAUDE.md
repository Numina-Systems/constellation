# Search

Last verified: 2026-03-05

## Purpose
Unified search abstraction supporting multiple search modes (semantic, keyword, hybrid) and pluggable search domains (memory, conversations). Implements Reciprocal Rank Fusion (RRF) for merging results from multiple sources.

## Contracts
- **Exposes**: `SearchStore` port interface (search, registerDomain), `SearchDomain` interface, `SearchMode` type union, all search-related types
- **Guarantees**:
  - `search()` accepts params scoped to specific domains
  - `registerDomain()` allows plugins to provide search implementations
  - Hybrid search merges results via RRF when multiple modes contribute
  - Results include domain-specific metadata (tier, label, role, conversationId)
- **Expects**: Domains implement `SearchDomain` interface with async `search(params)` method. Embeddings available for semantic search.

## Dependencies
- **Uses**: `src/embedding/` (for semantic search query embeddings), domain implementations
- **Used by**: `src/tool/builtin/search.ts`, future conversation search domain, memory search domain
- **Boundary**: SearchStore is the port; implementations are adapters (PostgreSQL-backed, memory-backed, etc.).

## Key Decisions
- Port-first architecture: SearchStore interface defined before any implementations
- Domain-pluggable: Domains register at startup; SearchStore coordinates multi-domain searches
- RRF for rank merging: Standard algorithm for combining heterogeneous search results
- Owner-scoped: All searches inherit owner context from agent/session
- Metadata-rich results: Each result carries domain-specific context (tier, role, conversationId)

## Invariants
- SearchDomain.name must be unique (enforced by registry)
- SearchParams and DomainSearchParams share same shape (domains ignore irrelevant filters)
- Score is normalized per domain before RRF merge
- Results are always sorted by RRF score descending

## Key Files
- `types.ts` -- SearchMode, SearchDomainName, SearchParams, DomainSearchParams, SearchResult, SearchDomain
- `store.ts` -- SearchStore port interface
