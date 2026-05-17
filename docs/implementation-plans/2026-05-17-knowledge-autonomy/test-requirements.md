# Knowledge Autonomy Test Requirements

Last verified: 2026-05-17

Maps every acceptance criterion (AC1.1 through AC4.11) from the [design plan](../../design-plans/2026-05-17-knowledge-autonomy.md) to either an automated test or a human verification step.

---

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| knowledge-autonomy.AC1.1 | Agent stores a secret via `secret_set` and it persists in PostgreSQL | integration | `src/secrets/postgres-store.test.ts` | 1 |
| knowledge-autonomy.AC1.1 | Agent stores a secret via `secret_set` and it persists in PostgreSQL (tool handler calls store.set, returns success) | unit | `src/tool/builtin/secrets.test.ts` | 1 |
| knowledge-autonomy.AC1.2 | Agent lists secret key names via `secret_list` without exposing values | unit | `src/tool/builtin/secrets.test.ts` | 1 |
| knowledge-autonomy.AC1.3 | Agent deletes a secret via `secret_delete` and it is removed from store | integration | `src/secrets/postgres-store.test.ts` | 1 |
| knowledge-autonomy.AC1.3 | Agent deletes a secret via `secret_delete` and it is removed from store (tool handler calls store.delete, returns success/error) | unit | `src/tool/builtin/secrets.test.ts` | 1 |
| knowledge-autonomy.AC1.4 | Secrets are injected as environment variables into Deno sandbox execution | unit | `src/runtime/executor-secrets.test.ts` | 1 |
| knowledge-autonomy.AC1.5 | Config secrets (env vars) take precedence over agent-stored secrets with the same key | unit | `src/secrets/resolver.test.ts` | 1 |
| knowledge-autonomy.AC1.6 | Secret tools are not registered when `secrets.agent_managed = false` | integration | `src/index.test.ts` | 1 |
| knowledge-autonomy.AC1.7 | Secret values never appear in tool output or conversation context (`secret_set` output does not contain the value; `secret_list` returns key names only) | unit | `src/tool/builtin/secrets.test.ts` | 1 |
| knowledge-autonomy.AC2.1 | `ToolRegistry.unregister()` removes a tool by name | unit | `src/tool/registry.test.ts` | 2 |
| knowledge-autonomy.AC2.2 | Agent creates a custom tool via `create_tool` and it is callable as a native model tool on the next turn (tool appears in `registry.getDefinitions()` and `registry.toModelTools()` after create) | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.3 | Agent creates a custom tool and it is callable from sandbox code via generated stub (tool appears in `registry.generateStubs()` after create) | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.4 | Custom tools persist to PostgreSQL and reload on restart (`create()` persists, `getByName()` retrieves; `loadAll()` re-registers) | integration | `src/custom-tool/postgres-store.test.ts` | 3 |
| knowledge-autonomy.AC2.4 | Custom tools persist to PostgreSQL and reload on restart (`loadAll()` registers all persisted tools into registry) | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.5 | Agent updates a custom tool and the updated version is used on subsequent calls (after `update()`, dispatching uses new handler) | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.6 | Agent deletes a custom tool and it is no longer callable or visible (after `delete()`, tool absent from `registry.getDefinitions()`, `dispatch()` returns "unknown tool") | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.7 | Creating a tool with a built-in tool's name returns an error | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC2.8 | Custom tool code can access secrets via sandbox environment variables (handler passes secrets to `runtime.execute()` in ExecutionContext) | unit | `src/custom-tool/manager.test.ts` | 3 |
| knowledge-autonomy.AC3.1 | Agent ingests a markdown file and chunks are stored as archival memory blocks with `knowledge:` label prefix | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC3.2 | Each chunk preserves heading hierarchy context | unit | `src/ingest/chunker.test.ts` | 4 |
| knowledge-autonomy.AC3.3 | Chunks have embeddings generated and stored | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC3.4 | Re-ingesting the same file replaces old chunks atomically | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC3.5 | Ingested chunks are retrievable via recall/semantic search | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC3.6 | Path traversal above workspace root is rejected | unit | `src/ingest/validate.test.ts` | 4 |
| knowledge-autonomy.AC3.6 | Path traversal above workspace root is rejected (ingestor level) | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC3.7 | Binary files and files over 1MB are rejected with descriptive error | unit | `src/ingest/validate.test.ts` | 4 |
| knowledge-autonomy.AC3.7 | Binary files and files over 1MB are rejected with descriptive error (ingestor level) | integration | `src/ingest/ingest.test.ts` | 4 |
| knowledge-autonomy.AC4.1 | Scan stage enumerates all mutable (readwrite, non-pinned) blocks in working and archival tiers | unit | `src/archivist/stages/scan.test.ts` | 6 |
| knowledge-autonomy.AC4.1 | Scan stage enumerates all mutable blocks (pipeline integration) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.2 | Dedup stage identifies near-duplicate blocks above similarity threshold and returns merge candidates | unit | `src/archivist/stages/dedup.test.ts` | 6 |
| knowledge-autonomy.AC4.2 | Dedup stage identifies duplicates (pipeline integration) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.3 | Consolidate stage merges duplicate groups into single blocks via summarization model | unit | `src/archivist/stages/consolidate.test.ts` | 6 |
| knowledge-autonomy.AC4.3 | Consolidate stage merges groups (pipeline integration: originals deleted, merged block created) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.4 | Crossref stage appends related block references to block content | unit | `src/archivist/stages/crossref.test.ts` | 6 |
| knowledge-autonomy.AC4.4 | Crossref stage appends references (pipeline integration: block content contains `[Related: ...]`) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.5 | Prune stage removes empty and whitespace-only blocks | unit | `src/archivist/stages/prune.test.ts` | 6 |
| knowledge-autonomy.AC4.5 | Prune stage removes empty blocks (pipeline integration: verified via DB) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.6 | Reflect stage writes observations to `archivist:reflection` working memory block | unit | `src/archivist/stages/reflect.test.ts` | 6 |
| knowledge-autonomy.AC4.6 | Reflect stage writes to working memory (pipeline integration) | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.7 | HNSW vector index improves similarity search performance | integration | `src/persistence/migrations/` (migration run) | 5 |
| knowledge-autonomy.AC4.8 | Incremental pipeline runs on configured schedule during wake cycles | unit | `src/archivist/activity.test.ts` | 7 |
| knowledge-autonomy.AC4.9 | Full pipeline runs during sleep at configured offset | unit | `src/archivist/activity.test.ts` | 7 |
| knowledge-autonomy.AC4.10 | Archivist skips readonly, familiar, pinned, append blocks and archivist:*/diary:* labels | unit | `src/archivist/stages/scan.test.ts` | 6 |
| knowledge-autonomy.AC4.10 | Archivist skips excluded blocks (activity integration confirmation) | integration | `src/archivist/activity.test.ts` | 7 |
| knowledge-autonomy.AC4.11 | Missing embedding provider causes dedup/crossref to be skipped (not crash), other stages continue | unit | `src/archivist/stages/dedup.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing embedding provider causes dedup/crossref to be skipped (consolidate.test.ts: skipped when no model) | unit | `src/archivist/stages/consolidate.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing embedding provider causes dedup/crossref to be skipped (crossref.test.ts: skipped when no embeddings) | unit | `src/archivist/stages/crossref.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing embedding provider causes dedup/crossref to be skipped (reflect.test.ts: skipped when no model) | unit | `src/archivist/stages/reflect.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing embedding provider: pipeline completes, dedup/crossref skipped | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing summarization model: consolidate/reflect skipped, other stages run | integration | `src/archivist/pipeline.test.ts` | 6 |
| knowledge-autonomy.AC4.11 | Missing embedding provider: pipeline with null embedding completes without crash (activity integration) | integration | `src/archivist/activity.test.ts` | 7 |

