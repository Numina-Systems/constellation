# Knowledge Autonomy — Human Test Plan

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- All migrations applied (`bun run migrate`)
- `bun test` passing (unit tests green; integration tests require DB)
- Constellation daemon configured with a valid model provider and embedding provider
- A workspace directory configured in `config.toml`

## Phase 1: Secret Management (AC1.7)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | REPL prompt appears |
| 2 | Ask the agent: "Store a secret called TEST_CANARY with value CANARY_VALUE_98765" | Agent calls `secret_set`, response says `Secret "TEST_CANARY" stored successfully.` Response does NOT contain `CANARY_VALUE_98765` |
| 3 | Ask the agent: "List my secrets" | Agent calls `secret_list`, output includes `TEST_CANARY` but does NOT contain `CANARY_VALUE_98765` |
| 4 | Inspect the raw conversation context JSON from `buildContext()` output (add a temporary `console.log` or attach a debugger to `src/agent/agent.ts` context building) | The string `CANARY_VALUE_98765` does NOT appear anywhere in system prompt, assistant messages, or tool_use blocks. It should only exist in the DB row and transiently in sandbox scripts |
| 5 | Ask the agent: "Run this code: `console.log(TEST_CANARY)`" | The sandbox executes, prints `CANARY_VALUE_98765` to output. After execution, verify the temporary script file in `/tmp` has been cleaned up |
| 6 | Ask the agent: "Delete secret TEST_CANARY" | Agent calls `secret_delete`, response says `Secret "TEST_CANARY" deleted.` |

## Phase 2: Custom Tool Lifecycle (AC2.2, AC2.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ask the agent: "Create a custom tool called greet_user with one required string parameter 'name' and code `output('Hello, ' + PARAMS.name + '!')`" | Agent calls `create_tool`, returns success with the tool definition |
| 2 | On the next user turn, ask: "Call greet_user with name 'World'" | The model issues a `tool_use` block for `greet_user`. The result contains `Hello, World!`. This confirms the tool appeared in `toModelTools()` on the next turn's context build |
| 3 | Ask the agent: "Write code that calls greet_user('Sandbox')" | Agent calls `execute_code`. The sandbox code invokes the generated stub. IPC round-trip succeeds. Output contains `Hello, Sandbox!` |
| 4 | Ask the agent: "Update greet_user to say 'Hi' instead of 'Hello'" | Agent calls `update_tool`. On the next turn, calling `greet_user` with name 'Test' returns `Hi, Test!` |
| 5 | Ask the agent: "Delete greet_user" | Agent calls `delete_tool`. On the next turn, asking the agent to call `greet_user` either fails or the model doesn't attempt to call it (tool no longer in definitions) |

## Phase 3: Knowledge Ingestion (AC3.5)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a file `workspace/test-doc.md` with distinctive technical content (e.g., a paragraph about "quantum entanglement in distributed systems using Bell pair protocols") | File exists in the workspace directory |
| 2 | Ask the agent: "Ingest the file test-doc.md" | Agent calls `ingest_file`, returns chunk count > 0 and label `knowledge:test-doc.md` |
| 3 | Ask the agent: "What do you know about Bell pair protocols?" | Recall pipeline triggers. The agent's response references content from the ingested file. Check agent context/logs to confirm recall injected the relevant chunks |
| 4 | Verify in DB: `SELECT label, content FROM memory_blocks WHERE owner = '<agent_owner>' AND label LIKE 'knowledge:test-doc.md%'` | Rows exist with archival tier, each containing a chunk of the original document with `[Context: ...]` heading annotations |

## Phase 4: HNSW Vector Index (AC4.7)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure the database has 1000+ rows with non-null embeddings in `memory_blocks` (or seed test data) | Row count confirmed via `SELECT COUNT(*) FROM memory_blocks WHERE embedding IS NOT NULL` |
| 2 | Run `EXPLAIN ANALYZE SELECT id, label, 1 - (embedding <=> '[0.1,0.2,...]'::vector) as similarity FROM memory_blocks WHERE embedding IS NOT NULL ORDER BY embedding <=> '[0.1,0.2,...]'::vector LIMIT 10` (use a real embedding vector matching the configured dimension) | Query plan shows `Index Scan using idx_memory_blocks_embedding_hnsw` rather than a sequential scan |
| 3 | Compare query time with and without the index (drop and recreate to benchmark) | Indexed query should be measurably faster on datasets > 1000 rows |

