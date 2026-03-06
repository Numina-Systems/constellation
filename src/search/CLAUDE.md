# Search

Last verified: 2026-03-05

## Purpose
Unified search abstraction supporting multiple search modes (semantic, keyword, hybrid) and pluggable search domains (memory, conversations). Implements Reciprocal Rank Fusion (RRF) for merging results from multiple sources.

## Contracts
- **Exposes**: `SearchStore` port interface (`search`, `registerDomain`), `createSearchStore(embeddingProvider)`, `createMemorySearchDomain(persistence, owner)`, `createConversationSearchDomain(persistence)`, `mergeWithRRF(domainLists, k?)`, `SearchDomain` interface, `SearchMode` type union, all search-related types
- **Guarantees**:
  - `search()` accepts params scoped to specific domains
  - `registerDomain()` allows plugins to provide search implementations; throws on duplicate domain names
  - Hybrid search merges results via RRF when multiple modes contribute
  - Embedding generation failure in `createSearchStore` gracefully degrades semantic/hybrid to keyword-only
  - Results include domain-specific metadata (tier, label, role, conversationId)
- **Expects**: Domains implement `SearchDomain` interface with async `search(params)` method. `EmbeddingProvider` injected for semantic search. `PersistenceProvider` injected for built-in domains.

## Dependencies
- **Uses**: `src/embedding/` (for query embeddings in SearchStore), `src/persistence/` (for built-in domain SQL queries)
- **Used by**: `src/tool/builtin/search.ts` (search tool), `src/index.ts` (composition root wiring)
- **Boundary**: SearchStore is the port; `postgres-store.ts` is the adapter. Domains are pluggable via `registerDomain()`.

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
- `postgres-store.ts` -- SearchStore adapter (coordinates domains, generates embeddings, applies RRF + limit)
- `rrf.ts` -- Reciprocal Rank Fusion merge (pure function)
- `domains/memory.ts` -- Memory block search domain (keyword, semantic, hybrid SQL)
- `domains/conversations.ts` -- Conversation message search domain (keyword, semantic, hybrid SQL)