---

## Human Verification

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| knowledge-autonomy.AC1.7 | Secret values never appear in tool output or conversation context | Automated tests verify tool output strings do not contain the value, but full conversation context inspection (system prompts, assistant messages, tool_use blocks) requires manual review of a live agent session to confirm no leakage paths exist beyond the tool handlers. | Run a live session: store a secret with a distinctive marker value (e.g., `CANARY_12345`), then grep the full conversation context JSON (from `buildContext()` output) for the marker. Inspect the Deno sandbox script file contents during execution to confirm the value appears only in the ephemeral script and is cleaned up after. |
| knowledge-autonomy.AC2.2 | Agent creates a custom tool via `create_tool` and it is callable as a native model tool on the next turn | Unit tests verify registry state, but the "next turn" timing depends on the agent loop calling `toModelTools()` during context building. Verifying this end-to-end requires a live agent session. | Run a live session: create a custom tool via `create_tool`, then on the immediately following user turn, ask the agent to call the new tool. Confirm the model issues a `tool_use` block for it and receives the result. |
| knowledge-autonomy.AC2.3 | Agent creates a custom tool and it is callable from sandbox code via generated stub | Unit tests verify the tool appears in `generateStubs()`, but verifying that sandbox code can actually invoke the stub function end-to-end requires a Deno subprocess execution. | Run a live session: create a custom tool, then use `execute_code` to write sandbox code that calls the custom tool's stub function. Confirm the IPC round-trip succeeds and the custom tool's code executes. |
| knowledge-autonomy.AC3.5 | Ingested chunks are retrievable via recall/semantic search | Integration tests verify `getBlocksByLabelPrefix()` retrieval, but full recall pipeline verification (query decomposition, multi-domain search, context injection) requires a live session with a real embedding model. | Run a live session: ingest a markdown file with distinctive technical content, then ask the agent a question that should trigger recall of the ingested material. Confirm the recall pipeline surfaces relevant chunks in the agent's context. |
| knowledge-autonomy.AC4.7 | HNSW vector index improves similarity search performance | The migration can be verified to apply, but actual performance improvement requires query plan analysis on a dataset with meaningful scale. | After migration, run `EXPLAIN ANALYZE` on a representative cosine similarity query against `memory_blocks` with 1000+ rows with embeddings. Confirm the query plan shows `Index Scan using idx_memory_blocks_embedding_hnsw` rather than a sequential scan. Compare query time before/after the index on the same dataset. |
| knowledge-autonomy.AC4.8 | Incremental pipeline runs on configured schedule during wake cycles | Unit tests verify the task name is handled and the event builder produces correct output, but verifying actual cron-triggered execution during wake cycles requires observing the daemon over a real schedule period. | Run the daemon with a short incremental cron (e.g., `*/5 * * * *`) and activity enabled. Observe logs for `[archivist] running incremental pipeline` messages during wake periods. Confirm no incremental runs occur during sleep periods (suppressed by activity dispatch). |
| knowledge-autonomy.AC4.9 | Full pipeline runs during sleep at configured offset | Unit tests verify `SLEEP_TASK_NAMES` includes `sleep-archivist` and the event builder works, but verifying the full pipeline executes during sleep at the correct offset requires observing the daemon across a sleep cycle. | Run the daemon with activity enabled and a short sleep cycle. Observe logs for `[archivist] full pipeline` execution at the configured offset after sleep start. Confirm the archivist sub-agent processes the event with an isolated conversation ID. |

