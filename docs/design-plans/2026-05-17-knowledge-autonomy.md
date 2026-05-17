# Knowledge Autonomy Design

## Summary

Constellation is a stateful AI agent daemon that maintains persistent memory across sessions. This design extends it with four autonomous knowledge-maintenance capabilities: a secret store for managing API credentials, a runtime tool creation system, a file ingestion pipeline, and a background archivist that continuously curates the agent's memory.

The high-level approach is additive — four independent modules (`src/secrets/`, `src/custom-tool/`, `src/ingest/`, `src/archivist/`) that integrate through existing infrastructure (memory store, tool registry, Deno executor, activity system) without coupling to each other. The archivist runs as a sub-agent on a circadian schedule, performing lightweight deduplication during wake cycles and full LLM-assisted consolidation during sleep. Custom tools and ingested knowledge persist to PostgreSQL and survive restarts. The design deliberately avoids approval workflows: secrets and tools are immediately available once created, with the only human-controlled gate being a config flag (`secrets.agent_managed`) that can disable agent-facing secret tools entirely.

## Definition of Done

Four interconnected features that give Constellation autonomous knowledge maintenance, runtime extensibility, external knowledge ingestion, and credential management:

1. **Archivist**: A background pipeline (separate sub-agent) that autonomously deduplicates, consolidates, cross-references, prunes, and reflects on Constellation's memory blocks. Runs incrementally during wake cycles and fully during sleep. Writes reflections to working memory.

2. **Custom Tools**: The agent can define new tools at runtime (name, description, parameter schema, TypeScript implementation) that are immediately registered as both native model tools and sandbox-callable stubs. Persisted to PostgreSQL and reloaded on restart. No approval system.

3. **File Ingestion**: A tool that reads files from `/workspace`, semantically chunks them (preserving heading context), and stores chunk/summary pairs as archival memory blocks with embeddings. Enables the agent to import reference material for later recall.

4. **Secrets Management**: A PostgreSQL-backed secret store with tools for the agent to store, list, and delete API keys. Secrets are injectable into Deno sandbox runs. A config flag (`secrets.agent_managed`) controls whether agent tools are available. Human-managed secrets from config.toml/env vars continue to work.

**Out of scope**: TUI/Discord interfaces, session lifecycle management, approval/grant workflows.

## Acceptance Criteria

### knowledge-autonomy.AC1: Secrets Management
- **knowledge-autonomy.AC1.1 Success:** Agent stores a secret via `secret_set` and it persists in PostgreSQL
- **knowledge-autonomy.AC1.2 Success:** Agent lists secret key names via `secret_list` without exposing values
- **knowledge-autonomy.AC1.3 Success:** Agent deletes a secret via `secret_delete` and it is removed from store
- **knowledge-autonomy.AC1.4 Success:** Secrets are injected as environment variables into Deno sandbox execution
- **knowledge-autonomy.AC1.5 Success:** Config secrets (env vars) take precedence over agent-stored secrets with the same key
- **knowledge-autonomy.AC1.6 Failure:** Secret tools are not registered when `secrets.agent_managed = false`
- **knowledge-autonomy.AC1.7 Failure:** Secret values never appear in tool output or conversation context

### knowledge-autonomy.AC2: Custom Tools
- **knowledge-autonomy.AC2.1 Success:** `ToolRegistry.unregister()` removes a tool by name
- **knowledge-autonomy.AC2.2 Success:** Agent creates a custom tool via `create_tool` and it is callable as a native model tool on the next turn
- **knowledge-autonomy.AC2.3 Success:** Agent creates a custom tool and it is callable from sandbox code via generated stub
- **knowledge-autonomy.AC2.4 Success:** Custom tools persist to PostgreSQL and reload on restart
- **knowledge-autonomy.AC2.5 Success:** Agent updates a custom tool and the updated version is used on subsequent calls
- **knowledge-autonomy.AC2.6 Success:** Agent deletes a custom tool and it is no longer callable or visible
- **knowledge-autonomy.AC2.7 Failure:** Creating a tool with a built-in tool's name returns an error
- **knowledge-autonomy.AC2.8 Success:** Custom tool code can access secrets via sandbox environment variables

