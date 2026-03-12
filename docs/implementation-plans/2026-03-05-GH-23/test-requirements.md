# GH-23 Test Requirements

Maps each acceptance criterion from the [design plan](../../design-plans/2026-03-05-GH-23.md) to automated tests or human verification steps. Every criterion is covered by at least one test or documented verification approach.

## Legend

- **Unit**: Pure function or mock-based test, no external dependencies
- **Integration**: Requires running PostgreSQL with pgvector
- **Human**: Cannot be fully automated; requires manual verification with rationale

## Test Matrix

| AC ID | Description | Test Type | Test File | Verification Description |
|-------|-------------|-----------|-----------|--------------------------|
| GH-23.AC1.1 | Hybrid mode returns results combining keyword matches and semantic similarity | Integration | `src/search/domains/memory.test.ts` | Insert memory blocks with both keyword-rich content and embeddings. Search in hybrid mode. Verify results include matches from both keyword CTE and vector CTE. |
| GH-23.AC1.1 | (same, conversations domain) | Integration | `src/search/domains/conversations.test.ts` | Insert messages with both keyword-rich content and embeddings. Search in hybrid mode. Verify results include matches from both retrieval signals. |
| GH-23.AC1.1 | (same, cross-domain fan-out) | Integration | `src/search/search.integration.test.ts` | Seed both `memory_blocks` and `messages` with matching data. Search in hybrid mode with `domain: 'all'`. Verify results span both domains with RRF-merged scores. |
| GH-23.AC1.2 | Keyword mode returns results matching exact terms without generating embeddings | Integration | `src/search/domains/memory.test.ts` | Search with `mode: 'keyword'` and `embedding: null`. Verify results match text content. Verify no embedding is required in params. |
| GH-23.AC1.2 | (same, conversations domain) | Integration | `src/search/domains/conversations.test.ts` | Search with `mode: 'keyword'` and `embedding: null`. Verify keyword-only results returned without requiring embedding generation. |
| GH-23.AC1.2 | (same, cross-domain) | Integration | `src/search/search.integration.test.ts` | Search in keyword mode across both domains. Verify results from both tables based on text matches only. |
| GH-23.AC1.3 | Semantic mode returns results by vector similarity without running tsquery | Integration | `src/search/domains/memory.test.ts` | Search with `mode: 'semantic'` providing an embedding vector. Verify results sorted by cosine similarity. Verify blocks without matching text but with similar embeddings still appear. |
| GH-23.AC1.3 | (same, conversations domain) | Integration | `src/search/domains/conversations.test.ts` | Search with `mode: 'semantic'` and an embedding vector. Verify results sorted by vector similarity, not text match. |
| GH-23.AC1.3 | (same, cross-domain) | Integration | `src/search/search.integration.test.ts` | Semantic search across both domains. Verify vector-only retrieval, no tsquery involved. |
| GH-23.AC1.4 | Memory domain search respects tier filter (core/working/archival) | Integration | `src/search/domains/memory.test.ts` | Insert blocks across all three tiers. Search with `tier` filter set to each value. Verify only blocks matching the specified tier are returned. |
| GH-23.AC1.4 | (same, full pipeline) | Integration | `src/search/search.integration.test.ts` | Search with tier filter via SearchStore. Verify memory results filtered by tier while conversation results are unaffected by the tier parameter. |
| GH-23.AC1.5 | Conversation domain search respects role filter (user/assistant/system/tool) | Integration | `src/search/domains/conversations.test.ts` | Insert messages with different roles. Search with `role` filter set. Verify only messages matching the specified role are returned. |
| GH-23.AC1.5 | (same, full pipeline) | Integration | `src/search/search.integration.test.ts` | Search with role filter via SearchStore. Verify conversation results filtered by role while memory results are unaffected by the role parameter. |
| GH-23.AC1.6 | Query with no matches returns empty results, not an error | Unit | `src/search/postgres-store.test.ts` | Register mock domains that return empty arrays. Verify `SearchStore.search()` returns `[]`, not an error. Verify `ToolResult.success` is true with an empty results array. |
| GH-23.AC1.7 | Invalid mode/domain/role/tier values are rejected with clear error message | Unit | `src/tool/builtin/search.test.ts` | Register the search tool in a real `ToolRegistry`. Dispatch with `mode: 'invalid'`. Verify the registry returns `success: false` with error message containing `"invalid value for parameter"`. Repeat for invalid domain, role, and tier values. Relies on the registry's built-in enum validation (see `src/tool/registry.ts:114-126`). |
| GH-23.AC1.8 | Limit is clamped to 1-50 range regardless of input | Unit | `src/tool/builtin/search.test.ts` | Call the search tool handler with `limit: 0`, `limit: -5`, `limit: 100`, `limit: 25`. Capture the `SearchParams` passed to the mock SearchStore. Verify limits are clamped to 1, 1, 50, 25 respectively. |
| GH-23.AC2.1 | Results appearing in both keyword and vector results rank higher than results in only one | Unit | `src/search/rrf.test.ts` | Create two result lists (keyword and vector) with overlapping items. Verify items appearing in both lists have higher RRF scores than items in only one list. |
| GH-23.AC2.1 | (same, store-level) | Unit | `src/search/postgres-store.test.ts` | Register two mock domains returning overlapping results. Verify overlapping results score higher after RRF merge. |
| GH-23.AC2.2 | Results from different domains are interleaved by RRF score, not grouped by domain | Unit | `src/search/rrf.test.ts` | Create results from different domains (memory and conversations). Verify the output is sorted by RRF score and that a conversations result can appear between two memory results. |
| GH-23.AC2.2 | (same, store-level) | Unit | `src/search/postgres-store.test.ts` | Register mock memory and conversations domains with different results. Verify output is interleaved by score, not grouped by domain name. |
| GH-23.AC2.3 | Results appearing in only one search mode still appear in output with appropriate lower score | Unit | `src/search/rrf.test.ts` | Create results that only appear in one list. Verify they still appear in merged output with a valid positive score (lower than dual-list results). |
| GH-23.AC3.1 | New user messages are persisted with embeddings | Unit | `src/agent/agent.test.ts` | Provide a mock `EmbeddingProvider` to agent. Send a user message. Capture the INSERT params for the `messages` table. Verify the embedding column value is non-null. |
| GH-23.AC3.2 | New assistant messages are persisted with embeddings | Unit | `src/agent/agent.test.ts` | Process an assistant response. Capture the INSERT params for the `messages` table. Verify the assistant message embedding column is non-null. |
| GH-23.AC3.3 | Embedding provider failure does not block message persistence (null embedding stored) | Unit | `src/agent/agent.test.ts` | Provide a mock `EmbeddingProvider` that throws on `embed()`. Send a message. Verify the INSERT still executes (message persisted) with null embedding value. Verify no exception propagates to caller. |
| GH-23.AC3.4 | Backfill script processes existing messages in batches and reports progress | Human | `src/scripts/backfill-embeddings.ts` | **Cannot be fully automated** because the backfill script is a standalone entrypoint (`bun run backfill-embeddings`) that requires a running database with pre-existing messages and a configured embedding provider (Ollama or OpenAI). **Manual verification**: (1) seed the database with messages lacking embeddings, (2) run `bun run backfill-embeddings`, (3) verify console output shows batch progress logs (e.g. "Batch 1: processed 50 messages (50/200 total)"), (4) verify final summary line ("Backfill complete: X embedded, Y failed, Z total"), (5) query `SELECT count(*) FROM messages WHERE embedding IS NOT NULL AND role IN ('user','assistant')` to confirm embeddings were written. Build verification (`bun run build`) confirms the script compiles. |
| GH-23.AC3.5 | System and tool role messages are stored with null embeddings (not embedded) | Unit | `src/agent/agent.test.ts` | Persist a tool role message and a system role message. Verify both INSERT queries pass null for the embedding column. Verify `embed()` is never called for these roles. |
| GH-23.AC4.1 | Start time filter excludes results created before the specified time | Integration | `src/search/domains/memory.test.ts` | Insert blocks with different `created_at` timestamps. Search with `startTime` set. Verify blocks created before `startTime` are excluded. |
| GH-23.AC4.1 | (same, conversations domain) | Integration | `src/search/domains/conversations.test.ts` | Insert messages with different timestamps. Search with `startTime` set. Verify messages before `startTime` are excluded. |
| GH-23.AC4.1 | (same, full pipeline) | Integration | `src/search/search.integration.test.ts` | Search across both domains with `startTime`. Verify results from both tables respect the time boundary. |
| GH-23.AC4.2 | End time filter excludes results created after the specified time | Integration | `src/search/domains/memory.test.ts` | Insert blocks with different timestamps. Search with `endTime` set. Verify blocks created after `endTime` are excluded. |
| GH-23.AC4.2 | (same, full pipeline) | Integration | `src/search/search.integration.test.ts` | Search across both domains with `endTime`. Verify results from both tables respect the end time boundary. |
| GH-23.AC4.3 | Combined start + end time creates a bounded time window | Integration | `src/search/domains/conversations.test.ts` | Insert messages spanning a wide time range. Search with both `startTime` and `endTime`. Verify only messages within the bounded window are returned. |
| GH-23.AC4.3 | (same, full pipeline) | Integration | `src/search/search.integration.test.ts` | Search across both domains with combined time filters. Verify only results within the bounded window from both tables. |
| GH-23.AC4.4 | Omitting time filters returns results regardless of creation time | Unit | `src/search/postgres-store.test.ts` | Search without `startTime` or `endTime` (both null). Mock domains return results with varied timestamps. Verify all results are returned regardless of creation time. |