---

## Test File Summary

| Test File | Test Type | Phase | ACs Covered |
|-----------|-----------|-------|-------------|
| `src/secrets/postgres-store.test.ts` | integration | 1 | AC1.1, AC1.3 |
| `src/secrets/resolver.test.ts` | unit | 1 | AC1.5 |
| `src/tool/builtin/secrets.test.ts` | unit | 1 | AC1.1, AC1.2, AC1.3, AC1.7 |
| `src/runtime/executor-secrets.test.ts` | unit | 1 | AC1.4 |
| `src/index.test.ts` | integration | 1 | AC1.6 |
| `src/tool/registry.test.ts` | unit | 2 | AC2.1 |
| `src/custom-tool/postgres-store.test.ts` | integration | 3 | AC2.4 |
| `src/custom-tool/manager.test.ts` | unit | 3 | AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7, AC2.8 |
| `src/ingest/chunker.test.ts` | unit | 4 | AC3.2 |
| `src/ingest/validate.test.ts` | unit | 4 | AC3.6, AC3.7 |
| `src/ingest/ingest.test.ts` | integration | 4 | AC3.1, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7 |
| `src/archivist/stages/scan.test.ts` | unit | 6 | AC4.1, AC4.10 |
| `src/archivist/stages/dedup.test.ts` | unit | 6 | AC4.2, AC4.11 |
| `src/archivist/stages/consolidate.test.ts` | unit | 6 | AC4.3, AC4.11 |
| `src/archivist/stages/crossref.test.ts` | unit | 6 | AC4.4, AC4.11 |
| `src/archivist/stages/prune.test.ts` | unit | 6 | AC4.5 |
| `src/archivist/stages/reflect.test.ts` | unit | 6 | AC4.6, AC4.11 |
| `src/archivist/pipeline.test.ts` | integration | 6 | AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6, AC4.11 |
| `src/archivist/activity.test.ts` | unit + integration | 7 | AC4.8, AC4.9, AC4.10, AC4.11 |