### knowledge-autonomy.AC3: File Ingestion
- **knowledge-autonomy.AC3.1 Success:** Agent ingests a markdown file and chunks are stored as archival memory blocks with `knowledge:` label prefix
- **knowledge-autonomy.AC3.2 Success:** Each chunk preserves heading hierarchy context
- **knowledge-autonomy.AC3.3 Success:** Chunks have embeddings generated and stored
- **knowledge-autonomy.AC3.4 Success:** Re-ingesting the same file replaces old chunks atomically
- **knowledge-autonomy.AC3.5 Success:** Ingested chunks are retrievable via recall/semantic search
- **knowledge-autonomy.AC3.6 Failure:** Path traversal above workspace root is rejected
- **knowledge-autonomy.AC3.7 Failure:** Binary files and files over 1MB are rejected with descriptive error

### knowledge-autonomy.AC4: Archivist
- **knowledge-autonomy.AC4.1 Success:** Scan stage enumerates all mutable (readwrite, non-pinned) blocks in working and archival tiers
- **knowledge-autonomy.AC4.2 Success:** Dedup stage identifies near-duplicate blocks above similarity threshold and returns merge candidates
- **knowledge-autonomy.AC4.3 Success:** Consolidate stage merges duplicate groups into single blocks via summarization model
- **knowledge-autonomy.AC4.4 Success:** Crossref stage appends related block references to block content
- **knowledge-autonomy.AC4.5 Success:** Prune stage removes empty and whitespace-only blocks
- **knowledge-autonomy.AC4.6 Success:** Reflect stage writes observations to `archivist:reflection` working memory block
- **knowledge-autonomy.AC4.7 Success:** HNSW vector index improves similarity search performance
- **knowledge-autonomy.AC4.8 Success:** Incremental pipeline runs on configured schedule during wake cycles
- **knowledge-autonomy.AC4.9 Success:** Full pipeline runs during sleep at configured offset
- **knowledge-autonomy.AC4.10 Failure:** Archivist skips readonly, familiar, pinned, append blocks and archivist:*/diary:* labels
- **knowledge-autonomy.AC4.11 Failure:** Missing embedding provider causes dedup/crossref to be skipped (not crash), other stages continue

## Glossary

- **Archivist**: The background knowledge-maintenance sub-agent defined in this design. Runs deduplication, consolidation, cross-referencing, pruning, and reflection over Constellation's memory blocks on a configurable schedule.
- **Archival memory**: The lowest-priority, highest-capacity memory tier in Constellation's three-tier system. Used for long-term storage of facts, ingested documents, and compressed context.
- **Working memory**: The middle tier. Used for session-relevant state, agent self-notes, and short-lived structured data like archivist reflections.
- **Memory block**: A discrete unit of stored memory with a label, content, permission level, tier assignment, and optionally an embedding vector. The fundamental storage primitive.
- **Sub-agent**: A secondary agent instance sharing the main agent's model, memory, and tools but running an isolated conversation. Used for background tasks like the subconscious and (per this design) the archivist.
- **FCIS (Functional Core / Imperative Shell)**: Architectural pattern separating pure business logic (no I/O, deterministic) from code that orchestrates I/O and side effects. Mandatory file-level classification in this codebase.
- **Port/Adapter**: Hexagonal architecture pattern. A port is a TypeScript interface defining a capability (e.g., `SecretStore`). An adapter is the concrete implementation (e.g., `PostgresSecretStore`).
- **Deno sandbox**: A Deno subprocess used to execute untrusted TypeScript code in an isolated runtime with IPC-based communication back to the main Bun process.
- **Tool registry**: The mutable runtime registry (`ToolRegistry`) tracking all available tools. The model sees the current snapshot each turn via `toModelTools()`.
- **Stubs / `generateStubs()`**: Auto-generated TypeScript wrapper functions allowing sandbox code to call host-registered tools as local functions via the IPC bridge.
- **HNSW index**: Hierarchical Navigable Small World — a graph-based approximate nearest-neighbour index from pgvector. Faster than exact cosine similarity scans at scale.
- **pgvector**: PostgreSQL extension adding vector storage and similarity search operators (cosine, L2 distance).
- **Cosine similarity**: Angular similarity between two embedding vectors (range -1 to 1). Used in the archivist's dedup and crossref stages.
- **Embedding**: A fixed-dimension float vector representation of text. Semantically similar text produces geometrically close vectors.
- **Summarization model**: A secondary LLM (potentially cheaper) used for content-heavy operations like consolidating duplicates and writing reflections.
- **Circadian / activity system**: Constellation's sleep/wake cycle (`src/activity/`). Controls when background tasks run.
- **`sleepTaskCron()`**: Helper computing a cron expression at a fixed offset after sleep start.
- **`systemScheduler`**: System-owned PostgreSQL-backed scheduler for daemon tasks, distinct from agent-owned tasks.
- **Label prefix**: Naming convention (e.g., `knowledge:*`, `archivist:*`) grouping related memory blocks, queryable via `getBlocksByLabelPrefix()`.
- **Token budget**: Cap on total LLM tokens consumed by the archivist per pipeline run. Prevents runaway costs.