## Phase 5: Archivist Activity Scheduling (AC4.8, AC4.9)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure `config.toml` with activity enabled, a short incremental cron (e.g., `*/5 * * * *`), and a short sleep cycle | Configuration loads without error on daemon start |
| 2 | Start the daemon and wait for a wake period | Observe console/logs for `[archivist] running incremental pipeline` messages. Confirm the incremental pipeline runs at the configured interval |
| 3 | During a sleep period, observe logs | No incremental pipeline runs should occur during sleep. Instead, observe `[archivist] full pipeline` execution at the configured offset after sleep start |
| 4 | Verify the archivist event metadata in logs | Events should have `taskType: 'archivist'` and `sleepTask: true` for sleep-triggered runs |

## End-to-End: Secret-Powered Custom Tool

**Purpose:** Validates that secrets, custom tools, and sandbox execution integrate correctly across all three subsystems.

1. Store a secret: "Store a secret called GREETING_PREFIX with value 'Ahoy'"
2. Create a custom tool: "Create a tool called pirate_greet with parameter 'name' (string, required) and code: `output(GREETING_PREFIX + ', ' + PARAMS.name + '!')`"
3. Call the tool: "Call pirate_greet with name 'Captain'"
4. Expected: Output is `Ahoy, Captain!` — proving the secret was resolved, injected into the sandbox ExecutionContext, and available as a TypeScript constant in the custom tool's code

## End-to-End: Ingest then Archivist

**Purpose:** Validates that ingested knowledge survives archivist maintenance without being incorrectly pruned or deduplicated.

1. Ingest a document with unique content
2. Trigger an incremental archivist run (or wait for the scheduled one)
3. Verify the ingested `knowledge:` blocks still exist and are retrievable
4. Ingest a second document with similar but distinct content
5. Trigger a full archivist run
6. Verify: Both documents' chunks exist. If the archivist found cross-references between them, blocks should contain `[Related: ...]` annotations. Neither document should have been pruned (content is non-empty)

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `secrets/postgres-store.test.ts`, `tool/builtin/secrets.test.ts` | -- |
| AC1.2 | `tool/builtin/secrets.test.ts` | -- |
| AC1.3 | `secrets/postgres-store.test.ts`, `tool/builtin/secrets.test.ts` | -- |
| AC1.4 | `runtime/executor-secrets.test.ts` | -- |
| AC1.5 | `secrets/resolver.test.ts` | -- |
| AC1.6 | `index.test.ts` | -- |
| AC1.7 | `tool/builtin/secrets.test.ts` (output-level) | Phase 1 Steps 2-5 (context-level) |
| AC2.1 | `tool/registry.test.ts` | -- |
| AC2.2 | `custom-tool/manager.test.ts` (registry state) | Phase 2 Step 2 (next-turn timing) |
| AC2.3 | `custom-tool/manager.test.ts` (stub generation) | Phase 2 Step 3 (IPC round-trip) |
| AC2.4 | `custom-tool/postgres-store.test.ts`, `custom-tool/manager.test.ts` | -- |
| AC2.5 | `custom-tool/manager.test.ts` | -- |
| AC2.6 | `custom-tool/manager.test.ts` | -- |
| AC2.7 | `custom-tool/manager.test.ts` | -- |
| AC2.8 | `custom-tool/manager.test.ts` | -- |
| AC3.1 | `ingest/ingest.test.ts` | -- |
| AC3.2 | `ingest/chunker.test.ts`, `ingest/ingest.test.ts` | -- |
| AC3.3 | `ingest/ingest.test.ts` | -- |
| AC3.4 | `ingest/ingest.test.ts` | -- |
| AC3.5 | `ingest/ingest.test.ts` (label-prefix retrieval) | Phase 3 Step 3 (full recall pipeline) |
| AC3.6 | `ingest/validate.test.ts`, `ingest/ingest.test.ts` | -- |
| AC3.7 | `ingest/validate.test.ts`, `ingest/ingest.test.ts` | -- |
| AC4.1 | `archivist/stages/scan.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.2 | `archivist/stages/dedup.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.3 | `archivist/stages/consolidate.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.4 | `archivist/stages/crossref.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.5 | `archivist/stages/prune.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.6 | `archivist/stages/reflect.test.ts`, `archivist/pipeline.test.ts` | -- |
| AC4.7 | Migration file exists (`013_hnsw_vector_index.sql`) | Phase 4 Steps 1-3 |
| AC4.8 | `archivist/activity.test.ts` | Phase 5 Steps 1-2 |
| AC4.9 | `archivist/activity.test.ts` | Phase 5 Steps 3-4 |
| AC4.10 | `archivist/stages/scan.test.ts`, `archivist/activity.test.ts` | -- |
| AC4.11 | `dedup.test.ts`, `consolidate.test.ts`, `crossref.test.ts`, `reflect.test.ts`, `pipeline.test.ts` | -- |
