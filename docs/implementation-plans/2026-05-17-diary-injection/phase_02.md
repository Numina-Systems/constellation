# Diary Injection Implementation Plan — Phase 2: Diary Injection Function

**Goal:** Pure function that selects, sorts, trims, and formats diary entries for system prompt injection.

**Architecture:** New `src/diary/` module following Functional Core pattern. `buildDiarySection()` is a pure function that accepts `ReadonlyArray<MemoryBlock>`, extracts dates from `diary:*` labels, sorts by date descending to select the most recent N entries within a token budget, then renders them chronologically (oldest first) as a `## Diary` section. No I/O, no side effects.

**Tech Stack:** TypeScript, Bun test

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create `src/diary/inject.ts` with types and `buildDiarySection()`

**Verifies:** diary-injection.AC1.1, diary-injection.AC1.2, diary-injection.AC1.3, diary-injection.AC1.4, diary-injection.AC1.5, diary-injection.AC2.1, diary-injection.AC2.2, diary-injection.AC2.3, diary-injection.AC2.4, diary-injection.AC3.1, diary-injection.AC3.2, diary-injection.AC3.3

**Files:**
- Create: `src/diary/inject.ts`

**Implementation:**

Create `src/diary/inject.ts` annotated with `// pattern: Functional Core`.

Types to define in this file:

```typescript
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
```

Function signature:

```typescript
import type { MemoryBlock } from '@/memory/types';
import { estimateTokens } from '@/agent';

export type { DiaryEntry, DiaryInjection };

export function buildDiarySection(
  blocks: ReadonlyArray<MemoryBlock>,
  options: { readonly tokenBudget: number; readonly maxEntries: number },
): DiaryInjection | null;
```

Algorithm (pure, no I/O):

1. **Filter:** Only blocks whose `label` starts with `diary:` prefix
2. **Extract date:** For each matching block, extract the date portion by stripping the `diary:` prefix (e.g., `diary:2026-05-17` → `2026-05-17`, `diary:2026-05-17-evening` → `2026-05-17-evening`)
3. **Sort descending:** Sort by the extracted date string descending (lexicographic — ISO dates sort correctly)
4. **Cap by maxEntries:** Take at most `options.maxEntries` entries
5. **Apply token budget:** Iterate through selected entries, accumulating token count via `estimateTokens()`. If an entry would exceed the remaining budget, truncate its content (character-level slice based on remaining token budget × 4, since `estimateTokens` uses `Math.ceil(text.length / 4)`) and include it. Do NOT drop it.
6. **Reverse for rendering:** Reverse the selected entries to chronological order (oldest first)
7. **Format:** Render as:
   ```
   ## Diary\n\n### {date}\n{content}\n\n### {date}\n{content}
   ```
   No metadata. Just date headers and content.
8. **Return null** if no blocks match the `diary:` prefix (empty input or no diary labels)

Key implementation details:
- Token estimation: `estimateTokens(text)` returns `Math.ceil(text.length / 4)` — already exists at `src/agent/context.ts:111` and is exported from `@/agent`
- Include the `## Diary` header and `### date` subheaders in the token budget calculation
- When truncating content, append `...` to indicate truncation (count this in the budget)
- The `totalTokens` field in the return value should reflect the actual token count of the rendered `section` string

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

**Commit:** `feat(diary): add buildDiarySection pure function`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create barrel export at `src/diary/index.ts`

**Verifies:** None (module organization)

**Files:**
- Create: `src/diary/index.ts`

**Implementation:**

```typescript
// pattern: Functional Core
export type { DiaryEntry, DiaryInjection } from './inject.js';
export { buildDiarySection } from './inject.js';
```

Follow the existing barrel export convention: type exports via `export type { ... }`, function exports via `export { ... }`. Note the `.js` extension in import specifiers (ESM convention used throughout the codebase).

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

**Commit:** `feat(diary): add barrel export`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for `buildDiarySection`

**Verifies:** diary-injection.AC1.1, diary-injection.AC1.2, diary-injection.AC1.3, diary-injection.AC1.4, diary-injection.AC1.5, diary-injection.AC2.1, diary-injection.AC2.2, diary-injection.AC2.3, diary-injection.AC2.4, diary-injection.AC3.1, diary-injection.AC3.2, diary-injection.AC3.3

**Files:**
- Create: `src/diary/inject.test.ts`

**Testing:**

These are pure unit tests — no database, no I/O. Create mock `MemoryBlock` objects with the required fields. Only `label`, `content`, `owner`, and `tier` are semantically relevant; other fields can use fixture defaults.

Helper to create test blocks:

```typescript
function createBlock(label: string, content: string): MemoryBlock {
  return {
    id: crypto.randomUUID(),
    owner: 'test-agent',
    tier: 'working',
    label,
    content,
    embedding: null,
    permission: 'readwrite',
    pinned: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
```

Test cases mapped to ACs:

- **diary-injection.AC1.1:** Pass blocks with labels `diary:2026-05-16` and `diary:2026-05-17`. Assert both are selected and present in output.

- **diary-injection.AC1.2:** Pass blocks with labels `diary:2026-05-15`, `diary:2026-05-17`, `diary:2026-05-16` (unordered). Assert output renders in chronological order: 2026-05-15, 2026-05-16, 2026-05-17 (oldest first). Assert that selection prioritized the most recent (if maxEntries < total, the oldest gets dropped).

- **diary-injection.AC1.3:** Pass 5 blocks. Set `maxEntries: 3`. Assert only 3 entries in result, and they are the 3 most recent.

- **diary-injection.AC1.4:** Pass blocks with labels `diary:2026-05-17`, `diary:2026-05-17-evening`, `diary:2026-05-16`. Set `maxEntries: 3`. Assert all three selected, rendered chronologically: `2026-05-16`, `2026-05-17`, `2026-05-17-evening`.

- **diary-injection.AC1.5:** Pass a single block. Assert it returns a `DiaryInjection` with one entry.

- **diary-injection.AC2.1:** Pass blocks whose combined content (plus headers) fits within `tokenBudget: 3000`. Assert `totalTokens <= 3000`.

- **diary-injection.AC2.2:** Pass 2 blocks where the second entry would exceed the remaining budget. Assert the second entry's content is truncated (shorter than original), NOT dropped entirely. Assert output contains both date headers.

- **diary-injection.AC2.3:** Pass a single block whose content is exactly at the budget limit (accounting for header overhead). Assert content is included in full (no truncation).

- **diary-injection.AC2.4:** Pass a single block with content much larger than the entire budget. Assert output is truncated to fit within budget. Assert `totalTokens <= tokenBudget`.

- **diary-injection.AC3.1:** Assert output starts with `## Diary\n\n` and each entry has a `### YYYY-MM-DD` subheader.

- **diary-injection.AC3.2:** Pass blocks in random order. Assert rendered output has entries in chronological order (oldest first).

- **diary-injection.AC3.3:** Assert output contains no metadata fields (no `tier:`, no `owner:`, no `label:`, no `embedding`, no `permission`).

- **Additional: null on empty.** Pass an empty array. Assert returns `null`.

- **Additional: non-diary blocks filtered.** Pass a mix of diary-labelled and non-diary-labelled blocks. Assert only diary-labelled blocks appear in output.

**Verification:**

Run: `bun test src/diary/inject.test.ts`
Expected: All tests pass.

**Commit:** `test(diary): add unit tests for buildDiarySection`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