## Architecture

Four independent modules (`src/secrets/`, `src/custom-tool/`, `src/ingest/`, `src/archivist/`) interacting through existing Constellation infrastructure. No direct coupling between modules — they connect through the memory store, tool registry, Deno executor, activity system, and summarization model.

### Secrets Management (`src/secrets/`)

Port interface providing a unified secret store with two layered sources:

- **Config secrets**: Extracted from environment variable overrides (`ANTHROPIC_API_KEY`, `BRAVE_API_KEY`, etc.). Read-only. Take precedence on conflict.
- **Agent-managed secrets**: Stored in PostgreSQL via `SecretStore` port. Full CRUD when `secrets.agent_managed = true`.

A `createSecretResolver()` factory merges both sources. The resolver is injected into the Deno executor, which passes resolved secrets as environment variables to sandbox subprocesses.

```typescript
type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<ReadonlyArray<string>>;
};

type SecretResolver = {
  resolve(keys: ReadonlyArray<string>): Promise<Record<string, string>>;
  listKeys(): Promise<ReadonlyArray<string>>;
};
```

Agent tools (`secret_set`, `secret_list`, `secret_delete`) are registered conditionally when `secrets.agent_managed = true`. Tool output never includes secret values — `secret_list` returns key names only.

### Custom Tools (`src/custom-tool/`)

Runtime tool creation backed by PostgreSQL. The agent defines tools via `create_tool`, which persists the definition and registers it in the existing `ToolRegistry` immediately. Since `toModelTools()` is called per turn during context building, newly created tools are visible to the model on the next turn. Stubs for sandbox calling are generated automatically via the existing `generateStubs()`.

```typescript
type CustomToolDefinition = {
  id: string;
  owner: string;
  name: string;
  description: string;
  parameters: ReadonlyArray<ToolParameter>;
  code: string;
  created_at: Date;
  updated_at: Date;
};

type CustomToolManager = {
  create(def: Omit<CustomToolDefinition, 'id' | 'created_at' | 'updated_at'>): Promise<CustomToolDefinition>;
  update(owner: string, name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'code'>>): Promise<CustomToolDefinition>;
  delete(owner: string, name: string): Promise<void>;
  list(owner: string): Promise<ReadonlyArray<CustomToolDefinition>>;
  loadAll(owner: string): Promise<void>;
};
```

Execution model: when a custom tool is invoked (native or sandbox), the handler retrieves the tool's TypeScript code, wraps it with invocation parameters injected as a constant, resolves secrets via `SecretResolver`, and executes through the existing Deno runtime.

A new `unregister(name)` method is added to `ToolRegistry` for tool deletion (single Map delete).

### File Ingestion (`src/ingest/`)

A chunker (Functional Core) splits document text into semantically coherent pieces, and an ingestor (Imperative Shell) orchestrates file reading, chunking, embedding generation, and storage.

