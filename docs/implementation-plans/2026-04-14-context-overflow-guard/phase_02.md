# Context Overflow Guard Implementation Plan — Phase 2

**Goal:** Make `shouldCompress` account for system prompt, tool definitions, and output token reservation so compaction triggers based on *available* context budget, not total.

**Architecture:** `shouldCompress` gains an `overheadTokens` parameter. The agent loop computes overhead before calling it. Pure function change — no I/O, no new dependencies.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-overflow-guard.AC1: Budget math accounts for overhead
- **context-overflow-guard.AC1.1 Success:** `shouldCompress` returns `true` when message tokens alone are under budget but message tokens + overhead exceed it
- **context-overflow-guard.AC1.2 Success:** Overhead calculation includes system prompt, serialised tool definitions, and `max_tokens` output reservation
- **context-overflow-guard.AC1.3 Failure:** `shouldCompress` returns `false` when message tokens + overhead are within budget (no false positives)
- **context-overflow-guard.AC1.4 Edge:** Zero tools and empty system prompt produce zero overhead (only `max_tokens` contributes)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `overheadTokens` parameter to `shouldCompress`

**Verifies:** context-overflow-guard.AC1.1, context-overflow-guard.AC1.3, context-overflow-guard.AC1.4

**Files:**
- Modify: `src/agent/context.ts:129-145`
- Test: `src/agent/context.test.ts` (unit)

**Implementation:**

Modify `shouldCompress` in `src/agent/context.ts:129-145` to accept an `overheadTokens` parameter (defaults to 0 for backwards compatibility) and subtract it from the available budget:

```typescript
export function shouldCompress(
  history: ReadonlyArray<ConversationMessage>,
  budget: number,
  modelMaxTokens: number,
  overheadTokens: number = 0,
): boolean {
  const budgetInTokens = budget * modelMaxTokens;
  const availableForMessages = budgetInTokens - overheadTokens;

  if (availableForMessages <= 0) {
    return true;
  }

  let totalTokens = 0;

  for (const msg of history) {
    totalTokens += estimateTokens(msg.content);
    if (totalTokens > availableForMessages) {
      return true;
    }
  }

  return false;
}
```

Key changes:
- New `overheadTokens` parameter with default `0` (no breaking change)
- Subtract overhead from budget before comparing
- If overhead alone exhausts the budget, always compress

**Testing:**

Tests must verify each AC listed above:
- context-overflow-guard.AC1.1: Create a history where message tokens alone are under `budget * modelMaxTokens`, but message tokens + overheadTokens exceed it. Assert `shouldCompress` returns `true`.
- context-overflow-guard.AC1.3: Create a history where message tokens + overheadTokens are within budget. Assert `shouldCompress` returns `false`.
- context-overflow-guard.AC1.4: Call with `overheadTokens = 0` (and no tools/system prompt contributing). Assert behaviour matches original (only `max_tokens` matters if it's included in overhead by the caller — but with 0 overhead, it's purely message-based).
- Edge: `overheadTokens` exceeding total budget returns `true` immediately.
- Backwards compatibility: calling without `overheadTokens` parameter works identically to current behaviour.

Follow project patterns: `describe`/`it` blocks from `bun:test`, pure function tests (no mocking needed).

**Verification:**

Run: `bun test src/agent/context.test.ts`
Expected: All tests pass.

**Commit:** `feat(agent): make shouldCompress overhead-aware`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Compute overhead in agent loop and pass to `shouldCompress`

**Verifies:** context-overflow-guard.AC1.2

**Files:**
- Modify: `src/agent/agent.ts:110-114`

**Implementation:**

In `src/agent/agent.ts`, before the `shouldCompress` call at line 111, compute the overhead tokens. The overhead consists of three parts:
1. System prompt tokens (estimated after building it — but system prompt is built *inside* the while loop at line 124, so we need an estimate *before* the loop)
2. Tool definition tokens (serialised JSON)
3. Output reservation (`maxTokens`)

Since the full system prompt is built per-round inside the loop, compute a *pre-loop estimate* for the compression check using the tools and max_tokens that are known upfront. The system prompt estimate can use a rough heuristic — it changes per round but the overhead check is just a trigger, not a guarantee.

Add a helper function `estimateOverheadTokens` in `src/agent/context.ts`:

```typescript
export function estimateOverheadTokens(
  systemPrompt: string | undefined,
  tools: ReadonlyArray<ToolDefinition> | undefined,
  maxOutputTokens: number,
): number {
  let overhead = maxOutputTokens;

  if (systemPrompt) {
    overhead += estimateTokens(systemPrompt);
  }

  if (tools && tools.length > 0) {
    overhead += estimateTokens(JSON.stringify(tools));
  }

  return overhead;
}
```

Then in `agent.ts`, before the shouldCompress call, compute overhead. Since the system prompt isn't built yet at line 111, build a preliminary one for estimation. The tools and max_tokens are available:

```typescript
// Step 3: Check context budget and compress if needed
const tools = deps.registry.toModelTools();
const preliminarySystemPrompt = await buildSystemPrompt(deps.memory, deps.contextProviders);
const overheadTokens = estimateOverheadTokens(preliminarySystemPrompt, tools, maxTokens);

if (deps.compactor && shouldCompress(history, deps.config.context_budget, modelMaxTokens, overheadTokens)) {
  const result = await deps.compactor.compress(history, id);
  history = Array.from(result.history);
}
```

Note: The preliminary system prompt won't include skills (those are added per-round at line 127-139). This means the overhead estimate may underestimate by the size of injected skill content. This is an intentional design trade-off:
- Building the full system prompt (with skills) requires the user message for semantic matching, which is available, but skill retrieval adds latency to the compression check
- The pre-flight guard (Phase 4) explicitly backstops this gap — it recomputes overhead with the actual per-round system prompt (including skills) and truncates if needed
- The compression check is a trigger for quality improvement (summarisation), not a safety guarantee — the pre-flight guard provides the safety guarantee

**Testing:**

This is an integration concern tested by AC1.2. The AC states: "Overhead calculation includes system prompt, serialised tool definitions, and `max_tokens` output reservation." This is verified structurally — `estimateOverheadTokens` uses all three inputs, and `agent.ts` passes them. The unit tests for `shouldCompress` in Task 1 verify the math works. Add a unit test for `estimateOverheadTokens` itself:

- Test with system prompt + tools + maxOutputTokens — verify sum matches expected.
- Test with no system prompt and no tools — verify only maxOutputTokens contributes.

**Verification:**

Run: `bun test src/agent/context.test.ts`
Expected: All tests pass.

Run: `bun run build`
Expected: Type-check passes.

**Commit:** `feat(agent): compute overhead tokens for budget check`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
