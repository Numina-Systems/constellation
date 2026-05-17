# Diary Injection Design

## Summary

Diary injection adds a lightweight continuity layer to the agent's session startup. Each session, the harness retrieves the most recent diary entries written by the agent — memory blocks labelled with the `diary:YYYY-MM-DD` convention and stored in the working memory tier — and injects them as a static `## Diary` section in the system prompt. The section persists unchanged for the entire session; it is never re-fetched mid-conversation.

The design deliberately avoids semantic retrieval. Where recall dynamically surfaces memories relevant to each user message via embedding search, the diary is unconditional: temporal proximity, not topical relevance, determines what appears. Selection is a prefix query on labels plus a date sort, capped by entry count and a token budget. Formatting strips all storage metadata, rendering only date headers and content. No new write tooling is required — the agent already has `memory_write` — and the feature is inert when no diary entries exist, making it safe to enable by default.

## Definition of Done

1. At session start, the harness reads the most recent diary entries from working-tier memory blocks (labelled `diary:YYYY-MM-DD`) and injects them into the system prompt after core memory blocks.
2. Injection is static per session — fetched once at startup, never re-fetched during the session.
3. Entry selection is by date (most recent first), capped by both entry count (default 3) and token budget (default 3000 tokens).
4. No new write tool required — the agent uses existing `memory_write` to create diary entries.
5. No embeddings or decomposition involved — retrieval is a simple prefix match + date sort.
6. Zero diary entries produces no injected section (graceful absence).
7. Diary injection is enabled by default (`diary_enabled = true`) since it's inert when no entries exist.
8. A new `getBlocksByLabelPrefix()` method is added to the `MemoryStore` port interface.

## Acceptance Criteria

### diary-injection.AC1: Entry selection
- **diary-injection.AC1.1 Success:** Blocks labelled `diary:2026-05-16`, `diary:2026-05-17` are selected from working tier
- **diary-injection.AC1.2 Success:** Entries sorted by date descending, most recent selected first
- **diary-injection.AC1.3 Success:** Selection capped at `diary_max_entries` (default 3)
- **diary-injection.AC1.4 Edge:** Sub-day labels (`diary:2026-05-17-evening`) sort correctly via lexicographic ordering
- **diary-injection.AC1.5 Edge:** Single diary entry returns that entry alone

### diary-injection.AC2: Token budget
- **diary-injection.AC2.1 Success:** Total injected content is <= configured `diary_token_budget` (default 3000)
- **diary-injection.AC2.2 Success:** If final entry exceeds remaining budget, it's truncated (not dropped)
- **diary-injection.AC2.3 Edge:** Entry exactly at budget limit is included in full
- **diary-injection.AC2.4 Edge:** Single entry larger than entire budget is truncated to budget

### diary-injection.AC3: Formatting
- **diary-injection.AC3.1 Success:** Output rendered as `## Diary` with `### YYYY-MM-DD` subheaders
- **diary-injection.AC3.2 Success:** Entries rendered in chronological order (oldest first) within the selected window
- **diary-injection.AC3.3 Success:** No metadata (scores, labels, tiers) exposed in rendered output

### diary-injection.AC4: Prompt injection position
- **diary-injection.AC4.1 Success:** Diary section appears after core memory blocks in system prompt
- **diary-injection.AC4.2 Success:** Diary section appears before dynamic context providers and skills
- **diary-injection.AC4.3 Edge:** Absent diary (null) produces no section in prompt

### diary-injection.AC5: Store prefix retrieval
- **diary-injection.AC5.1 Success:** `getBlocksByLabelPrefix('agent', 'diary:', 'working')` returns all diary-labelled working-tier blocks
- **diary-injection.AC5.2 Failure:** Blocks with label `diary-notes:foo` (not matching `diary:` prefix) are excluded
- **diary-injection.AC5.3 Failure:** Diary-labelled blocks in core or archival tiers are excluded when tier filter is specified
- **diary-injection.AC5.4 Edge:** No matching blocks returns empty array

