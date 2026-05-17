# Archivist

Last verified: 2026-05-17

## Purpose
Maintains memory health through a six-stage pipeline that deduplicates, consolidates, cross-references, prunes, and reflects on the agent's memory blocks. Runs as a scheduled sleep task during the circadian cycle.

## Contracts
- **Exposes**: `ArchivistPipeline` interface (`runIncremental()`, `runFull()`), `createArchivistPipeline(deps)`, `ArchivistPipelineDeps` type, all stage result types (`ScanResult`, `DedupResult`, `ConsolidateResult`, `CrossrefResult`, `PruneResult`, `ReflectResult`, `PipelineResult`, `PipelineMode`)
- **Guarantees**: Incremental mode (scan, dedup, prune) uses no LLM calls. Full mode runs all six stages with a configurable token budget. Pipeline short-circuits when no blocks have changed since last run (state tracked via `archivist:state` memory block). Each stage catches its own errors and continues (graceful degradation). Consolidation actions are transactional. Reflection is written to `archivist:reflection` working memory block.
- **Expects**: `MemoryStore`, `MemoryManager`, `PersistenceProvider`. Optional `EmbeddingProvider` (dedup/crossref skip without it). Optional `ModelProvider` (consolidate/reflect skip without it). Owner string and model name for LLM calls. Configurable thresholds: `dedupThreshold` (cosine similarity), `crossrefThreshold`, `tokenBudget`.

## Dependencies
- **Uses**: `src/memory/` (MemoryStore + MemoryManager for block CRUD and writes), `src/embedding/` (optional, for re-embedding merged content), `src/model/` (optional, for consolidation summarization and reflection), `src/persistence/` (transaction support)
- **Used by**: `src/activity/sleep-events.ts` (buildArchivistEvent), `src/index.ts` (composition root wiring, scheduled task handlers)
- **Boundary**: This module operates on memory blocks only. It does not interact with conversations, tools, or the agent loop directly.

## Pipeline Stages
1. **Scan** -- Snapshot all mutable (non-core, non-pinned) blocks with content hashes
2. **Dedup** -- Find near-duplicate groups via cosine similarity on embeddings
3. **Consolidate** -- LLM-merge duplicate groups into single blocks (full mode only)
4. **Crossref** -- Append `[Related: ...]` labels to blocks with high embedding similarity
5. **Prune** -- Remove empty/whitespace-only blocks
6. **Reflect** -- LLM-generate a reflection on pipeline results (full mode only)

## Key Decisions
- Two modes: Incremental runs frequently (every 3h default) with zero LLM cost; full runs during sleep with bounded token budget
- State tracking via memory block: `archivist:state` stores content hashes to detect changes between runs
- Graceful degradation: Each stage wraps in try/catch so a single stage failure doesn't abort the pipeline
- Cosine similarity for dedup: Leverages existing embeddings rather than requiring additional LLM calls

## Invariants
- Pipeline never modifies core-tier or pinned memory blocks (scan filters them out)
- Token budget is respected across consolidate + reflect stages
- Consolidation is transactional (merged block created + duplicates deleted atomically)
- State snapshot updated at end of every run (incremental or full)

## Key Files
- `types.ts` -- All pipeline stage types (Functional Core)
- `pipeline.ts` -- Pipeline orchestrator (Imperative Shell)
- `stages/scan.ts` -- Block snapshot with content hashing
- `stages/dedup.ts` -- Cosine similarity deduplication
- `stages/consolidate.ts` -- LLM-powered merge
- `stages/crossref.ts` -- Embedding-based cross-referencing
- `stages/prune.ts` -- Empty block removal
- `stages/reflect.ts` -- LLM-generated pipeline reflection
