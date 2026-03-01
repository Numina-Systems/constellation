# Compaction V2 Implementation Plan — Phase 5: Config Schema Update

**Goal:** Add importance scoring configuration fields to the `[summarization]` TOML config section so scoring weights are customizable.

**Architecture:** Scoring fields are added to `SummarizationConfigSchema` as optional Zod fields with `.default()` values matching the `DEFAULT_SCORING_CONFIG` from Phase 4. The composition root maps these TOML fields into the `ImportanceScoringConfig` object passed to `createCompactor()` via `CompactionConfig.scoring`.

**Tech Stack:** TypeScript, Bun, Zod

**Scope:** 5 of 6 phases from original design (phase 5)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-v2.AC3: Importance-Based Scoring
- **compaction-v2.AC3.5 Success:** Scoring config is customizable via `[summarization]` TOML section

---

<!-- START_TASK_1 -->
### Task 1: Add scoring fields to SummarizationConfigSchema

**Verifies:** compaction-v2.AC3.5

**Files:**
- Modify: `src/config/schema.ts:62-73` (SummarizationConfigSchema)

**Implementation:**

Add scoring fields to the existing `SummarizationConfigSchema` Zod object. Follow the existing patterns (`.number().default()` for numeric values, `.optional()` for arrays):

```typescript
const SummarizationConfigSchema = z.object({
  // ... existing fields unchanged ...
  provider: z.enum(["anthropic", "openai-compat"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  chunk_size: z.number().int().positive().default(20),
  keep_recent: z.number().int().nonnegative().default(5),
  max_summary_tokens: z.number().int().positive().default(1024),
  clip_first: z.number().int().nonnegative().default(2),
  clip_last: z.number().int().nonnegative().default(2),
  prompt: z.string().optional(),

  // Importance scoring weights
  role_weight_system: z.number().nonnegative().default(10.0),
  role_weight_user: z.number().nonnegative().default(5.0),
  role_weight_assistant: z.number().nonnegative().default(3.0),
  recency_decay: z.number().min(0).max(1).default(0.95),
  question_bonus: z.number().nonnegative().default(2.0),
  tool_call_bonus: z.number().nonnegative().default(4.0),
  keyword_bonus: z.number().nonnegative().default(1.5),
  important_keywords: z.array(z.string()).default(
    ['error', 'fail', 'bug', 'fix', 'decision', 'agreed', 'constraint', 'requirement'],
  ),
  content_length_weight: z.number().nonnegative().default(1.0),
});
```

These defaults match `DEFAULT_SCORING_CONFIG` from Phase 4's `src/compaction/types.ts`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(config): add importance scoring fields to summarization schema`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire scoring config into createCompactor in composition root

**Verifies:** compaction-v2.AC3.5

**Files:**
- Modify: `src/index.ts:368-376` (compactionConfig construction)

**Implementation:**

Update the `compactionConfig` construction to include the scoring config. After Phase 3, the `getPersona` callback is already removed. Add the scoring config mapping:

```typescript
const compactionConfig: CompactionConfig = {
  chunkSize: config.summarization?.chunk_size ?? 20,
  keepRecent: config.summarization?.keep_recent ?? 5,
  maxSummaryTokens: config.summarization?.max_summary_tokens ?? 1024,
  clipFirst: config.summarization?.clip_first ?? 2,
  clipLast: config.summarization?.clip_last ?? 2,
  prompt: config.summarization?.prompt ?? null,
  scoring: config.summarization ? {
    roleWeightSystem: config.summarization.role_weight_system,
    roleWeightUser: config.summarization.role_weight_user,
    roleWeightAssistant: config.summarization.role_weight_assistant,
    recencyDecay: config.summarization.recency_decay,
    questionBonus: config.summarization.question_bonus,
    toolCallBonus: config.summarization.tool_call_bonus,
    keywordBonus: config.summarization.keyword_bonus,
    importantKeywords: config.summarization.important_keywords,
    contentLengthWeight: config.summarization.content_length_weight,
  } : undefined,
};
```

Note: When `config.summarization` is defined, the Zod defaults ensure all scoring fields have values. When it's undefined, `scoring` is undefined in the config, but `splitHistory` uses `DEFAULT_SCORING_CONFIG` as its parameter default (from Phase 4), so scoring is always active.

Add the `ImportanceScoringConfig` type import if not already present:

```typescript
import type { CompactionConfig } from '@/compaction/types';
```

(This import likely already exists. Verify and add only if needed.)

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(index): wire scoring config from TOML into compaction pipeline`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update config.toml.example with scoring config examples

**Verifies:** compaction-v2.AC3.5

**Files:**
- Modify: `config.toml.example:28-37` (summarization section)

**Implementation:**

Add commented scoring fields to the existing `[summarization]` section:

```toml
# [summarization]
# provider = "openai-compat"
# name = "olmo-3:7b-think"
# base_url = "http://192.168.1.6:11434/v1"
# chunk_size = 20
# keep_recent = 5
# max_summary_tokens = 1024
# clip_first = 2
# clip_last = 2
# prompt = "Custom system prompt for the summarization model"
#
# # Importance scoring weights (all optional, defaults shown)
# role_weight_system = 10.0
# role_weight_user = 5.0
# role_weight_assistant = 3.0
# recency_decay = 0.95
# question_bonus = 2.0
# tool_call_bonus = 4.0
# keyword_bonus = 1.5
# important_keywords = ["error", "fail", "bug", "fix", "decision", "agreed", "constraint", "requirement"]
# content_length_weight = 1.0
```

Note: The `prompt` field description is updated to reflect it's now a system prompt string (no placeholders), per Phase 2 changes.

**Verification:**

Run: `bun run build`
Expected: Type-check still passes (config.toml.example is not validated at build time, but the schema defaults should match)

**Commit:** `docs(config): add scoring config examples to config.toml.example`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify full test suite passes

**Verifies:** compaction-v2.AC3.5

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

Run: `bun test`
Expected: All tests pass. No regressions from the schema additions.

Verify that a TOML file with custom scoring values parses correctly:
- If the config loading tests exist in `src/config/config.test.ts`, the Zod defaults should cause no issues.
- The schema additions are all optional with defaults, so existing configs remain valid.

**Commit:** No commit needed — verification only
<!-- END_TASK_4 -->
