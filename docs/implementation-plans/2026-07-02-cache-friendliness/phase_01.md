# Cache-Friendliness Phase 1: Remove Stale Recall System-Prompt Rebuild

**Goal:** Delete the dead post-recall system-prompt rebuild in the agent loop so the system prompt is built exactly once per round.

**Architecture:** `buildSystemPrompt()` (src/agent/context.ts:20-24) reads only core memory blocks; it never consults `recallContextState`. Recall results reach the model via the snapshot pipeline (registered as a `dynamic` classified provider in src/index.ts), so the "rebuild with recall context" at src/agent/agent.ts:278-283 is a no-op with a misleading comment. This phase removes it.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `bun:test`.

**Scope:** Phase 1 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`.

**Codebase verified:** 2026-07-02 (codebase-investigator, working tree on branch `fix/compaction-atomicity-and-ratelimit-deadlock`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC1: Stale recall rebuild removed
- **cache-friendliness.AC1.1 Success:** After a recall-enabled turn, the system prompt sent to the model is built exactly once per round (no post-recall rebuild), and recalled fragments still reach the model inside the dynamic-context attachment on the user message.

---

## Context for the implementor

- Testing conventions: hand-rolled fake factories (`createMock*`), no mocking libraries, `bun:test` with plain `expect()`, test names prefixed with AC identifiers, `(unit)` marker for all-mock tests. See `src/agent/agent.test.ts` for the canonical patterns (`createMockPersistenceProvider`, `createMockMemoryManager`, `createMockModelProvider(responses, tracker)`).
- Subsystem contracts: `src/agent/CLAUDE.md`.
- Run a single test file: `bun test src/agent/agent.test.ts`. Type-check: `bun run build`.

The code being removed (current `src/agent/agent.ts:277-283`):

```typescript
        deps.recallContextState.setResult(cachedRecallResult);   // line 277 — KEEP
        // Rebuild system prompt with recall context now set      // line 278 — DELETE
        systemPrompt = await buildSystemPrompt(deps.memory);      // line 279 — DELETE
        // Re-append diary after recall rebuilds system prompt (diary is session-static, not included in buildSystemPrompt)
        if (deps.diarySection) {                                  // lines 280-283 — DELETE
          systemPrompt += '\n\n' + deps.diarySection;
        }
```

Line 277 (`deps.recallContextState.setResult(...)`) is how the recall snapshot provider receives its data — it MUST stay. The initial build at lines 244-249 already produces the system prompt with the diary appended, so nothing needs re-deriving after recall.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Write the failing test — system prompt built once per round on recall-enabled turns

**Verifies:** cache-friendliness.AC1.1

**Files:**
- Modify: `src/agent/agent.test.ts` (add test in the `describe('Agent loop', ...)` block, or a new `describe('recall system prompt stability', ...)` block)

**Step 1: Write the failing test**

Add a unit test that:
1. Wraps `createMockMemoryManager()` so `buildSystemPrompt` counts its invocations:

```typescript
function createCountingMemoryManager(): MemoryManager & { buildSystemPromptCalls: { count: number } } {
  const base = createMockMemoryManager();
  const buildSystemPromptCalls = { count: 0 };
  return {
    ...base,
    buildSystemPromptCalls,
    async buildSystemPrompt() {
      buildSystemPromptCalls.count++;
      return base.buildSystemPrompt();
    },
  };
}
```

2. Creates an agent with recall enabled: `config.recall_enabled = true`, and deps including a fake `recallContextState` (an object with `setResult`/`getResult` capturing the last set value — mirror the shape of `RecallContextState` from `src/recall/context.ts`) and a fake `searchStore` whose search methods return empty results (check `performRecall`'s usage in `src/recall/orchestrator.ts` for which `SearchStore` methods must exist; return empty arrays so the recall pipeline completes without fragments).
3. Sends one message with a single-response mock model (one round, `stop_reason: 'end_turn'`).
4. Asserts `buildSystemPromptCalls.count === 1` — the prompt was built exactly once for the single round.

Name it: `it('cache-friendliness.AC1.1 (unit): builds the system prompt exactly once per round on recall-enabled turns', ...)`.

**Step 2: Run the test to verify it fails**

Run: `bun test src/agent/agent.test.ts -t "AC1.1"`
Expected: FAIL — count is 2 (initial build + post-recall rebuild).

If it passes unexpectedly, stop and re-check that recall actually executed (the recall branch requires `config.recall_enabled`, `deps.recallContextState`, AND `deps.searchStore` — see src/agent/agent.ts:252).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Delete the rebuild

**Verifies:** cache-friendliness.AC1.1

**Files:**
- Modify: `src/agent/agent.ts:278-283`

**Step 1: Delete the dead code**

Remove lines 278-283 (the `// Rebuild system prompt...` comment, the `systemPrompt = await buildSystemPrompt(deps.memory);` reassignment, the `// Re-append diary...` comment, and the `if (deps.diarySection) { ... }` re-append block). Keep line 277 (`deps.recallContextState.setResult(cachedRecallResult);`) and the `else if` branch that follows at current lines 284-287.

**Step 2: Type-check**

Run: `bun run build`
Expected: no errors.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify and commit

**Verifies:** cache-friendliness.AC1.1

**Step 1: Run the new test**

Run: `bun test src/agent/agent.test.ts -t "AC1.1"`
Expected: PASS (count === 1).

**Step 2: Run the full agent and recall suites**

Run: `bun test src/agent/ src/recall/`
Expected: all pass. Recall delivery is unaffected because it flows through `recallContextState` → the `recall` dynamic provider → snapshot attachment (src/index.ts registration), not through the system prompt.

**Step 3: Commit**

```bash
git add src/agent/agent.ts src/agent/agent.test.ts
git commit -m "refactor(agent): remove dead post-recall system prompt rebuild"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
