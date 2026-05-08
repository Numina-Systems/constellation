# Recall

Last verified: 2026-05-07

## Purpose
Provides reflexive recall: automatically retrieves relevant context from memory and conversations before each agent turn. Decomposes user messages into semantic queries and entity lookups, retrieves across all search domains, and injects recalled fragments into the system prompt.

## Contracts
- **Exposes**: `performRecall(message, deps) -> RecallResult | null`, `createRecallContextProvider() -> ContextProvider & RecallContextState`, `formatRecallSection(result) -> string`, `decomposeMessage(message, model, modelName) -> DecompositionResult`, `retrieveContext(options) -> RecallResult`, `parseDecompositionResponse(text) -> DecompositionResult`, `RecallDeps`, `RetrieveOptions`, `RecallContextState`, `DecompositionResult`, `RecallFragment`, `RecallResult`
- **Guarantees**:
  - `performRecall` returns null if embedding provider is absent, message is too short (<10 chars), or retrieval produces no fragments
  - Decomposition falls back to raw message as query when model is unavailable or returns empty results
  - Retrieval respects `tokenBudget` and excludes core memory labels to avoid duplication
  - Context provider returns undefined (skips injection) when no result is set or fragments are empty
  - Trace recording is fire-and-forget and only fires when traceRecorder, owner, and conversationId are all present
- **Expects**: `SearchStore` for retrieval, optional `EmbeddingProvider` (required for recall to fire), optional `ModelProvider` + model name for decomposition, optional `TraceRecorder` for tracing

## Dependencies
- **Uses**: `src/search/` (SearchStore for hybrid search), `src/model/` (optional, decomposition LLM calls), `src/embedding/` (optional, guard condition), `src/reflexion/` (optional, trace recording), `src/agent/types.ts` (ContextProvider type)
- **Used by**: `src/agent/` (agent loop calls performRecall once per turn, uses context provider for prompt injection), `src/index.ts` (composition root wires deps)
- **Boundary**: Does not call `ModelProvider.complete` for the main conversation -- only for decomposition via a separate summarization model

## Key Decisions
- Decomposition before retrieval: LLM extracts focused queries and entities rather than searching raw user message, improving precision
- Fallback cascade: model unavailable -> use raw message; decomposition empty -> use raw message; no embeddings -> skip entirely
- Token budget enforcement: retrieval stops adding fragments when budget is exhausted
- Core label exclusion: fragments matching core memory labels are filtered to avoid duplicating content already in system prompt
- Once-per-turn caching: agent caches recall result across tool rounds so decomposition + retrieval runs only once per user message

## Invariants
- `performRecall` never throws; guard conditions return null gracefully
- Fragment scores are always in [0, 1] range
- Total tokens in result never exceed the configured budget

## Key Files
- `types.ts` -- `DecompositionResult`, `RecallFragment`, `RecallResult`
- `decompose.ts` -- Pure parser for decomposition response format
- `decomposer.ts` -- LLM-based message decomposition (Imperative Shell)
- `retrieve.ts` -- Multi-query retrieval with dedup, budget enforcement, core label filtering
- `orchestrator.ts` -- Pipeline coordinator: guards, decomposition, retrieval, tracing
- `context.ts` -- Context provider factory and section formatter