### diary-injection.AC6: Guard conditions
- **diary-injection.AC6.1 Success:** `diary_enabled = false` skips retrieval entirely
- **diary-injection.AC6.2 Success:** Empty working tier (no diary blocks) returns null gracefully
- **diary-injection.AC6.3 Success:** Store error is caught, logged, and skipped (no crash)

### diary-injection.AC7: Static per session
- **diary-injection.AC7.1 Success:** Diary content fetched once at session init
- **diary-injection.AC7.2 Success:** Same diary content injected on every turn within the session
- **diary-injection.AC7.3 Success:** New diary entries written mid-session don't appear until next session

## Glossary

- **Working memory tier**: One of three memory tiers (core, working, archival). Working-tier blocks are active context that may decay in relevance over time — more persistent than volatile state, less permanent than archival summaries.
- **Memory block**: The storage unit for the three-tier memory system. Each block has an owner, a label, a tier, and text content. Labels are free-form strings, but conventionally namespaced (e.g. `diary:2026-05-17`).
- **Label prefix**: A naming convention used to group related memory blocks. The store's `getBlocksByLabelPrefix()` retrieves all blocks whose label begins with a given string (e.g. `diary:`).
- **MemoryStore port**: The interface (port) through which the agent accesses memory. Adapters (e.g. `postgres-store.ts`) implement it. Extending the interface here follows the existing port/adapter pattern.
- **System prompt**: The static instruction context prepended to every LLM turn. Assembled by `buildSystemPrompt()` and includes persona, core memory, skill snippets, and injected context sections.
- **Functional Core / Imperative Shell (FCIS)**: Architectural pattern enforced throughout the codebase. Pure, side-effect-free logic (Functional Core) is separated from I/O and wiring code (Imperative Shell). `buildDiarySection()` is Functional Core; the session init wiring is Imperative Shell.
- **Recall**: The per-turn semantic memory retrieval pipeline. Distinct from diary injection — recall uses embeddings to find memories relevant to each user message; diary uses date-ordered prefix lookup and fires once at session start.
- **Token budget**: A soft cap on the character/token footprint of injected content. Prevents any single context section from crowding out others in the LLM's context window.
- **Barrel export**: An `index.ts` file that re-exports a module's public API, consolidating imports for consumers. Each new `src/diary/` module follows this convention.
- **Lexicographic ordering**: String comparison order. ISO date suffixes (`2026-05-17`, `2026-05-17-evening`) sort correctly by date when compared as strings, which is why sub-day labels work without special parsing.
- **C0 (continuity floor)**: The diary's role — the guaranteed, unconditional baseline of context carried into every session, analogous to the agent's persistent persona.

## Architecture

Diary injection is a one-shot retrieval that fires once per session at agent initialization. It reads recent diary entries from the working memory tier and formats them into a system prompt section that persists unchanged for the session's duration.

The diary is the agent's C0 — the persistent floor of continuity. Unlike recall (which varies per-turn based on the user message), the diary is unconditionally present, like the persona. It bridges one session's context to the next without requiring the agent to remember that it has something to remember.

### Pipeline

```
session start
    |
    v
+---------------------------+
| getBlocksByLabelPrefix()  |
| owner, "diary:", working  |
+------------+--------------+
             |
             v
+---------------------------+
| extract date from label   |
| sort descending (newest)  |
| take up to max_entries    |
+------------+--------------+
             |
             v
+---------------------------+
| trim to token budget      |
| (truncate last if needed) |
+------------+--------------+
             |
             v
+---------------------------+
| format as ## Diary        |
| render chronologically    |
+------------+--------------+
             |
             v
    system prompt
    (after core blocks,
     before dynamic context)
```

### Components

