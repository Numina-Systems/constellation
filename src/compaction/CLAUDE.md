# Compaction

Last verified: 2026-07-02

## Purpose
Compresses conversation history to stay within context budget. Replaces old messages with LLM-generated summaries archived to memory, producing a "clip-archive" system message that preserves earliest and most recent context while keeping the middle searchable via memory.

## Contracts
- **Exposes**: `Compactor` interface (`compress(history, conversationId) -> CompactionResult`, `consecutiveFailures`), `createCompactor(options)`, `chunkMessagesByTokenBudget()`, `SummaryBatch`, `CompactionResult` (includes optional `failed`), `CompactionConfig` (includes optional `timeout`, `maxRetries`, `backoffBaseMs`, `maxChunkTokens`, `maxConsecutiveFailures`), prompt builders (`buildSummarizationRequest`, `buildResummarizationRequest`, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_DIRECTIVE`)
- **Guarantees**:
  - `compress` never throws; pipeline failures return original history unchanged (with `failed: true`)
  - Circuit breaker: after `maxConsecutiveFailures` (default 3) consecutive failures, `compress` short-circuits without calling the model; resets on success
  - When `maxChunkTokens` is configured, chunks are split by token budget (minus summarization overhead: system prompt, prior summary, directive, max_tokens) instead of message count, preventing oversized requests from exceeding the model's context window
  - Summary batches are archived to memory (archival tier) with metadata headers before messages are deleted
  - Clip-archive shows first N and last N batches; omitted middle is searchable via `memory_read`
  - Recursive re-summarization triggers when batch count exceeds clip window + buffer, producing higher-depth batches
  - Messages to be compressed are a contiguous prefix of history (oldest first) and preserve original conversation order end-to-end — summarization prompts and batch start/end timestamps depend on it
  - Token estimation uses heuristic (1 token ~ 4 chars)
  - Summarisation calls use `ModelRequest.timeout` when `CompactionConfig.timeout` is set
  - On timeout or context-size errors, retry loop halves chunk size (floor: 2 messages) and token budget (floor: 100 tokens) up to `maxRetries` attempts (default 4). Exponential backoff applies on timeout; context-size retries skip backoff since the fix is smaller chunks, not waiting. Context-size errors are detected by `ModelError` code `CONTEXT_OVERFLOW` (thrown by the rate limiter for requests that can never fit its input window) or by message text (model reports request exceeds available context); both are treated as retryable even when marked non-retryable, because the compactor can recover by shrinking chunks. Non-ModelError exceptions throw immediately without retry
- **Expects**: `ModelProvider` for LLM summarization, `MemoryManager` for archival writes/reads, `PersistenceProvider` for message deletion, valid `CompactionConfig`

## Dependencies
- **Uses**: `src/model/` (LLM summarization calls), `src/memory/` (archival read/write/delete), `src/persistence/` (message table operations), `src/agent/types.ts` (`ConversationMessage`)
- **Used by**: `src/agent/` (via `Compactor` interface in `AgentDependencies`), `src/index.ts` (composition root)
- **Boundary**: Only the agent loop (or composition root) should construct a `Compactor`. This module never calls `ModelProvider.complete` outside of summarization.

## Key Decisions
- Independent chunk summarization: Messages chunked and each chunk summarized independently (no fold-in). Prior summary from previous compaction cycles is passed to the first chunk only. This prevents the accumulated summary from growing unboundedly and exceeding the summarization model's context window
- Structured summarization prompts: LLM calls use `ModelRequest.system` for system prompt and `ModelRequest.messages` with proper role context (system-role for prior summary, user/assistant for conversation, user for directive)
- Clip-archive over full replay: Only earliest + most recent batches injected into context; middle omitted but searchable
- Metadata headers in archival content: `[depth:N|start:ISO|end:ISO|count:M]` prefix enables batch reconstruction without extra DB columns
- Graceful degradation: Pipeline errors return original history, never corrupt conversation state
- Retry with chunk halving: On timeout, halve the chunk size and token budget and retry; smaller chunks are more likely to complete within the timeout window
- Token-budget chunking: When `maxChunkTokens` is set, messages are grouped by estimated token count instead of fixed message count, preventing oversized chunks that exceed the summarization model's context window
- Circuit breaker: Consecutive compaction failures are tracked; after the threshold is reached, further attempts are skipped to avoid wasting API calls on doomed requests

## Invariants
- Archived batch labels follow `compaction-batch-{conversationId}-{endTime.toISOString()}` format
- Re-summarized batches have `depth > 0`; fresh batches always have `depth: 0`
- Old messages are deleted from DB only after summaries are archived to memory
- Clip-archive system messages start with `[Context Summary`

## Key Files
- `types.ts` -- `Compactor`, `SummaryBatch`, `CompactionResult`, `CompactionConfig`
- `compactor.ts` -- Pipeline implementation, pure helpers, `splitHistory()` (chronological split with tool-pair adjustment), `chunkMessagesByTokenBudget()`, `createCompactor` factory (with circuit breaker state)
- `prompt.ts` -- Structured message builders for summarization and re-summarization LLM calls; exports `buildSummarizationRequest`, `buildResummarizationRequest`, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_DIRECTIVE`
- `index.ts` -- Barrel exports