## Test File Summary

| Test File | Type | Phase | ACs Covered |
|-----------|------|-------|-------------|
| `src/search/rrf.test.ts` | Unit | 3 | AC2.1, AC2.2, AC2.3 |
| `src/search/domains/memory.test.ts` | Integration | 4 | AC1.1, AC1.2, AC1.3, AC1.4, AC4.1, AC4.2 |
| `src/search/domains/conversations.test.ts` | Integration | 5 | AC1.1, AC1.2, AC1.3, AC1.5, AC4.1, AC4.3 |
| `src/search/postgres-store.test.ts` | Unit | 6 | AC1.6, AC2.1, AC2.2, AC4.4 |
| `src/tool/builtin/search.test.ts` | Unit | 6 | AC1.7, AC1.8 |
| `src/search/search.integration.test.ts` | Integration | 6 | AC1.1-AC1.5, AC4.1-AC4.3 |
| `src/agent/agent.test.ts` | Unit | 7 | AC3.1, AC3.2, AC3.3, AC3.5 |
| `src/scripts/backfill-embeddings.ts` | Human | 8 | AC3.4 |

## Rationale for Human Verification (AC3.4)

The backfill script (`src/scripts/backfill-embeddings.ts`) is a standalone CLI entrypoint, not a library function. It:

1. Loads config from `config.toml` and environment variables
2. Connects to a real PostgreSQL database
3. Calls a real embedding provider (Ollama or OpenAI) for each batch
4. Writes embeddings back to the database

An integration test *could* wrap this script's `main()` logic, but it would require:
- A test database seeded with embeddingless messages
- A real or adequately faked embedding provider (the script uses `embedBatch()` with fallback to `embed()`, making mocking non-trivial without refactoring the script into a testable function)
- Progress output capture (console.log assertions)

The implementation plan chose the standalone script pattern (matching `src/scripts/migrate-surreal.ts`), which is idiomatic for one-time data migrations in this codebase. The cost of refactoring it into a testable library function exceeds the value, given that it runs once and its correctness is trivially verifiable by querying the database after execution.

`bun run build` confirms the script compiles. Manual execution against a development database confirms runtime behaviour.

## Notes

- **Phase 1 (migration) and Phase 2 (types/interfaces)** have no acceptance criteria to test. They are verified operationally: `bun run migrate` succeeds, `bun run build` passes, types are importable from `@/search`.
- **AC1.7** is tested at the tool registry level, not the search handler, because enum validation is the registry's responsibility (confirmed at `src/tool/registry.ts:114-126`). The search tool handler receives only valid enum values.
- **AC1.1-AC1.3** appear in multiple test files because they apply to both individual domains and the full cross-domain pipeline. The domain tests verify SQL query correctness; the integration test verifies end-to-end fan-out and merge.
- **RRF tests (AC2.x)** are pure unit tests because `mergeWithRRF()` is a pure function operating on pre-ranked result arrays. No database needed.
- **AC3.5** is grouped with AC3.1-AC3.3 in `agent.test.ts` because it tests the same `persistMessage()` code path (role-based embedding decision).
