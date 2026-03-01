# Context Compaction Implementation Plan — Phase 2

**Goal:** Establish the `src/compaction/` module with its port interface, domain types, default summarization prompt, and prompt interpolation logic.

**Architecture:** New Functional Core module defining the `Compactor` port interface, `SummaryBatch` and `CompactionResult` value types, and a `CompactionConfig` derived from the `SummarizationConfig` schema. The prompt module provides a default summarization template with `{persona}`, `{existing_summary}`, `{messages}` placeholder interpolation.

**Tech Stack:** TypeScript (pure types + string interpolation)

**Scope:** 7 phases from original design (phase 2 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-compaction.AC6: Summarization uses dedicated model config
- **context-compaction.AC6.3 Success:** Custom `prompt` field overrides the default summarization prompt
- **context-compaction.AC6.4 Success:** `{persona}`, `{existing_summary}`, `{messages}` placeholders are interpolated in the prompt

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create src/compaction/types.ts with Compactor port and domain types

**Files:**
- Create: `src/compaction/types.ts`

**Implementation:**

Create `src/compaction/types.ts` with `// pattern: Functional Core` annotation.

Define these types:

1. **`SummaryBatch`** — value type for one unit of compressed history:
   - `content: string` — the summarized text
   - `depth: number` — 0 = direct summary of raw messages, 1+ = re-summarized
   - `startTime: Date` — earliest message timestamp in this batch
   - `endTime: Date` — latest message timestamp in this batch
   - `messageCount: number` — count of original messages covered

   All fields `readonly`.

2. **`CompactionResult`** — return type from `compress()`:
   - `history: ReadonlyArray<ConversationMessage>` — the compressed history (clip-archive message + recent messages)
   - `batchesCreated: number`
   - `messagesCompressed: number`
   - `tokensEstimateBefore: number`
   - `tokensEstimateAfter: number`

   All fields `readonly`. Import `ConversationMessage` from `@/agent/types`.

3. **`CompactionConfig`** — runtime config derived from `SummarizationConfig`:
   - `chunkSize: number`
   - `keepRecent: number`
   - `maxSummaryTokens: number`
   - `clipFirst: number`
   - `clipLast: number`
   - `prompt: string | null` — `null` means use default prompt

   All fields `readonly`. Note the camelCase conversion from the snake_case TOML/Zod config.

4. **`Compactor`** — port interface:
   ```typescript
   type Compactor = {
     compress(
       history: ReadonlyArray<ConversationMessage>,
       conversationId: string,
     ): Promise<CompactionResult>;
   };
   ```

Export all types as named exports.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): add Compactor port interface and domain types`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create src/compaction/index.ts barrel export

**Files:**
- Create: `src/compaction/index.ts`

**Implementation:**

Create `src/compaction/index.ts` with `// pattern: Functional Core` annotation.

Re-export all public types from `types.ts`:
```typescript
export type { SummaryBatch, CompactionResult, CompactionConfig, Compactor } from "./types.js";
```

Later phases will add re-exports for `createCompactor` (Phase 3) and prompt utilities (this phase, Task 3).

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): add barrel export`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Create src/compaction/prompt.ts with default prompt and interpolation

**Verifies:** context-compaction.AC6.3, context-compaction.AC6.4

**Files:**
- Create: `src/compaction/prompt.ts`
- Modify: `src/compaction/index.ts` (add re-exports)

**Implementation:**

Create `src/compaction/prompt.ts` with `// pattern: Functional Core` annotation.

1. **`DEFAULT_SUMMARIZATION_PROMPT`** — exported constant string containing the default prompt. Must include all three placeholders: `{persona}`, `{existing_summary}`, `{messages}`.

   The prompt should instruct the summarizer to:
   - Preserve decisions made, tool outcomes (successes and failures), workarounds
   - Preserve user constraints and preferences stated
   - Preserve causal chains (why something was done, not just what)
   - Condense repetitive exchanges, verbose tool output, and conversational filler
   - Maintain chronological order of events
   - Format as a concise narrative, not bullet points

2. **`interpolatePrompt`** — pure function:
   ```typescript
   type InterpolatePromptOptions = {
     readonly template: string;
     readonly persona: string;
     readonly existingSummary: string;
     readonly messages: string;
   };

   function interpolatePrompt(options: InterpolatePromptOptions): string
   ```

   Replace `{persona}`, `{existing_summary}`, `{messages}` placeholders in the template. Use simple string replacement (not regex) — replace all occurrences of each placeholder.

   Handle missing/empty values gracefully:
   - Empty `persona` → placeholder replaced with empty string
   - Empty `existingSummary` → placeholder replaced with `"(no prior summary)"`
   - Empty `messages` → placeholder replaced with empty string (shouldn't happen in practice)

Update `src/compaction/index.ts` to re-export `DEFAULT_SUMMARIZATION_PROMPT` and `interpolatePrompt` from `prompt.ts`, and export `InterpolatePromptOptions` type.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(compaction): add default summarization prompt and interpolation`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for prompt interpolation

**Verifies:** context-compaction.AC6.3, context-compaction.AC6.4

**Files:**
- Create: `src/compaction/prompt.test.ts`

**Testing:**

Tests must verify each AC listed:
- context-compaction.AC6.3: Verify that when a custom template is provided, it is used instead of the default — `interpolatePrompt` accepts any template string and correctly interpolates it
- context-compaction.AC6.4: Verify all three placeholders (`{persona}`, `{existing_summary}`, `{messages}`) are correctly replaced in the output

Additional test cases:
- Default prompt contains all three placeholders (verify `DEFAULT_SUMMARIZATION_PROMPT` includes `{persona}`, `{existing_summary}`, `{messages}`)
- Empty persona produces valid output (placeholder replaced with empty string)
- Empty existing summary produces "(no prior summary)" in output
- Multiple occurrences of same placeholder are all replaced
- Template with no placeholders returns template unchanged

Follow project testing patterns: colocated test file, `describe`/`it` from `bun:test`, no external mocking libraries needed (pure functions).

**Verification:**

```bash
bun test src/compaction/prompt.test.ts
```

Expected: All tests pass.

**Commit:** `test(compaction): add prompt interpolation tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->
