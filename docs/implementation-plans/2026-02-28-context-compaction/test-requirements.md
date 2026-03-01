# Test Requirements: Context Compaction

Maps each acceptance criterion from the [context compaction design](../design-plans/2026-02-28-context-compaction.md)
to specific automated tests or human verification steps.

**Convention:** Test files are colocated with their source (e.g., `src/compaction/compactor.test.ts`).
Integration tests live in `src/integration/`. All tests use `bun:test` with `describe`/`it` blocks.

---

## Automated Tests

### context-compaction.AC1: Compaction pipeline compresses conversation history

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC1.1 | When token estimate exceeds `context_budget * model_max_tokens`, old messages are compressed into summary batches | unit | `src/compaction/compactor.test.ts` | Given history exceeding token budget, `compress()` returns `CompactionResult` with `batchesCreated > 0` and shorter history than input |
| AC1.1 | (integration) | e2e | `src/integration/compaction.test.ts` | Real compaction with ollama produces `messagesCompressed > 0` and `tokensEstimateBefore > tokensEstimateAfter` |
| AC1.2 | Messages are chunked into groups of `chunk_size` before summarization | unit | `src/compaction/compactor.test.ts` | `chunkMessages(10 msgs, chunkSize=3)` produces 4 chunks (3,3,3,1); empty input yields empty output; chunkSize > message count yields single chunk |
| AC1.3 | Each chunk is summarized with the existing summary as context (fold-in pattern) | unit | `src/compaction/compactor.test.ts` | Mock `ModelProvider.complete()` is called N times for N chunks; each call's prompt includes the prior chunk's summary text (fold-in) |
| AC1.4 | Summary batches include depth, timestamp range, and original message count | unit | `src/compaction/compactor.test.ts` | Returned `SummaryBatch` objects have `depth: 0`, `startTime`/`endTime` matching chunk boundaries, `messageCount` matching chunk length |
| AC1.5 | Old messages are deleted from the `messages` table after compression | unit | `src/compaction/compactor.test.ts` | Mock `PersistenceProvider.query()` receives `DELETE FROM messages WHERE id = ANY($1)` with correct IDs from `toCompress` |
| AC1.6 | Last `keep_recent` messages are preserved verbatim | unit | `src/compaction/compactor.test.ts` | `splitHistory(10 msgs, keepRecent=5)` puts 5 in `toCompress`, 5 in `toKeep`; `splitHistory(3 msgs, keepRecent=5)` puts 0 in `toCompress` |
| AC1.7 | If summarization model call fails, original history is returned unchanged | unit | `src/compaction/compactor.test.ts` | When `model.complete()` throws, `compress()` returns original history with all stats at zero |
| AC1.8 | First compaction (no existing summary) produces valid batches with depth 0 | unit | `src/compaction/compactor.test.ts` | History with no prior compaction summary message: first summarization call receives empty string as `existingSummary`, resulting batches have `depth: 0` |
| AC1.8 | (integration) | e2e | `src/integration/compaction.test.ts` | Fresh conversation with no prior summaries produces valid clip-archive starting with `[Context Summary` |

### context-compaction.AC2: Recursive re-summarization compresses accumulated batches

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC2.1 | When total summary batches exceed `clip_first + clip_last + buffer`, oldest batches are re-summarized | unit | `src/compaction/compactor.test.ts` | Mock `memory.list('archival')` returns 7 batch blocks with `clipFirst=2, clipLast=2` -- re-summarization triggers. With 4 batches -- no trigger |
| AC2.2 | Re-summarized batches have depth incremented (depth 0 -> depth 1, etc.) | unit | `src/compaction/compactor.test.ts` | Re-summarize three depth-0 batches: new batch has `depth: 1`. Re-summarize depth-0 + depth-1: new batch has `depth: 2`. Also tests `parseBatchMetadata()` round-trips correctly |
| AC2.3 | Re-summarized batch replaces the source batches in archival memory | unit | `src/compaction/compactor.test.ts` | `memory.deleteBlock()` called with IDs of source batches; `memory.write()` called with the new re-summarized batch |
| AC2.4 | Multiple compaction cycles produce progressively higher-depth batches | unit | `src/compaction/compactor.test.ts` | Simulate two compaction cycles: first produces depth-0, accumulated batches trigger re-summarization producing depth-1; third cycle produces depth-2 |

