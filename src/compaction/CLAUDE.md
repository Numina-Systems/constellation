# Compaction

Last verified: 2026-02-28

## Purpose
Compresses conversation history to stay within context budget. Replaces old messages with LLM-generated summaries archived to memory, producing a "clip-archive" system message that preserves earliest and most recent context while keeping the middle searchable via memory.

## Contracts
- **Exposes**: `Compactor` interface (`compress(history, conversationId) -> CompactionResult`), `createCompactor(options)`, `SummaryBatch`, `CompactionResult`, `CompactionConfig`, prompt utilities (`interpolatePrompt`, `DEFAULT_SUMMARIZATION_PROMPT`)
- **Guarantees**:
  - `compress` never throws; pipeline failures return original history unchanged
  - Summary batches are archived to memory (archival tier) with metadata headers before messages are deleted
  - Clip-archive shows first N and last N batches; omitted middle is searchable via `memory_read`
  - Recursive re-summarization triggers when batch count exceeds clip window + buffer, producing higher-depth batches
  - Token estimation uses heuristic (1 token ~ 4 chars)
- **Expects**: `ModelProvider` for LLM summarization, `MemoryManager` for archival writes/reads, `PersistenceProvider` for message deletion, valid `CompactionConfig`

## Dependencies
- **Uses**: `src/model/` (LLM summarization calls), `src/memory/` (archival read/write/delete), `src/persistence/` (message table operations), `src/agent/types.ts` (`ConversationMessage`)
- **Used by**: `src/agent/` (via `Compactor` interface in `AgentDependencies`), `src/index.ts` (composition root)
- **Boundary**: Only the agent loop (or composition root) should construct a `Compactor`. This module never calls `ModelProvider.complete` outside of summarization.

## Key Decisions
- Chunk-and-fold summarization: Messages chunked, each chunk summarized with accumulated context from prior chunks
- Clip-archive over full replay: Only earliest + most recent batches injected into context; middle omitted but searchable
- Metadata headers in archival content: `[depth:N|start:ISO|end:ISO|count:M]` prefix enables batch reconstruction without extra DB columns
- Graceful degradation: Pipeline errors return original history, never corrupt conversation state

## Invariants
- Archived batch labels follow `compaction-batch-{conversationId}-{endTime.toISOString()}` format
- Re-summarized batches have `depth > 0`; fresh batches always have `depth: 0`
- Old messages are deleted from DB only after summaries are archived to memory
- Clip-archive system messages start with `[Context Summary`

## Key Files
- `types.ts` -- `Compactor`, `SummaryBatch`, `CompactionResult`, `CompactionConfig`
- `compactor.ts` -- Pipeline implementation, pure helpers, `createCompactor` factory
- `prompt.ts` -- Summarization prompt template and interpolation
- `index.ts` -- Barrel exports
