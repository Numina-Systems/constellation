# Reflexive Recall Design

## Summary

Reflexive Recall is an automatic context-retrieval pipeline that fires before every model call. Rather than waiting for the agent to decide it needs to look something up, the system intercepts each incoming user message, decomposes it into semantic search queries and named entities via a utility model call, and retrieves relevant documents from memory and conversations using hybrid search (PostgreSQL full-text + pgvector cosine similarity + RRF). The results are injected into the system prompt so the main model sees relevant knowledge, past archive summaries, and skills without ever having to ask for them.

The implementation is entirely local — no external recall service. It slots into the existing agent loop after context compaction and skill injection, uses infrastructure already present in the codebase (`SearchStore`, `ModelProvider`, `EmbeddingProvider`), and degrades gracefully at each failure point. The feature is off by default behind a config flag and adds roughly 1-3 seconds of latency per turn, which is proportionally small relative to model response time.

Adapted from the [constellation-lite reflexive recall design](https://github.com/Numina-Systems/johnson/blob/main/docs/design-plans/2026-05-06-reflexive-recall.md), reworked for Constellation's PostgreSQL + pgvector storage, `SearchStore` domain architecture, `ContextProvider` pattern, and `ModelProvider`-based utility model calls.

## Definition of Done

1. Every turn, before the main model sees user input, the system automatically decomposes the message into semantic queries and named entities, retrieves relevant documents, and injects them into the system prompt.
2. Decomposition uses a utility `ModelProvider` call (configurable model, separate from the main model, reusing the `summarization` provider) to produce 1-4 semantic queries + named entities from the user message.
3. Retrieval uses existing `SearchStore.search()` with `mode: 'hybrid'` for semantic queries and `mode: 'keyword'` for named entities, searching `memory` and `conversations` domains.
4. Retrieved context is injected into the system prompt via a `ContextProvider`, capped at a configurable token budget (default ~4096 tokens).
5. The system degrades gracefully: utility model failure falls back to raw-message single query; embedding failure degrades hybrid to keyword-only; empty store produces no injection.
6. Recall runs after context compaction, never triggers compaction itself.
7. Recall is gated behind `recall_enabled` config flag (default false). No new config sections required — fields added to `[agent]`.
8. Trace recording fires with timing and fragment count for diagnostics (via existing `TraceRecorder`).

## Acceptance Criteria

### reflexive-recall.AC1: Decomposition
- **reflexive-recall.AC1.1 Success:** Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"]
- **reflexive-recall.AC1.2 Success:** Multi-topic message produces 2-4 distinct queries covering each topic
- **reflexive-recall.AC1.3 Edge:** Single-word message produces one query containing that word
- **reflexive-recall.AC1.4 Edge:** Message with no proper nouns produces empty entities array

### reflexive-recall.AC2: Retrieval
- **reflexive-recall.AC2.1 Success:** Each semantic query returns up to 5 results via `SearchStore.search({ mode: 'hybrid' })`
- **reflexive-recall.AC2.2 Success:** Named entities return results via `SearchStore.search({ mode: 'keyword' })` (limit 3 per entity)
- **reflexive-recall.AC2.3 Success:** Results from multiple queries are merged and ranked by RRF score

### reflexive-recall.AC3: Domain and Tier Filtering
- **reflexive-recall.AC3.1 Success:** Memory domain results with tier `core`, `working`, and `archival` appear in results
- **reflexive-recall.AC3.2 Success:** Conversation domain results appear in results
- **reflexive-recall.AC3.3 Failure:** Results with tier `core` that are already in the system prompt (via `buildSystemPrompt`) are deduplicated out

### reflexive-recall.AC4: Token Budget
- **reflexive-recall.AC4.1 Success:** Total recalled content is <= configurable budget (default 4096 tokens)
- **reflexive-recall.AC4.2 Success:** If a single fragment exceeds remaining budget, it is truncated not dropped
- **reflexive-recall.AC4.3 Edge:** Zero matching documents produces no system prompt section

### reflexive-recall.AC5: Fallback Cascade
- **reflexive-recall.AC5.1 Success:** Utility model failure falls back to raw message as single hybrid search query
- **reflexive-recall.AC5.2 Success:** Malformed JSON from utility model triggers same fallback
- **reflexive-recall.AC5.3 Success:** Embedding failure degrades `SearchStore` hybrid search to keyword-only (existing SearchStore behavior)
- **reflexive-recall.AC5.4 Success:** Both utility model and embeddings down still returns keyword results

### reflexive-recall.AC6: Guard Conditions
- **reflexive-recall.AC6.1 Success:** `recall_enabled=false` skips recall entirely (default behavior)
- **reflexive-recall.AC6.2 Success:** Messages < 10 chars skip recall
- **reflexive-recall.AC6.3 Success:** Missing embedding provider skips recall (returns null)
- **reflexive-recall.AC6.4 Success:** Missing summarization model config skips decomposition (falls back to raw query)

### reflexive-recall.AC7: Prompt Injection
- **reflexive-recall.AC7.1 Success:** Recalled context section appears via `ContextProvider`, after core memory and before skills
- **reflexive-recall.AC7.2 Success:** Each fragment rendered with label/domain header and content, no score metadata
- **reflexive-recall.AC7.3 Success:** Absent recall result produces no section in prompt

### reflexive-recall.AC8: Trace Recording
- **reflexive-recall.AC8.1 Success:** Trace recorded via `TraceRecorder` with elapsed ms and fragment count
- **reflexive-recall.AC8.2 Success:** Trace fires even when recall returns zero fragments

### reflexive-recall.AC9: Compaction Ordering
- **reflexive-recall.AC9.1 Success:** Recall runs after compaction check completes
- **reflexive-recall.AC9.2 Success:** Recalled context tokens are not included in compaction threshold estimate

## Glossary

- **ModelProvider**: The universal LLM port interface (`complete(request): Promise<ModelResponse>`). Used for both the main model and utility tasks like decomposition. The summarization model (configured via `[summarization]` config section) is reused for recall decomposition.
- **SearchStore**: The search port interface (`search(params): Promise<SearchResult[]>`) in `src/search/store.ts` that coordinates multi-domain searches. Supports `semantic`, `keyword`, and `hybrid` modes.
- **SearchDomain**: Pluggable search implementations. Built-in domains: `memory` (memory blocks with tiers) and `conversations` (message history). Registered via `SearchStore.registerDomain()`.
- **RRF (Reciprocal Rank Fusion)**: Score-merging algorithm in `src/search/rrf.ts` that combines ranked result lists from multiple queries into a single ranked list.
- **ContextProvider**: A synchronous function `() => string | undefined` registered in `AgentDependencies.contextProviders`. Output is appended to the system prompt. Used by scheduling context, prediction context, and now recall.
- **EmbeddingProvider**: Interface for generating vector embeddings (`embed(text): Promise<number[]>`). Adapters: OpenAI, Ollama. Used by SearchStore for semantic search query embedding.
- **Memory blocks**: The persistence unit for the three-tier memory system. Each block has `owner`, `label`, `content`, `tier` (core/working/archival), `permission`, and an optional `embedding` vector. Uniquely identified by `(owner, label)`.
- **Functional Core / Imperative Shell**: Module design pattern annotated on every file. Pure functions (Functional Core) are kept separate from I/O and orchestration (Imperative Shell).
- **Context compaction**: Existing mechanism that fires when conversation history exceeds the token budget — summarises older messages into archival memory blocks. Recall runs after compaction so it can see freshly written archives.
- **Token budget**: A configurable ceiling (default 4096 tokens for recall) on how much retrieved content can be injected into the system prompt.
- **Decomposition**: The step that converts a raw user message into structured search inputs — semantic queries (short topic phrases) and named entities (proper nouns) — using the utility model.
- **Fallback cascade**: Ordered sequence of degraded behaviors: utility model failure → raw message as query; embedding failure → keyword-only; both down → keyword on raw message; no results → no injection.
- **TraceRecorder**: Existing interface (`src/reflexion/types.ts`) for fire-and-forget operation tracing. Records tool name, input, output summary, duration, and success/failure.

## Architecture

Reflexive recall is a pre-turn pipeline that fires automatically before every model call. It removes recall from the agent's decision loop — the agent never chooses to remember; relevant context is already present when it starts reasoning.

Inspired by the [pondsiders reflexive recall architecture](https://pondsiders.github.io/identity/workshop/how-i-persist/), adapted from constellation-lite's design for Constellation's PostgreSQL + pgvector infrastructure.

### Pipeline

```
user message
    │
    ▼
┌─────────────────────┐
│ Utility ModelProvider│
│ decompose(message)   │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
semantic    named
queries     entities
(1-4)       (0-N)
    │           │
    ▼           ▼
SearchStore   SearchStore
mode:hybrid   mode:keyword
(per query)   (per entity)
    │           │
    └─────┬─────┘
          │
    ┌─────┴─────┐
    │ deduplicate │
    │ rank + trim │
    │ to budget   │
    └─────┬─────┘
          │
          ▼
  ContextProvider
  injection
```

### Components

**Decomposer** (`src/recall/decompose.ts`, Functional Core) — Takes user message text, calls the utility `ModelProvider` with a structured prompt requesting JSON output. Returns semantic queries (1-4 short phrases, 2-6 words each distilling message topics) and named entities (proper nouns for direct lookup). Parsing logic separated from model call for testability. Reuses the `summarization` model provider (same pattern as compaction).

**Retriever** (`src/recall/retrieve.ts`, Functional Core) — Takes decomposition result, runs each semantic query through `SearchStore.search({ mode: 'hybrid', domains: ['memory', 'conversations'], limit: 5 })`, runs each entity through `SearchStore.search({ mode: 'keyword', domains: ['memory', 'conversations'], limit: 3 })`. Deduplicates by result `id` (highest score wins), ranks by RRF score, and trims to token budget. Truncates individual fragments if needed rather than dropping them entirely.

**Orchestrator** (`src/recall/index.ts`, Imperative Shell) — `performRecall()` wires decomposition and retrieval together. Handles guard conditions (skip on empty message, missing dependencies, very short input). Manages the fallback cascade. Returns a `RecallResult` or `null`.

**Context Provider** — `createRecallContextProvider()` in `src/recall/context.ts` returns a `ContextProvider` function. The recall result is set per-turn by the agent loop before the provider is evaluated. When present, renders a `## Recalled Context` section. Each fragment rendered as `### [label | domain]\ncontent`. No score metadata exposed to the model.

### Contracts

```typescript
// src/recall/types.ts

type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};

type RecallFragment = {
  readonly id: string;
  readonly label: string;
  readonly domain: SearchDomainName;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
  readonly tier: string | null;
};

type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};
```

```typescript
// src/recall/decompose.ts

function decomposeMessage(
  message: string,
  model: ModelProvider,
  modelName: string,
): Promise<DecompositionResult>;

function parseDecompositionResponse(
  raw: string,
): DecompositionResult;
```

```typescript
// src/recall/retrieve.ts

function retrieveContext(
  decomposition: DecompositionResult,
  searchStore: SearchStore,
  embedding: EmbeddingProvider,
  tokenBudget: number,
): Promise<RecallResult>;
```

```typescript
// src/recall/index.ts

type RecallDeps = {
  readonly searchStore: SearchStore;
  readonly embedding: EmbeddingProvider;
  readonly model: ModelProvider;        // Utility model (summarization provider)
  readonly modelName: string;           // Utility model name
  readonly tokenBudget: number;
  readonly traceRecorder?: TraceRecorder;
  readonly owner?: string;
  readonly conversationId?: string;
};

function performRecall(
  message: string,
  deps: RecallDeps,
): Promise<RecallResult | null>;
```

```typescript
// src/recall/context.ts

type RecallContextState = {
  setResult(result: RecallResult | null): void;
};

function createRecallContextProvider(): ContextProvider & RecallContextState;
```

### Data Flow in Agent Loop

Position in `processMessage()` (src/agent/agent.ts):

1. User message persisted *(existing)*
2. Load conversation history *(existing)*
3. Compaction check — if over budget, compress *(existing)*
4. **Tool loop begins** *(existing)*
   - Build fresh system prompt with context providers *(existing)*
   - **Recall step** *(new, inside tool loop before skill injection)*
     - Extract text from user message
     - `performRecall(text, recallDeps)`
     - `recallContextState.setResult(result)` — updates the `ContextProvider`
     - System prompt is rebuilt with recalled context via context providers
   - Retrieve and append relevant skills *(existing)*
   - Build messages *(existing)*
   - Pre-flight guard *(existing)*
   - Call model *(existing)*

**Design decision**: Recall is performed inside the tool loop so the system prompt is rebuilt fresh each round, but the recall result is cached — decomposition only fires on the first round. Subsequent rounds reuse the cached result since the user message hasn't changed.

### Guard Conditions

Recall is skipped (returns null) when:
- `recall_enabled` is false in config
- No embedding provider configured
- User message is empty or < 10 characters
- Utility model (summarization) not configured (falls back to raw query, doesn't skip entirely)

When the utility model is unavailable but embeddings work, decomposition is skipped and the raw message is used as a single hybrid search query.

### Fallback Cascade

| Failure | Behavior |
|---------|----------|
| Utility model unavailable | Skip decomposition, raw message as single hybrid search query |
| Utility model returns malformed JSON | Same — fall back to raw message single query |
| Embedding provider unavailable | Recall skipped entirely (guard condition) |
| SearchStore returns empty results | Recall returns null, no section injected |

**Divergence from constellation-lite**: In constellation-lite, embedding failure degrades hybrid search to FTS-only (SQLite FTS5 fallback). In Constellation, `SearchStore` handles embedding failure internally — if embedding generation fails for the query, it can degrade to keyword mode. However, since the search store requires an `EmbeddingProvider` at construction time, a missing embedding provider skips recall entirely rather than degrading to keyword-only.

## Existing Patterns

Investigation found the following patterns this design follows:

- **Functional Core / Imperative Shell** — All modules in `src/` are annotated with their pattern. Decomposition and retrieval are pure (Functional Core). Orchestration is Imperative Shell. Follows convention from `src/search/`, `src/compaction/`, `src/reflexion/`.
- **ModelProvider usage** — Same `complete(request)` pattern used in `src/compaction/compactor.ts` for summarization. The summarization model provider (from `[summarization]` config) is reused for decomposition.
- **SearchStore** — `src/search/store.ts` defines the port; `postgres-store.ts` is the adapter. Recall uses `SearchStore.search()` with different modes for semantic and entity queries.
- **ContextProvider pattern** — `ContextProvider = () => string | undefined` from `src/agent/types.ts`. Used by scheduling context and prediction context. Recall follows the same pattern — a stateful context provider whose result is set per-turn.
- **TraceRecorder** — `src/reflexion/types.ts` defines fire-and-forget trace recording. Recall traces follow the same pattern as tool dispatch traces in `agent.ts`.
- **Graceful degradation** — Existing embedding and search code handles unavailable providers without throwing. Recall follows the same pattern.
- **Config** — New fields added to `AgentConfigSchema` with defaults. No new TOML sections required.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types and Decomposition Module

**Goal:** Define recall types and parse user messages into semantic queries and named entities via the utility model.

**Components:**
- `src/recall/types.ts` (Functional Core) — `DecompositionResult`, `RecallFragment`, `RecallResult` types
- `src/recall/decompose.ts` (Functional Core) — `decomposeMessage()` and `parseDecompositionResponse()` functions
- `src/recall/decompose.test.ts` — Unit tests for JSON parsing (valid, malformed, edge cases) and integration tests with mocked `ModelProvider`

**Dependencies:** None (uses existing `ModelProvider` interface)

**Covers:** reflexive-recall.AC1 (decomposition), reflexive-recall.AC5 (utility model fallback)

**Done when:** `parseDecompositionResponse()` correctly extracts queries and entities from valid JSON, returns sensible fallback from malformed input. `decomposeMessage()` calls the utility `ModelProvider` and parses the response. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Retrieval Pipeline

**Goal:** Multi-query search with deduplication, domain filtering, and token-budgeted ranking.

**Components:**
- `src/recall/retrieve.ts` (Functional Core) — `retrieveContext()` function
- `src/recall/retrieve.test.ts` — Unit tests for deduplication logic, domain filtering, token budget enforcement, score ranking, fragment truncation

**Dependencies:** Phase 1 (consumes `DecompositionResult`), existing `SearchStore` and `EmbeddingProvider`

**Covers:** reflexive-recall.AC2 (retrieval), reflexive-recall.AC3 (domain/tier filtering), reflexive-recall.AC4 (token budget)

**Done when:** Retrieval produces ranked, deduplicated, budget-trimmed fragments from mock search results. Entity lookups and semantic queries merged correctly. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Orchestrator and Fallback Cascade

**Goal:** Wire decomposition and retrieval into a single `performRecall()` entry point with guard conditions and fallback behavior.

**Components:**
- `src/recall/index.ts` (Imperative Shell) — `performRecall()` function, `RecallDeps` type, barrel exports
- `src/recall/index.test.ts` — Integration tests for full pipeline with mocked dependencies, fallback cascade (utility model failure, embedding failure, both down, empty results), guard conditions (short messages, disabled config)

**Dependencies:** Phase 1, Phase 2

**Covers:** reflexive-recall.AC5 (fallback cascade), reflexive-recall.AC6 (guard conditions)

**Done when:** `performRecall()` returns correct results with all deps available, degrades correctly through each fallback level, returns null when guards trigger. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Context Provider and System Prompt Integration

**Goal:** Inject recalled context into the system prompt via a stateful `ContextProvider`.

**Components:**
- `src/recall/context.ts` (Functional Core) — `createRecallContextProvider()` factory, `formatRecallSection()` pure function
- `src/recall/context.test.ts` — Unit tests for section rendering, absent when empty/null, correct fragment formatting, deduplication against core blocks

**Dependencies:** Phase 1 (uses `RecallResult` type)

**Covers:** reflexive-recall.AC7 (prompt injection position), reflexive-recall.AC4.3 (no injection when empty)

**Done when:** Context provider returns recalled context section when result is set, returns `undefined` when absent. Fragments render with label/domain headers, no score metadata. All tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Agent Loop Integration

**Goal:** Wire recall into `processMessage()` flow, add config fields, and emit trace recordings.

**Components:**
- `src/agent/agent.ts` — Add recall step inside tool loop, before skill injection. Create `RecallDeps` from `AgentDependencies`, call `performRecall()`, update context provider state. Cache recall result across tool rounds (only decompose on first round)
- `src/agent/types.ts` — Add `recall_enabled`, `recall_token_budget` to `AgentConfig`
- `src/config/schema.ts` — Add `recall_enabled` and `recall_token_budget` fields to `AgentConfigSchema`
- `src/config/config.ts` — Map new config fields to agent config
- `src/index.ts` — Wire recall context provider into `contextProviders`, pass summarization model to recall deps

**Dependencies:** Phase 3, Phase 4

**Covers:** reflexive-recall.AC8 (trace recording), reflexive-recall.AC6.1 (disabled by default), reflexive-recall.AC9 (runs after compaction)

**Done when:** With `recall_enabled = true`, recall fires before model call and injects context via context provider. With `recall_enabled = false` (default), recall is skipped entirely. Trace recorded with timing and fragment count. Existing agent tests unaffected. Build succeeds (`bun run build`).
<!-- END_PHASE_5 -->

## Additional Considerations

**Scaling:** `SearchStore` uses pgvector for cosine similarity queries against PostgreSQL. Current implementation does brute-force sequential scan. For stores exceeding ~100K vectors, adding an IVFFlat or HNSW index on the `embedding` column would significantly improve query performance. This is a known limitation of the existing search infrastructure, not specific to recall.

**Latency observation:** The recall step adds 1-3 seconds to every turn. Since the main model call typically takes 5-30 seconds, this is proportionally small. If latency becomes a concern, the tiered approach (direct embed first, decompose only when needed) was explored in the constellation-lite brainstorming as a future optimization.

**Token budget default difference:** Constellation defaults to 4096 tokens (vs 1500 in constellation-lite) because the PostgreSQL memory system stores richer, longer blocks (especially archival compaction batches) and the model context windows used tend to be larger (200K default).

**Summarization model reuse:** The decomposition step reuses the `[summarization]` config section's model provider rather than adding a new config section. This is consistent with the pattern in compaction — utility LLM tasks share the same lightweight model. If the summarization section is not configured, decomposition falls back to raw-message search (no separate model call).
