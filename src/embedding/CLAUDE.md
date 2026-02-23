# Embedding

Last verified: 2026-02-23

## Purpose
Abstracts embedding providers behind a unified `EmbeddingProvider` port for semantic search in the memory system.

## Contracts
- **Exposes**: `EmbeddingProvider` interface (`embed`, `embedBatch`, `dimensions`), `createEmbeddingProvider(config)`, OpenAI and Ollama adapters
- **Guarantees**: `embed` returns a vector of length `dimensions`. `embedBatch` processes multiple texts in one call where supported.
- **Expects**: Configured endpoint accessible. API key if required by provider.

## Dependencies
- **Uses**: `openai` SDK (for OpenAI adapter), HTTP fetch (for Ollama adapter), `src/config/`
- **Used by**: `src/memory/` (MemoryManager, postgres-store seeding), `src/index.ts` (core memory seeding)
- **Boundary**: Only memory-related code should use embedding providers directly.

## Key Decisions
- Ollama via raw HTTP: Avoids SDK dependency for a simple POST endpoint
- `dimensions` on interface: Callers know vector size without calling embed first

## Key Files
- `types.ts` -- `EmbeddingProvider` port interface
- `openai.ts` -- OpenAI embeddings adapter
- `ollama.ts` -- Ollama embeddings adapter
- `factory.ts` -- Config-driven provider creation
