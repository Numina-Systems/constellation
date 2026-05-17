# Ingest

Last verified: 2026-05-17

## Purpose
Ingests workspace files into archival memory as semantically chunked, embedding-enriched memory blocks. Enables the agent to build a searchable knowledge base from local documents.

## Contracts
- **Exposes**: `chunkDocument(text, options?) -> Chunk[]` (Functional Core), `validateIngestPath(filePath, workspaceRoot) -> ValidationResult`, `validateFileSize(size, filePath) -> FileSizeResult`, `createIngestor(deps) -> Ingestor`, `Ingestor` interface (`ingest(filePath) -> IngestResult`)
- **Guarantees**: Paths are validated against workspace root (no traversal). File size capped at 1MB. Markdown documents are chunked on heading boundaries with heading hierarchy preserved as context. Plain text splits on paragraph boundaries. Re-ingesting the same file atomically replaces old chunks (transaction). Chunks are stored as `archival` tier memory blocks with label prefix `knowledge:<filename>`.
- **Expects**: `MemoryStore`, `EmbeddingProvider`, `PersistenceProvider`. Workspace root path for path validation. Owner string for memory block ownership.

## Dependencies
- **Uses**: `src/memory/` (MemoryStore for block CRUD), `src/embedding/` (EmbeddingProvider for batch embedding), `src/persistence/` (transaction support)
- **Used by**: `src/tool/builtin/ingest.ts` (ingest_file tool), `src/index.ts` (composition root wiring)
- **Boundary**: This module handles file reading and chunking. It does not perform search -- that is `src/search/`.

## Key Decisions
- Heading-aware chunking: Markdown headings define chunk boundaries with ancestor headings preserved as context, producing semantically coherent chunks
- Atomic re-ingestion: Delete-then-create in a transaction prevents partial state
- Label prefix convention: `knowledge:<filename>:<index>` enables targeted cleanup on re-ingest

## Invariants
- File paths must resolve within workspace root (path traversal rejected)
- Maximum file size: 1MB
- Empty files produce no chunks (returns error)
- Default chunk size target: ~1500 tokens

## Key Files
- `chunker.ts` -- Markdown-aware document chunking (Functional Core)
- `validate.ts` -- Path and size validation (Functional Core)
- `ingest.ts` -- Ingestor orchestrator (Imperative Shell)