### context-compaction.AC3: Clip-archive view presents compressed history

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC3.1 | Clip-archive shows first `clip_first` and last `clip_last` summary batches | unit | `src/compaction/compactor.test.ts` | `buildClipArchive(6 batches, clipFirst=2, clipLast=2)` output contains batches 1-2 under "Earliest context" and batches 5-6 under "Recent context" |
| AC3.2 | Omitted batches between first and last are indicated with count and `memory_read` hint | unit | `src/compaction/compactor.test.ts` | Same 6-batch case: output contains `"2 earlier summaries omitted"` and `"memory_read"` |
| AC3.3 | Clip-archive is inserted as a system-role message at the start of compressed history | unit | `src/compaction/compactor.test.ts` | After `compress()`, `result.history[0]` has `role: 'system'` and content starts with `[Context Summary` |
| AC3.3 | (integration) | e2e | `src/integration/compaction.test.ts` | Real compaction result's first message is system-role with `[Context Summary` header, `## Earliest context`, `## Recent context` sections, and batch markers with depth/timestamp |
| AC3.4 | When total batches <= `clip_first + clip_last`, all batches are shown (no omission separator) | unit | `src/compaction/compactor.test.ts` | `buildClipArchive(3 batches, clipFirst=2, clipLast=2)` shows all 3 batches, output does not contain `"omitted"` |

### context-compaction.AC4: Summary batches are archived for semantic retrieval

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC4.1 | Each summary batch is written to archival memory tier | unit | `src/compaction/compactor.test.ts` | Mock `memory.write()` called once per summary batch with `tier: 'archival'` |
| AC4.1 | (integration) | e2e | `src/integration/compaction.test.ts` | After real compaction, `memory.list('archival')` returns blocks with compaction batch labels |
| AC4.2 | Archived batches are labelled with `compaction-batch-{conversationId}-{timestamp}` | unit | `src/compaction/compactor.test.ts` | Mock `memory.write()` label argument matches `compaction-batch-{testConversationId}-{ISO timestamp}` |
| AC4.2 | (integration) | e2e | `src/integration/compaction.test.ts` | Archived blocks have labels starting with `compaction-batch-{conversationId}-` |
| AC4.3 | Archived batches are retrievable via `memory_read` semantic search | e2e | `src/integration/compaction.test.ts` | After compaction, archived blocks exist with non-empty content (full semantic search verification requires real embeddings -- see Human Verification) |

### context-compaction.AC5: `compact_context` tool enables agent-initiated compaction

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC5.1 | Agent can call `compact_context` with no parameters | unit | `src/tool/builtin/compaction.test.ts` | `createCompactContextTool()` returns a `Tool` with `definition.name === 'compact_context'`, empty `parameters` array, and non-empty `description` |
| AC5.2 | Tool returns compression stats (messages compressed, batches created, token reduction) | unit | `src/agent/agent.test.ts` | When mock model returns `compact_context` tool_use, the persisted tool result contains JSON with `messagesCompressed`, `batchesCreated`, `tokensEstimateBefore`, `tokensEstimateAfter` fields |
| AC5.3 | After `compact_context` executes, subsequent tool calls in the same round see compressed context | unit | `src/agent/agent.test.ts` | Mock model returns `compact_context` then a second tool call in the same round; verify the model's second request receives shorter history (from the mock compactor's compressed result) |
| AC5.4 | Calling `compact_context` when history is already below budget is a no-op (returns stats showing 0 compression) | unit | `src/agent/agent.test.ts` | Mock compactor returns `CompactionResult` with all stats at zero; tool result JSON shows all-zero stats, history unchanged |

### context-compaction.AC6: Summarization uses dedicated model config

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC6.1 | `[summarization]` config block accepts provider, name, base_url, api_key | build | `src/config/schema.ts` | `bun run build` passes -- `SummarizationConfigSchema` parses a config with all model fields. Verified operationally (Zod schema validation is structural) |
| AC6.2 | Compaction-specific fields (chunk_size, keep_recent, etc.) have sensible defaults | build | `src/config/schema.ts` | `SummarizationConfigSchema` parsing a minimal config (provider + name only) produces defaults: `chunk_size: 20`, `keep_recent: 5`, `max_summary_tokens: 1024`, `clip_first: 2`, `clip_last: 2` |
| AC6.3 | Custom `prompt` field overrides the default summarization prompt | unit | `src/compaction/prompt.test.ts` | `interpolatePrompt` with a custom template string produces output using that template, not `DEFAULT_SUMMARIZATION_PROMPT` |
| AC6.4 | `{persona}`, `{existing_summary}`, `{messages}` placeholders are interpolated in the prompt | unit | `src/compaction/prompt.test.ts` | `interpolatePrompt` replaces all three placeholders; empty persona yields empty string; empty existingSummary yields `"(no prior summary)"`; multiple occurrences of same placeholder all replaced |
| AC6.5 | Omitting `[summarization]` entirely falls back to main model provider with default compaction params | build | `src/config/schema.ts` | `AppConfigSchema` parses a config with no `[summarization]` section -- `config.summarization` is `undefined`. Composition root uses main model provider when absent |