```typescript
type Chunk = {
  content: string;
  headingContext: string;
  index: number;
  tokenEstimate: number;
};

function chunkDocument(text: string, options?: { maxChunkTokens?: number }): ReadonlyArray<Chunk>;
```

Chunking strategy: split on markdown headings preserving heading hierarchy as context per chunk (~1500 tokens/chunk default). Non-markdown files split on double newlines. Each chunk carries its heading ancestry so it's meaningful in isolation.

Storage: each chunk becomes an archival memory block with label `knowledge:<filename>:<chunk-index>`. Re-ingestion deletes existing blocks with the same label prefix first (idempotent within a single transaction). All blocks get `readwrite` permission.

Path validation: file paths are relative to workspace root (`/workspace`). Traversal above workspace root is rejected. Binary files and files over 1MB are rejected.

### Archivist (`src/archivist/`)

Background knowledge maintenance pipeline running as a separate sub-agent (following the subconscious agent pattern). Shares model, memory, tools, and persistence with the main agent. Gets its own isolated conversation ID. Uses the existing summarization model for LLM-dependent stages.

**Pipeline modes:**

- `runIncremental()`: scan → dedup → prune. Lightweight, no LLM calls. Runs during wake cycles.
- `runFull()`: scan → dedup → consolidate → crossref → prune → reflect. Full pipeline with LLM. Runs during sleep.

**Six stages:**

| Stage | LLM | Purpose |
|-------|-----|---------|
| Scan | No | Enumerate mutable memory blocks, build snapshot (id, label, tier, content hash, embedding) |
| Dedup | No | Cosine similarity on embeddings, threshold-based (default 0.92). Returns merge candidate groups |
| Consolidate | Yes | Summarization model merges each group into a single block. Deletes originals |
| Crossref | No | Find related blocks (similarity above 0.75, below dedup threshold). Append `[Related: label1, label2]` |
| Prune | No | Delete empty blocks, whitespace-only blocks |
| Reflect | Yes | Summarization model reviews recent actions and memory health. Writes to `archivist:reflection` working memory block |

**Scope boundaries:**

- Mutable: `readwrite` blocks in working and archival tiers
- Immutable (skipped): `readonly`, `familiar`, `pinned`, `append` permission blocks
- Excluded labels: `archivist:*` (self-referential), `diary:*` (user-managed)

**Graceful degradation:**

- No embedding provider → skip dedup, crossref
- No summarization model → skip consolidate, reflect
- Stage failure → log error, continue to next stage
- Token budget exhausted → skip remaining LLM-dependent stages

**State tracking:** `archivist:state` working memory block stores content hash snapshot from last scan for incremental change detection.

**Scheduling:**

- Incremental: regular system task via `systemScheduler`, configurable cron (default `0 */3 * * *`), suppressed during sleep by activity dispatch
- Full: sleep task added to `SLEEP_TASK_NAMES`, scheduled via `sleepTaskCron()` with configurable offset (default 3 hours after sleep start)

### Feature Interaction Map

```
Secrets ──────────► Deno Executor ◄──── Custom Tools (execution)

Custom Tools ─────► Tool Registry ◄──── Agent Loop (dispatch + stubs)

File Ingestion ───► Memory Store  ◄──── Archivist (dedup/consolidate/crossref)
                    (archival tier,
                     knowledge:* labels)

Archivist ────────► Summarization Model (consolidate + reflect)
              ────► Activity System (incremental=wake, full=sleep)
              ────► Memory Store (read/write/delete blocks)
```

## Existing Patterns

Investigation found these existing patterns that this design follows:

**Sub-agent pattern** (`src/index.ts:1212-1258`): The subconscious agent shares model, memory, tools, and persistence with the main agent while maintaining an isolated conversation ID. Archivist follows this pattern exactly.

**System-owned scheduled tasks** (`src/index.ts:1614-1629`): Check-then-register pattern with `systemScheduler`. Idempotent on restart. Archivist incremental and full tasks follow this pattern.

