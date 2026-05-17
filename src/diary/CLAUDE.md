# Diary

Last verified: 2026-05-17

## Purpose
Injects recent diary entries from working memory into the system prompt, giving the agent session-static autobiographical context without re-fetching on every turn.

## Contracts
- **Exposes**: `buildDiarySection(blocks, options) -> DiaryInjection | null`, `DiaryEntry` type, `DiaryInjection` type
- **Guarantees**:
  - Filters memory blocks by `diary:` label prefix only
  - Selects most recent entries (by lexicographic date sort), capped at `maxEntries`
  - Total output respects `tokenBudget` (truncates final entry rather than dropping)
  - Renders in chronological order (oldest first) as a `## Diary` markdown section
  - Returns `null` when no diary blocks exist (caller handles gracefully)
  - Pure function: deterministic output for identical input
- **Expects**: `ReadonlyArray<MemoryBlock>` (pre-fetched from store), options with `tokenBudget` and `maxEntries`

## Dependencies
- **Uses**: `src/memory/types` (MemoryBlock type), `src/agent/` (estimateTokens utility)
- **Used by**: `src/index.ts` (composition root, fetches blocks at session init and passes result as `diarySection` dependency to agent)
- **Boundary**: Does not access the database directly. Blocks are pre-fetched by the composition root via `MemoryStore.getBlocksByLabelPrefix`.

## Key Decisions
- Session-static: Diary fetched once at session init, injected identically every turn (no mid-session drift)
- Append to system prompt (not working memory): Avoids compaction stripping diary content
- Truncation over omission: Budget overflow truncates the last entry with `...` rather than dropping it entirely

## Invariants
- Diary blocks live in the `working` tier with labels matching `diary:YYYY-MM-DD[-suffix]`
- Output section always starts with `## Diary\n\n` header when non-null
- Token count never exceeds configured budget

## Key Files
- `inject.ts` -- `buildDiarySection` pure function (Functional Core)
- `index.ts` -- Barrel exports