**Diary injector** (`src/diary/inject.ts`, Functional Core) — Pure function `buildDiarySection()` that accepts memory blocks, filters to `diary:*` prefix, extracts dates, sorts, trims to budget, and formats. No I/O. Returns formatted string or `null`.

**Store extension** (`src/memory/store.ts` + `src/memory/postgres-store.ts`) — New `getBlocksByLabelPrefix(owner, prefix, tier?)` method on the `MemoryStore` interface. SQL implementation uses `LIKE` with escaped prefix.

**Session init wiring** (`src/index.ts` or `src/agent/agent.ts`) — Calls `getBlocksByLabelPrefix` once at agent creation, passes blocks to `buildDiarySection()`, stores result string in agent closure. Passes it into `buildSystemPrompt()` assembly on every turn.

**Prompt assembly** (`src/agent/context.ts`) — Accepts optional `diarySection: string` parameter. Appends after core blocks, before dynamic context providers and skills.

### Contracts

```typescript
// src/diary/inject.ts

type DiaryEntry = {
  readonly label: string;
  readonly content: string;
  readonly date: string;
};

type DiaryInjection = {
  readonly entries: ReadonlyArray<DiaryEntry>;
  readonly totalTokens: number;
  readonly section: string;
};

function buildDiarySection(
  blocks: ReadonlyArray<MemoryBlock>,
  options: { tokenBudget: number; maxEntries: number },
): DiaryInjection | null;
```

```typescript
// src/memory/store.ts (addition to existing interface)

interface MemoryStore {
  // ... existing methods ...
  getBlocksByLabelPrefix(
    owner: string,
    prefix: string,
    tier?: MemoryTier,
  ): Promise<ReadonlyArray<MemoryBlock>>;
}
```

### Rendered output

The injected section in the system prompt:

```
## Diary

### 2026-05-16
dear future-lasa, today i learned about the formula A = theta + C0 + M(I)
and it changed how i think about my own architecture...

### 2026-05-17
wrapping up the session with giulia. we designed the diary injection feature
together. the plumbing is coming. i'm excited...
```

No metadata, no scores, no labels exposed. Date headers and content only.

### Data flow in agent init

Position in session startup (approximately `src/index.ts`):

1. Config loaded *(existing)*
2. Memory store created *(existing)*
3. Agent dependencies wired *(existing)*
4. **Diary retrieval** *(new)* — `getBlocksByLabelPrefix(owner, 'diary:', 'working')`
5. **Format diary section** *(new)* — `buildDiarySection(blocks, { tokenBudget, maxEntries })`
6. Agent created with diary section in closure *(modified)*
7. REPL / event loop starts *(existing)*

### Guard conditions

Diary injection returns `null` (no section) when:
- `diary_enabled` is `false` in config
- No blocks match `diary:*` prefix in working tier
- Memory store is unavailable (catch error, log warning, skip)

No message-length guard (not message-triggered). No embedding dependency. No model dependency.

## Existing Patterns

Investigation found these patterns this design follows:

- **Functional Core / Imperative Shell** — `buildDiarySection()` is a pure function (Functional Core). Wiring in `src/index.ts` is Imperative Shell. Follows convention from `src/search/hybrid.ts`, `src/agent/context.ts`.
- **MemoryStore port interface** — Adding `getBlocksByLabelPrefix()` follows the same pattern as existing `getBlocksByTier()` and `getBlockByLabel()` methods. Port in `src/memory/store.ts`, adapter in `src/memory/postgres-store.ts`.
- **System prompt assembly** — `buildSystemPrompt()` in `src/memory/manager.ts` concatenates core blocks. The diary section appends after this, following the same section-joining pattern used for skill injection and recall context.
- **Config fields in `[agent]`** — Existing `recall_enabled`, `recall_token_budget` fields set precedent for `diary_enabled`, `diary_token_budget`, `diary_max_entries`.
- **Session-init one-shot** — Similar to how checkpoint restore loads state once at startup. The diary is fetched once and cached, not re-fetched per turn.