**Sleep task pattern** (`src/activity/schedule.ts`, `src/activity/sleep-events.ts`): `SLEEP_TASK_NAMES` array, `sleepTaskCron()` offset helper, event builder functions, switch-case routing in `handleSleepTask`. Full archivist run follows this pattern.

**Tool registration** (`src/tool/registry.ts`): Mutable `Map`-based registry with `register()`, `dispatch()`, `generateStubs()`, `toModelTools()`. Custom tools register through the same interface. `toModelTools()` is called per turn, so runtime registration is naturally visible.

**Memory block label prefixes** (`src/diary/inject.ts`, `src/memory/postgres-store.ts:149-169`): `getBlocksByLabelPrefix()` for organizing related blocks. File ingestion uses `knowledge:*` prefix. Archivist state uses `archivist:*` prefix.

**Port/adapter boundaries**: All four modules follow the `types.ts` port definition + implementation file pattern.

**Factory functions**: `createSecretResolver()`, `createCustomToolManager()`, `createIngestor()`, `createArchivistPipeline()`.

**Transparent nested transactions** (`src/persistence/postgres.ts:89-126`): File ingestion's atomic re-ingestion (delete old chunks + create new) and archivist's consolidation (delete originals + create merged) use `withTransaction()`.

**New pattern introduced:** `unregister()` on `ToolRegistry`. Divergence justified by custom tool deletion requiring cleanup. Single-line addition (Map delete) with minimal surface area change.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Secrets Management
**Goal:** PostgreSQL-backed secret store with merged resolver and agent tools

**Components:**
- Database migration for `secrets` table in `src/persistence/migrations/`
- `SecretStore` port and `PostgresSecretStore` adapter in `src/secrets/`
- `SecretResolver` factory in `src/secrets/` — merges config and stored secrets
- Secret tools (`secret_set`, `secret_list`, `secret_delete`) in `src/tool/builtin/`
- Config schema extension: `[secrets]` section with `agent_managed` flag in `src/config/schema.ts`
- Deno executor integration: inject resolved secrets as subprocess env vars in `src/runtime/executor.ts`
- Wiring in `src/index.ts`: create store, create resolver, conditionally register tools

**Dependencies:** None (foundation for other features)

**Covers:** knowledge-autonomy.AC1.1 through knowledge-autonomy.AC1.7

**Done when:** Secrets can be stored, listed, deleted via agent tools. Config secrets take precedence. Secrets are available in sandbox execution as environment variables. Agent tools are absent when `agent_managed = false`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Tool Registry Extension
**Goal:** Add `unregister()` to `ToolRegistry` and verify runtime registration works

**Components:**
- `unregister(name)` method on `ToolRegistry` in `src/tool/registry.ts`
- Tests verifying runtime register/unregister/re-register cycle in `src/tool/registry.test.ts`

**Dependencies:** None (independent, but required before Phase 3)

**Covers:** knowledge-autonomy.AC2.1

**Done when:** Tools can be unregistered by name. Registry tests pass for the full lifecycle.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Custom Tools
**Goal:** Runtime tool creation, persistence, and execution

**Components:**
- Database migration for `custom_tools` table in `src/persistence/migrations/`
- `CustomToolDefinition` types in `src/custom-tool/types.ts`
- `CustomToolManager` in `src/custom-tool/manager.ts` — CRUD, registry integration, Deno execution wrapping
- Agent tools (`create_tool`, `list_tools`, `delete_tool`, `update_tool`) in `src/tool/builtin/`
- Startup loading in `src/index.ts`: `loadAll()` after tool registry is created
- Secret injection: manager uses `SecretResolver` for sandbox execution

**Dependencies:** Phase 1 (secrets for sandbox injection), Phase 2 (unregister for deletion)

**Covers:** knowledge-autonomy.AC2.2 through knowledge-autonomy.AC2.8

**Done when:** Agent can create tools that are immediately callable as native tool calls and from sandbox code. Tools persist across restarts. Tools can be updated and deleted. Custom tool code can access secrets in sandbox.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: File Ingestion
**Goal:** Workspace file reading with semantic chunking into archival memory