### context-compaction.AC7: Migration preserves existing behaviour

| Criterion | Text | Type | Test File | Verification |
|-----------|------|------|-----------|--------------|
| AC7.1 | Old `compressConversationHistory()` is removed from `agent.ts` | grep | N/A | After Phase 6: no references to `compressConversationHistory` or `COMPRESSION_KEEP_RECENT` anywhere in source. Verified via grep |
| AC7.2 | Automatic compression trigger (`shouldCompress()`) still fires at the same threshold | unit | `src/agent/agent.test.ts` | Updated compression test: `shouldCompress()` triggers at `context_budget * model_max_tokens`, mock compactor's `compress()` is called with the full history |
| AC7.3 | All existing agent tests pass after migration | unit | `src/agent/agent.test.ts` | `bun test src/agent/agent.test.ts` -- all existing tests pass (tests that don't involve compression omit the optional `compactor` dependency) |

---

## Human Verification

| Criterion | Justification | Verification Approach |
|-----------|--------------|----------------------|
| AC4.3 (full) | The integration test uses mock embeddings, so it can verify blocks *exist* in archival memory but cannot verify true semantic search ranking. Real pgvector similarity search requires real embedding vectors, which depends on a running embedding provider and meaningful vector content. | Run a manual session with real config (ollama embeddings + ollama summarization). After compaction, use `memory_read` tool to search for a topic mentioned in compressed messages. Confirm the search returns relevant summary batches. |
| AC1.3 (quality) | Unit tests verify the fold-in *structure* (each call receives prior summary), but cannot assess whether the fold-in actually preserves context quality -- that's a property of the LLM's output, not the code. | After integration test with ollama, read the summary batches manually. Confirm later summaries incorporate information from earlier ones (e.g., a decision mentioned in chunk 1 is still referenced in the summary produced for chunk 3). |
| AC5.3 (end-to-end) | The unit test mocks the compactor, so it verifies the agent loop *mechanics* (history replacement), but doesn't confirm that a real model produces meaningfully different output after mid-turn compaction. | Run the daemon, have a long conversation that exceeds context budget, then ask the agent to call `compact_context`. Issue a follow-up question referencing earlier context. Confirm the agent can still access key information via the clip-archive or memory_read. |
| AC3.1/AC3.2 (readability) | Automated tests verify structural correctness (sections present, batch markers, omission count). Whether the clip-archive is *readable and useful to the agent* is a subjective quality. | During a real session, trigger compaction and inspect the system message injected into the conversation. Confirm the format is clear, the chronological flow makes sense, and the omission hint is actionable. |
| AC6.5 (runtime fallback) | Build-time verification confirms the schema allows absent `[summarization]`. Runtime fallback (main model actually used for summarization) requires running the daemon without a `[summarization]` block and triggering compaction. | Start the daemon with no `[summarization]` in `config.toml`. Trigger compaction (long conversation or manual `compact_context`). Confirm compaction succeeds using the main model. Check logs for summarization model calls going to the main provider. |

---

## Test File Summary

| Test File | Phase | Type | Criterion Coverage |
|-----------|-------|------|-------------------|
| `src/compaction/prompt.test.ts` | 2 | unit | AC6.3, AC6.4 |
| `src/compaction/compactor.test.ts` | 3, 4 | unit | AC1.1-AC1.8, AC2.1-AC2.4, AC3.1-AC3.4, AC4.1, AC4.2 |
| `src/tool/builtin/compaction.test.ts` | 5 | unit | AC5.1 |
| `src/agent/agent.test.ts` | 5, 6 | unit | AC5.2-AC5.4, AC7.2, AC7.3 |
| `src/integration/compaction.test.ts` | 7 | e2e | AC1.1, AC1.8, AC3.3, AC4.1-AC4.3 |

---

## Notes

- **AC6.1, AC6.2, AC6.5** are primarily config schema concerns. They are verified structurally by `bun run build` (Zod schema compilation) rather than dedicated test assertions.
- **AC7.1** is verified by absence of code, not by a test assertion. A grep for `compressConversationHistory` in the source tree after Phase 6 is the verification step.
- Integration tests (`src/integration/compaction.test.ts`) require both PostgreSQL and Ollama to be running. They skip gracefully when Ollama is unavailable but fail if PostgreSQL is down.
