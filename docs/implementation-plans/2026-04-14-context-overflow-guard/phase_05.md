# Context Overflow Guard Implementation Plan — Phase 5

**Goal:** Wire new compaction config fields (`compaction_timeout`, `compaction_max_retries`) through the composition root and document them in the example config.

**Architecture:** This is a wiring phase — config fields already exist in the Zod schema (added in Phase 3) and `CompactionConfig` type (also Phase 3). This phase maps them through the composition root in `src/index.ts` and documents them in `config.toml.example`.

**Tech Stack:** TypeScript, Bun, TOML

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase is infrastructure (wiring/config). It does not implement or test new acceptance criteria — it ensures Phases 1-4 are operationally connected.

**Verifies: None** — this phase wires existing functionality. Verification is operational (build succeeds, tests pass).

---

<!-- START_TASK_1 -->
### Task 1: Wire new config fields through composition root

**Verifies:** None (infrastructure wiring)

**Files:**
- Modify: `src/index.ts:707-726` (compactionConfig object)

**Implementation:**

In `src/index.ts`, add the two new fields to the `compactionConfig` object at lines 707-726. Add them after the `scoring` field:

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
  timeout: config.summarization?.compaction_timeout,
  maxRetries: config.summarization?.compaction_max_retries,
};
```

Note: The Zod schema defaults (120000ms and 2 respectively, added in Phase 3) mean these will have values when `config.summarization` exists. When `config.summarization` is undefined (no summarization section in config), these are `undefined` and the compactor uses its own internal defaults.

**Verification:**

Run: `bun run build`
Expected: Type-check passes.

**Commit:** `feat(config): wire compaction timeout and retries through composition root`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Document new config fields in example config

**Verifies:** None (documentation)

**Files:**
- Modify: `config.toml.example` (after `content_length_weight` in the `[summarization]` section)

**Implementation:**

Add the two new fields to the `[summarization]` section in `config.toml.example`, after `content_length_weight` at line 62. Insert before the blank line:

```toml
# content_length_weight = 1.0
#
# # Context overflow guard settings
# compaction_timeout = 120000       # Timeout in ms for summarisation LLM calls (default: 120000)
# compaction_max_retries = 2        # Number of retries with halved chunk size on timeout (default: 2)
```

Also add the same fields to the Ollama summarization example block (around line 71):

```toml
# [summarization]
# provider = "ollama"
# name = "llama3.1:8b"
# base_url = "http://localhost:11434"
# chunk_size = 20
# keep_recent = 5
# max_summary_tokens = 1024
# compaction_timeout = 120000
# compaction_max_retries = 2
```

**Verification:**

Visual inspection — config examples are commented out, so no runtime validation needed.

**Commit:** `docs: add compaction timeout and retry config to example`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full end-to-end verification

**Verifies:** No regression from all phases combined.

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors.

Run: `bun test`
Expected: All non-DB tests pass (1033+ pass, 17 DB-dependent failures unchanged).

**Commit:** No commit needed — verification step.

<!-- END_TASK_3 -->