**Components:**
- `chunkDocument()` pure function in `src/ingest/chunker.ts` — markdown-aware splitting with heading context
- `createIngestor()` factory in `src/ingest/ingest.ts` — file reading, validation, chunking, embedding, storage
- `ingest_file` tool in `src/tool/builtin/`
- Wiring in `src/index.ts`: create ingestor, register tool

**Dependencies:** None (uses existing memory store and embedding provider)

**Covers:** knowledge-autonomy.AC3.1 through knowledge-autonomy.AC3.7

**Done when:** Agent can ingest workspace files. Files are chunked with heading context preserved. Chunks are stored as archival memory blocks with embeddings. Re-ingestion replaces old chunks atomically. Path traversal is rejected. Binary and oversized files are rejected.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Vector Index Migration
**Goal:** HNSW index on memory block embeddings for efficient similarity search

**Components:**
- Database migration in `src/persistence/migrations/` — `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`

**Dependencies:** None (improves performance for Phase 6, but not functionally required)

**Covers:** knowledge-autonomy.AC4.7

**Done when:** Migration runs successfully. Similarity searches use the index.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Archivist Pipeline
**Goal:** Six-stage knowledge maintenance pipeline with incremental and full modes

**Components:**
- `ArchivistConfig` types in `src/archivist/types.ts`
- Stage functions in `src/archivist/stages/` — scan, dedup, consolidate, crossref, prune, reflect
- `createArchivistPipeline()` in `src/archivist/pipeline.ts` — orchestrates stages with budget tracking
- Config schema extension: `[archivist]` section in `src/config/schema.ts`

**Dependencies:** Phase 5 (vector index for dedup performance)

**Covers:** knowledge-autonomy.AC4.1 through knowledge-autonomy.AC4.6

**Done when:** Incremental pipeline (scan/dedup/prune) runs successfully. Full pipeline (all six stages) runs successfully. Duplicate blocks are detected and merged. Related blocks get cross-references. Empty blocks are pruned. Reflections are written to working memory. Graceful degradation works when embedding or summarization model is unavailable.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Archivist Activity Integration
**Goal:** Wire archivist into circadian activity system

**Components:**
- `SLEEP_TASK_NAMES` extension in `src/activity/schedule.ts`
- `buildArchivistEvent()` in `src/activity/sleep-events.ts`
- Handler routing in `src/index.ts`: new cases in `handleSleepTask` and `handleSystemSchedulerTask`
- Archivist sub-agent creation in `src/index.ts` (following subconscious agent pattern)
- System task registration: incremental (regular) and full (sleep) tasks

**Dependencies:** Phase 6 (pipeline must exist before scheduling)

**Covers:** knowledge-autonomy.AC4.8 through knowledge-autonomy.AC4.11

**Done when:** Incremental pipeline runs on schedule during wake. Full pipeline runs during sleep at configured offset. Archivist is suppressed during sleep for incremental runs. Archivist sub-agent has isolated conversation. State is tracked in `archivist:state` working memory block.
<!-- END_PHASE_7 -->

## Additional Considerations

**Token budget enforcement:** The archivist's token budget prevents runaway LLM costs during full runs. When the budget is exhausted mid-pipeline, remaining LLM-dependent stages (consolidate, reflect) are skipped but non-LLM stages (crossref, prune) continue. Budget consumption is logged per stage for observability.

**Custom tool name collisions:** `create_tool` validates that the requested name doesn't collide with any built-in tool name. This prevents an agent from accidentally shadowing core functionality like `memory_read` or `execute_code`.

**Ingestion idempotency:** Re-ingesting a file deletes all existing chunks with the matching label prefix before creating new ones, within a single transaction. This handles updated files cleanly but means the old chunks are gone — there's no versioning. If versioning becomes needed, it would be a separate feature.

**No vector index dimension lock:** The HNSW index migration must specify a vector dimension. This ties the index to the embedding model's output dimension. If the embedding model changes, the index needs rebuilding. The migration should use the current embedding model's dimension (e.g., 1536 for `text-embedding-3-small`, 3072 for `text-embedding-3-large`).
