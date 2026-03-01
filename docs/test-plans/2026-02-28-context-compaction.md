# Context Compaction — Human Test Plan

Generated: 2026-02-28
Coverage validation: PASS (31/31 acceptance criteria covered by automated tests)

## Prerequisites

- PostgreSQL running with pgvector extension: `docker compose up -d`
- Ollama running at `192.168.1.6:11434` (or `OLLAMA_ENDPOINT` env var set)
- Database migrated: `bun run migrate`
- All automated tests passing: `bun test`
- Build clean: `bun run build`

## Phase 1: Basic Compaction Flow

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Start the daemon with `bun run start` and a `config.toml` that includes a `[summarization]` block pointing to Ollama (e.g., `provider = "openai-compat"`, `name = "qwen3:1.7b"`, `base_url = "http://192.168.1.6:11434/v1"`) | REPL starts without errors |
| 1.2 | Send 15+ messages to the agent, covering at least 3 distinct topics (e.g., database indexing, authentication, deployment). Each message should be 2-3 sentences to ensure token budget is exceeded | Agent responds to each message normally |
| 1.3 | Wait for automatic compaction to trigger (the agent's context budget at 80% of model window should be reached), or manually call `compact_context` if the agent has tool use | A system-level `[Context Summary` message appears in the conversation context. The REPL may log compaction stats |
| 1.4 | Ask the agent "What have we discussed so far?" | The agent should reference topics from earlier messages, even those that were compressed, drawing from the clip-archive and/or memory_read |
| 1.5 | Inspect the agent's response and internal context for the clip-archive system message | The message should start with `[Context Summary`, have `## Earliest context` and `## Recent context` sections, and batch markers like `[Batch 1 -- depth 0, ...]` |

## Phase 2: Semantic Retrieval via Memory

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | After compaction in Phase 1, ask the agent to use `memory_read` to search for a specific topic discussed early in the conversation (e.g., "database indexing") | The agent calls `memory_read` and the results should include one or more `compaction-batch-*` blocks whose content is relevant to the query |
| 2.2 | Examine the returned memory blocks | Block labels follow `compaction-batch-{conversationId}-{ISO timestamp}` format. Content is a meaningful summary, not gibberish |
| 2.3 | Search for a topic NOT discussed in the conversation (e.g., "quantum computing") | No compaction batch blocks should appear in results (or rank low in similarity) |

## Phase 3: compact_context Tool

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Start a fresh conversation with 5+ messages (below the auto-compaction threshold) | Agent responds normally, no compaction triggers |
| 3.2 | Ask the agent to call `compact_context` (e.g., "Please compress your context now") | The agent calls `compact_context`. Tool result shows `messagesCompressed: 0` or very low numbers since history is short. Stats show `batchesCreated: 0` if under `keepRecent` |
| 3.3 | Continue the conversation with 15+ additional messages to exceed the budget | Agent continues responding |
| 3.4 | Ask the agent to call `compact_context` again | Tool result shows `messagesCompressed > 0`, `batchesCreated > 0`, and `tokensEstimateBefore > tokensEstimateAfter` |
| 3.5 | Immediately ask a follow-up question referencing a topic from the compressed messages | Agent can still answer, drawing from clip-archive or `memory_read` |

## Phase 4: Fallback to Main Model

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Edit `config.toml` to remove the entire `[summarization]` section | Config file has no `[summarization]` block |
| 4.2 | Start the daemon with `bun run start` | Daemon starts without config validation errors |
| 4.3 | Send enough messages to trigger compaction (15+ messages or call `compact_context`) | Compaction succeeds using the main model provider. Check logs for summarization calls going to the main provider endpoint |
| 4.4 | Verify the clip-archive system message is present and properly formatted | `[Context Summary` header, section headers, batch markers all present |

## End-to-End: Full Lifecycle (Compaction -> Re-summarization -> Retrieval)

**Purpose:** Validate that multiple compaction cycles produce progressively deeper batches and that the full archive remains searchable.

| Step | Action | Expected |
|------|--------|----------|
| E2E.1 | Start a fresh session with a summarization config using small `chunk_size: 3`, `keep_recent: 2`, `clip_first: 1`, `clip_last: 1` | Daemon starts |
| E2E.2 | Send 30+ messages across varied topics | Agent responds normally |
| E2E.3 | Trigger compaction (auto or `compact_context`) | First compaction produces depth-0 batches |
| E2E.4 | Send 20+ more messages | Agent responds normally |
| E2E.5 | Trigger compaction again | Second compaction produces more depth-0 batches. If total batches exceed `clip_first + clip_last + buffer`, re-summarization triggers, producing depth-1 batches |
| E2E.6 | Inspect the clip-archive system message | Should show earliest and most recent batches. If batches were omitted, an omission hint with `memory_read` reference should be visible |
| E2E.7 | Use `memory_read` to search for a topic from the very first batch of messages | Relevant summary batch should be returned, even though those messages were compressed long ago |
| E2E.8 | Check that batch labels in archival memory show a mix of depths | Some blocks at depth-0, some at depth-1 (or higher) |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC4.3 (full semantic search) | Integration tests use mock embeddings that cannot validate real vector similarity ranking. True semantic retrieval requires real embedding vectors from a running provider. | After compaction (Phase 2 above), use `memory_read` to search for a topic mentioned only in compressed messages. Confirm the search returns relevant summary batches ranked above unrelated content. |
| AC1.3 (fold-in quality) | Unit tests verify structural fold-in (each call receives prior summary) but cannot assess whether the LLM actually preserves context across chunks. | After integration test with Ollama, read the archived summary batches manually. Confirm that later summaries reference or incorporate information from earlier ones (e.g., a decision from chunk 1 is still reflected in the summary for chunk 3). |
| AC5.3 (end-to-end mid-turn compaction) | Unit test mocks the compactor, so it verifies history replacement mechanics but not whether a real model produces meaningfully different output after mid-turn compaction. | Run the daemon, have a long conversation exceeding context budget, ask the agent to call `compact_context`, then issue a follow-up referencing earlier context. Confirm the agent can still access key information via clip-archive or `memory_read`. (Phase 3, steps 3.4-3.5) |
| AC3.1/AC3.2 (readability) | Automated tests verify structural correctness (sections present, omission count) but not whether the clip-archive is readable and useful to the agent. | During a real session, trigger compaction and inspect the system message injected into the conversation. Confirm the format is clear, chronological flow makes sense, and the omission hint is actionable. (Phase 1, step 1.5) |
| AC6.5 (runtime fallback) | Build-time verification confirms the schema allows absent `[summarization]`. Runtime fallback requires actually running the daemon without the section. | Phase 4 above: start daemon with no `[summarization]` in `config.toml`, trigger compaction, confirm it succeeds using the main model. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `compactor.test.ts` (line 610), `compaction.test.ts` (line 159) | Phase 1 (1.3) |
| AC1.2 | `compactor.test.ts` (line 214) | -- |
| AC1.3 | `compactor.test.ts` (line 644) | Phase 1 (1.5), Human Verification (fold-in quality) |
| AC1.4 | `compactor.test.ts` (line 687) | Phase 1 (1.5) |
| AC1.5 | `compactor.test.ts` (line 743) | -- |
| AC1.6 | `compactor.test.ts` (line 143) | -- |
| AC1.7 | `compactor.test.ts` (line 778) | -- |
| AC1.8 | `compactor.test.ts` (line 823), `compaction.test.ts` (line 159) | Phase 1 (1.3) |
| AC2.1 | `compactor.test.ts` (line 1167) | E2E (E2E.5) |
| AC2.2 | `compactor.test.ts` (line 1199) | E2E (E2E.8) |
| AC2.3 | `compactor.test.ts` (line 1244) | E2E (E2E.5) |
| AC2.4 | `compactor.test.ts` (line 971, 1284) | E2E (E2E.5, E2E.8) |
| AC3.1 | `compactor.test.ts` (line 303) | Phase 1 (1.5), Human Verification (readability) |
| AC3.2 | `compactor.test.ts` (line 333) | E2E (E2E.6) |
| AC3.3 | `compactor.test.ts` (line 718), `compaction.test.ts` (line 285) | Phase 1 (1.5) |
| AC3.4 | `compactor.test.ts` (line 357) | -- |
| AC4.1 | `compactor.test.ts` (line 858), `compaction.test.ts` (line 209) | Phase 2 (2.2) |
| AC4.2 | `compactor.test.ts` (line 894), `compaction.test.ts` (line 229) | Phase 2 (2.2) |
| AC4.3 | `compaction.test.ts` (line 209) | Phase 2 (2.1-2.3), Human Verification (semantic search) |
| AC5.1 | `compaction.test.ts` (line 17) | -- |
| AC5.2 | `agent.test.ts` (line 576) | Phase 3 (3.4) |
| AC5.3 | `agent.test.ts` (line 663) | Phase 3 (3.4-3.5), Human Verification (e2e mid-turn) |
| AC5.4 | `agent.test.ts` (line 768) | Phase 3 (3.2) |
| AC6.1 | `schema.ts` (build) | -- |
| AC6.2 | `schema.ts` (build) | -- |
| AC6.3 | `prompt.test.ts` (line 95) | -- |
| AC6.4 | `prompt.test.ts` (line 109) | -- |
| AC6.5 | `schema.ts` (build) | Phase 4 (4.1-4.4), Human Verification (runtime fallback) |
| AC7.1 | grep (zero matches) | -- |
| AC7.2 | `agent.test.ts` (line 320) | -- |
| AC7.3 | `agent.test.ts` (all tests) | -- |
