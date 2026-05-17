# Impulse Continuation Implementation Plan — Phase 2

**Goal:** Create in-memory continuation budget with per-event and per-cycle limits.

**Architecture:** Stateful budget counter using factory function pattern (`createContinuationBudget`). Classified as Imperative Shell due to mutable internal state, though trivially testable. Follows `createFoo()` → interface pattern established in `src/subconscious/`.

**Tech Stack:** TypeScript, Bun test runner

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### impulse-continuation.AC3: Budget enforcement
- **impulse-continuation.AC3.1 Success:** `canContinue()` returns true when both per-event and per-cycle budget remain
- **impulse-continuation.AC3.2 Failure:** `canContinue()` returns false when per-event budget exhausted (even if per-cycle remains)
- **impulse-continuation.AC3.3 Failure:** `canContinue()` returns false when per-cycle budget exhausted (even if per-event remains)
- **impulse-continuation.AC3.4 Success:** `resetEvent()` restores per-event budget without affecting per-cycle counter
- **impulse-continuation.AC3.5 Success:** `resetCycle()` restores both per-event and per-cycle budgets

---

## Reference Files

The executor should read these files to understand established patterns:

- `src/subconscious/impulse-assembler.ts` — Factory function pattern (`createImpulseAssembler`)
- `src/subconscious/impulse-assembler.test.ts` — Test patterns for factory-created objects
- `src/subconscious/CLAUDE.md` — Module contracts and conventions

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: ContinuationBudget implementation

**Verifies:** impulse-continuation.AC3.1, impulse-continuation.AC3.2, impulse-continuation.AC3.3, impulse-continuation.AC3.4, impulse-continuation.AC3.5

**Files:**
- Create: `src/subconscious/continuation-budget.ts`

**Implementation:**

Create `src/subconscious/continuation-budget.ts` with pattern annotation `// pattern: Imperative Shell` on line 1 (mutable internal state).

Define the budget config type:

```typescript
type ContinuationBudgetConfig = {
  readonly maxPerEvent: number;
  readonly maxPerCycle: number;
};
```

Define the budget interface:

```typescript
type ContinuationBudget = {
  readonly canContinue: () => boolean;
  readonly spend: () => void;
  readonly resetEvent: () => void;
  readonly resetCycle: () => void;
};
```

Implement the factory function:

```typescript
function createContinuationBudget(config: Readonly<ContinuationBudgetConfig>): ContinuationBudget
```

Internal state uses two counters:
- `eventRemaining` — starts at `config.maxPerEvent`, decremented by `spend()`
- `cycleRemaining` — starts at `config.maxPerCycle`, decremented by `spend()`

Methods:
- `canContinue()` — returns `true` only when both `eventRemaining > 0` AND `cycleRemaining > 0`
- `spend()` — decrements both `eventRemaining` and `cycleRemaining` by 1
- `resetEvent()` — restores `eventRemaining` to `config.maxPerEvent`, does NOT touch `cycleRemaining`
- `resetCycle()` — restores both `eventRemaining` to `config.maxPerEvent` AND `cycleRemaining` to `config.maxPerCycle`

Export `ContinuationBudgetConfig`, `ContinuationBudget`, and `createContinuationBudget` as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): add continuation budget counter`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ContinuationBudget tests

**Verifies:** impulse-continuation.AC3.1, impulse-continuation.AC3.2, impulse-continuation.AC3.3, impulse-continuation.AC3.4, impulse-continuation.AC3.5

**Files:**
- Create: `src/subconscious/continuation-budget.test.ts`
- Test: `src/subconscious/continuation-budget.test.ts` (unit)

**Testing:**

Tests must verify each AC listed above:

- **impulse-continuation.AC3.1:** Fresh budget with `maxPerEvent: 2, maxPerCycle: 10` → `canContinue()` returns `true`. After one `spend()`, still returns `true`.
- **impulse-continuation.AC3.2:** Budget with `maxPerEvent: 1, maxPerCycle: 10` → `spend()` once → `canContinue()` returns `false` (per-event exhausted, per-cycle still has 9).
- **impulse-continuation.AC3.3:** Budget with `maxPerEvent: 5, maxPerCycle: 1` → `spend()` once → `canContinue()` returns `false` (per-cycle exhausted, per-event still has 4).
- **impulse-continuation.AC3.4:** Budget with `maxPerEvent: 2, maxPerCycle: 5` → `spend()` twice (per-event exhausted) → `resetEvent()` → `canContinue()` returns `true` and `cycleRemaining` reflects 3 (original 5 minus 2 spends). Verify by spending 3 more times until per-cycle is exhausted.
- **impulse-continuation.AC3.5:** Budget with `maxPerEvent: 2, maxPerCycle: 3` → `spend()` 3 times (resetting event between to allow it) → both exhausted → `resetCycle()` → `canContinue()` returns `true`, and both counters are fully restored.

Additional edge cases:
- Zero-budget config: `maxPerEvent: 0, maxPerCycle: 10` → `canContinue()` returns `false` immediately (continuation disabled).
- Zero-cycle config: `maxPerEvent: 2, maxPerCycle: 0` → `canContinue()` returns `false` immediately.
- Fresh budget on construction: A newly created `createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 5 })` returns `canContinue() === true` immediately (guaranteed by construction — no persistence, resets to full on process restart).

**Verification:**
Run: `bun test src/subconscious/continuation-budget.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add continuation budget tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