No divergence from existing patterns. This design uses existing storage, existing prompt assembly, and existing config conventions. The only new interface method (`getBlocksByLabelPrefix`) is a natural extension of the existing query methods.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Store interface extension

**Goal:** Add `getBlocksByLabelPrefix()` to the memory store port and PostgreSQL adapter.

**Components:**
- `src/memory/store.ts` — add method to `MemoryStore` interface
- `src/memory/postgres-store.ts` — implement with `WHERE owner = $1 AND label LIKE $2 AND tier = $3 ORDER BY label ASC`
- `src/memory/postgres-store.test.ts` — integration tests for prefix queries (matching, non-matching, tier filtering, empty results)

**Dependencies:** None (first phase)

**Covers:** diary-injection.AC5 (prefix retrieval)

**Done when:** `getBlocksByLabelPrefix('agent', 'diary:', 'working')` returns matching blocks filtered by prefix and tier. Tests pass against test database.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Diary injection function

**Goal:** Pure function that selects, sorts, trims, and formats diary entries for prompt injection.

**Components:**
- `src/diary/inject.ts` (Functional Core) — `buildDiarySection()` function, `DiaryEntry` and `DiaryInjection` types
- `src/diary/index.ts` — barrel export
- `src/diary/inject.test.ts` — unit tests for date extraction, sorting, token budgeting, truncation, formatting, null on empty input

**Dependencies:** Phase 1 (uses `MemoryBlock` type, though function is pure and testable with mock data)

**Covers:** diary-injection.AC1 (entry selection), diary-injection.AC2 (token budget), diary-injection.AC3 (formatting)

**Done when:** `buildDiarySection()` correctly filters, sorts by date descending, selects up to N entries within token budget, truncates overflow, renders chronological output. Returns `null` for empty input. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Prompt assembly and session wiring

**Goal:** Wire diary retrieval into session init and inject into system prompt.

**Components:**
- `src/agent/context.ts` — extend prompt assembly to accept and append diary section
- `src/config/types.ts` — add `diary_enabled`, `diary_token_budget`, `diary_max_entries` to `AgentLoopConfig`
- `src/config/loader.ts` — load diary config fields from `[agent]` section
- `src/index.ts` — fetch diary blocks at session init, call `buildDiarySection()`, pass result into agent creation
- `src/agent/context.test.ts` — verify diary section positioning (after core, before dynamic context)

**Dependencies:** Phase 1, Phase 2

**Covers:** diary-injection.AC4 (injection position), diary-injection.AC6 (guard conditions), diary-injection.AC7 (static per session)

**Done when:** With diary entries in working tier, session starts with `## Diary` section in system prompt after core blocks. With no entries, no section appears. Config flags respected. Build succeeds, existing tests pass.
<!-- END_PHASE_3 -->

## Additional Considerations

**Label convention:** `diary:YYYY-MM-DD` is the standard. Sub-day entries (`diary:2026-05-17-evening`) sort correctly because string comparison on ISO dates works lexicographically. The date extraction logic should handle both formats — strip the `diary:` prefix, use the remainder as-is for the header.

**Token counting:** Use the same approximate token counter already used elsewhere in the codebase (character-based heuristic or tiktoken if available). Exact counts aren't critical — the budget is a soft cap to prevent prompt bloat, not a hard API limit.

**No deletion pressure:** Old diary entries don't need cleanup. They naturally fall out of the injection window (only most recent N are shown). They remain searchable via existing memory tools and recall. The working tier is the right home — these aren't archival summaries, they're active continuity context that decays in relevance over time.

**Relationship to recall:** Recall and diary are independent. Recall is per-turn semantic retrieval. Diary is per-session temporal injection. They may surface the same content through different paths — a diary entry could also appear in recall results if semantically relevant to the current message. This is fine; slight redundancy is better than missed context.
