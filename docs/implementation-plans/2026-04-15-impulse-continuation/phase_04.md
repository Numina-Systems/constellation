# Impulse Continuation Implementation Plan — Phase 4

**Goal:** Add continuation config fields to Zod schema and wire barrel exports for all new modules.

**Architecture:** Infrastructure phase — extends existing config schema with two new fields and adds exports from Phases 1-3 to the subconscious barrel.

**Tech Stack:** TypeScript, Zod, Bun test runner

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### impulse-continuation.AC3: Budget enforcement
- **impulse-continuation.AC3.6 Success:** Config fields `max_continuations_per_event` and `max_continuations_per_cycle` validate with defaults and reject out-of-range values

---

## Reference Files

The executor should read these files to understand established patterns:

- `src/config/schema.ts:193-210` — `SubconsciousConfigSchema` Zod definition (add fields here)
- `src/config/schema.test.ts:503-658` — `ActivityConfigSchema` test patterns (defaults, range rejection)
- `src/subconscious/index.ts` — Current barrel exports (add new module exports here)
- `src/subconscious/CLAUDE.md` — Module contracts (update after adding exports)

---

<!-- START_TASK_1 -->
### Task 1: Add continuation config fields to SubconsciousConfigSchema

**Verifies:** impulse-continuation.AC3.6

**Files:**
- Modify: `src/config/schema.ts:193-210` (SubconsciousConfigSchema)

**Implementation:**

Add two new fields inside the `.object({})` block after `max_active_interests` (line 200):

```typescript
max_continuations_per_event: z.number().min(0).max(10).default(2),
max_continuations_per_cycle: z.number().min(0).max(50).default(10),
```

These follow the exact same `z.number().min().max().default()` pattern as existing fields like `impulse_interval_minutes`, `max_tool_rounds`, and `max_active_interests`.

The `SubconsciousConfig` type (line 240: `export type SubconsciousConfig = z.infer<typeof SubconsciousConfigSchema>`) automatically picks up the new fields.

**Zero-value semantics:** Setting either field to `0` is explicitly permitted and means "continuation feature disabled, cron-only behaviour." The budget's `canContinue()` will immediately return `false` when `maxPerEvent` or `maxPerCycle` is 0, so the continuation loop never fires.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(config): add continuation budget config fields`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config validation tests for continuation fields

**Verifies:** impulse-continuation.AC3.6

**Files:**
- Modify: `src/config/schema.test.ts`
- Test: `src/config/schema.test.ts` (unit)

**Testing:**

Add a new `describe` block for continuation config fields. Follow the test pattern from `ActivityConfigSchema` tests (lines 503-658).

Tests must verify:

- **Defaults apply when fields omitted:** Parse a minimal `SubconsciousConfigSchema` input (just `enabled: false`) and assert `max_continuations_per_event` defaults to `2` and `max_continuations_per_cycle` defaults to `10`.
- **Explicit values accepted:** Parse with `max_continuations_per_event: 5, max_continuations_per_cycle: 20` and assert values are preserved.
- **Zero values accepted:** Parse with `max_continuations_per_event: 0` and assert it's accepted (disables continuation).
- **Out-of-range rejected — event too high:** Parse with `max_continuations_per_event: 11` (exceeds max 10) and assert parse fails.
- **Out-of-range rejected — event negative:** Parse with `max_continuations_per_event: -1` and assert parse fails.
- **Out-of-range rejected — cycle too high:** Parse with `max_continuations_per_cycle: 51` (exceeds max 50) and assert parse fails.
- **Out-of-range rejected — cycle negative:** Parse with `max_continuations_per_cycle: -1` and assert parse fails.

**Verification:**
Run: `bun test src/config/schema.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(config): add continuation config validation tests`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update subconscious barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/subconscious/index.ts`

**Implementation:**

Add exports for all three new modules from Phases 1-3 at the end of the file:

```typescript
export { buildContinuationPrompt, parseContinuationResponse } from './continuation.ts';
export type { ContinuationDecision, ContinuationJudgeContext, ContinuationJudge } from './continuation.ts';
export { createContinuationBudget } from './continuation-budget.ts';
export type { ContinuationBudget, ContinuationBudgetConfig } from './continuation-budget.ts';
export { createContinuationJudge } from './continuation-judge.ts';
export type { ContinuationJudgeDeps } from './continuation-judge.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): export continuation modules from barrel`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update src/subconscious/CLAUDE.md with continuation modules

**Verifies:** None (documentation)

**Files:**
- Modify: `src/subconscious/CLAUDE.md`

**Implementation:**

Update the CLAUDE.md file to reflect the new continuation modules:

In the **Contracts** section, add to **Exposes**:
- `ContinuationJudge` port interface, `ContinuationDecision`, `ContinuationJudgeContext` types
- `buildContinuationPrompt(context)`, `parseContinuationResponse(text)` pure functions
- `createContinuationBudget(config)`, `ContinuationBudget`, `ContinuationBudgetConfig` types
- `createContinuationJudge(deps)`, `ContinuationJudgeDeps` type

Add to **Guarantees**:
- `buildContinuationPrompt` and `parseContinuationResponse` are pure functions (Functional Core)
- `parseContinuationResponse` returns `shouldContinue: false` for any malformed input (never throws)
- `ContinuationBudget` enforces both per-event and per-cycle limits independently
- `ContinuationJudge` adapter returns `shouldContinue: false` on any model error (graceful degradation)

In **Key Files**, add:
- `continuation.ts` -- Continuation decision types, prompt builder, response parser (Functional Core)
- `continuation-budget.ts` -- In-memory per-event/per-cycle budget counter (Imperative Shell)
- `continuation-judge.ts` -- LLM-backed continuation judge adapter using ModelProvider (Imperative Shell)

**Verification:**
Read `src/subconscious/CLAUDE.md` and verify new entries are present.

**Commit:** `docs(subconscious): update CLAUDE.md with continuation modules`

<!-- END_TASK_4 -->
