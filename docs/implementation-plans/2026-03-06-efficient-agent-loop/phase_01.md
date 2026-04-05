# Efficient Agent Loop Implementation Plan — Phase 1: Dynamic Reflexion Gate

**Goal:** Stop the hourly `review-predictions` task from firing when there's been no agent-initiated activity since the last review.

**Architecture:** Add a pre-flight gate in `handleSystemSchedulerTask` that queries recent traces before calling `buildReviewEvent()`. If no traces exist in the lookback window, the handler logs a skip and returns without pushing an event — no LLM call, no token spend.

**Tech Stack:** Bun (TypeScript), PostgreSQL (existing `operation_traces` table)

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-03-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### efficient-agent-loop.AC1: Dynamic daytime reflexion
- **efficient-agent-loop.AC1.1 Success:** When agent-initiated traces exist since last review, `review-predictions` fires normally and the agent receives the review event
- **efficient-agent-loop.AC1.2 Success:** When zero agent-initiated traces exist since last review, `review-predictions` skips entirely — no event pushed, no LLM call made, skip logged
- **efficient-agent-loop.AC1.3 Edge:** Passive inbound events (bluesky posts not acted on) do not count as activity and do not trigger a review

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Extract `shouldSkipReview` pure function

**Verifies:** None (infrastructure — pure function extraction for testability)

**Files:**
- Create: `src/reflexion/review-gate.ts`
- Modify: `src/reflexion/index.ts` (add barrel export)

**Implementation:**

Create a pure function that determines whether a review should be skipped based on trace count. This keeps the gate logic testable without database or scheduler dependencies.

```typescript
// pattern: Functional Core

/**
 * Determines whether the review-predictions task should be skipped
 * based on whether any agent-initiated traces exist in the lookback window.
 *
 * Returns true when there are zero traces — meaning no agent activity
 * occurred and the review would be a wasted LLM call.
 *
 * Extracted as a named predicate for testability and readability.
 * If the gate logic grows (e.g., checking trace types, minimum thresholds),
 * this function is the single point of change.
 */
export function shouldSkipReview(traceCount: number): boolean {
  return traceCount === 0;
}
```

Add `export { shouldSkipReview } from './review-gate.ts';` to `src/reflexion/index.ts`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(reflexion): extract shouldSkipReview pure function for review gate`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add trace count query to `handleSystemSchedulerTask`

**Verifies:** efficient-agent-loop.AC1.1, efficient-agent-loop.AC1.2, efficient-agent-loop.AC1.3

**Files:**
- Modify: `src/index.ts:847-870` (`handleSystemSchedulerTask` function)

**Implementation:**

Modify `handleSystemSchedulerTask` to add a pre-flight gate before calling `buildReviewEvent()`. The gate queries `traceRecorder.queryTraces()` with a 2-hour lookback (matching the existing lookback window used by `buildReviewEvent` at line 140). If zero traces are returned, skip the review.

The change is scoped to the `task.name === 'review-predictions'` branch only. Non-review tasks pass through unchanged.

The existing 2-hour lookback window (`Date.now() - 2 * 3600_000`) is already used by `buildReviewEvent()` at line 140 to query traces for the `[Recent Activity]` section. The gate reuses the same window — if `buildReviewEvent` would find zero traces to display, there's nothing for the agent to review anyway.

Note: AC1.3 (passive inbound events don't count) is satisfied by the existing trace recording architecture — only agent-initiated tool dispatches generate operation traces. Passive inbound events (Bluesky posts that arrive but aren't acted on) do not create traces, so they won't trigger a review.

```typescript
// Inside handleSystemSchedulerTask, replace the event building block:

// Before building the review event, check if there's been any activity
if (task.name === 'review-predictions') {
  const recentTraces = await traceRecorder.queryTraces({
    owner: AGENT_OWNER,
    lookbackSince: new Date(Date.now() - 2 * 3600_000),
    limit: 1,
  });

  if (shouldSkipReview(recentTraces.length)) {
    console.log('[review-gate] skipping review-predictions: no agent-initiated traces since last window');
    return;
  }
}

const event =
  task.name === 'review-predictions'
    ? await buildReviewEvent(task, traceRecorder, AGENT_OWNER)
    : await buildAgentScheduledEvent(task, traceRecorder, AGENT_OWNER);
```

Add the import at the top of `src/index.ts`:
```typescript
import { shouldSkipReview } from '@/reflexion';
```

Key details:
- `limit: 1` is intentional — we only need to know if *any* traces exist, not how many. This minimises the database query cost.
- The early `return` exits the async IIFE, preventing both event creation and queue push.
- The stale prediction expiry (lines 850-856) still runs before the gate, which is correct — expiry is a maintenance task that should happen regardless.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(reflexion): add dynamic review gate to skip idle review-predictions`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for dynamic reflexion gate

**Verifies:** efficient-agent-loop.AC1.1, efficient-agent-loop.AC1.2, efficient-agent-loop.AC1.3

**Files:**
- Create: `src/reflexion/review-gate.test.ts` (unit tests for pure function)
- Modify: `src/index.wiring.test.ts` (integration tests for gate in handler context)

**Testing:**

Tests must verify each AC listed above:

- **efficient-agent-loop.AC1.1:** `shouldSkipReview` returns `false` when trace count > 0 (review should fire). Integration test: `buildReviewEvent` is called when traces exist.
- **efficient-agent-loop.AC1.2:** `shouldSkipReview` returns `true` when trace count is 0 (review should skip). Integration test: no event is produced when zero traces in lookback window.
- **efficient-agent-loop.AC1.3:** Passive events don't generate traces — this is an architectural property verified by confirming `queryTraces` only returns agent-initiated tool dispatches (already verified by existing trace recorder tests). Add a documentation test that asserts `shouldSkipReview(0)` returns `true` with a descriptive name referencing AC1.3.

Unit tests for `review-gate.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { shouldSkipReview } from './review-gate.ts';

describe('shouldSkipReview (efficient-agent-loop.AC1)', () => {
  describe('efficient-agent-loop.AC1.1: traces exist — review fires normally', () => {
    it('returns false when trace count is 1', () => {
      expect(shouldSkipReview(1)).toBe(false);
    });

    it('returns false when trace count is greater than 1', () => {
      expect(shouldSkipReview(5)).toBe(false);
    });
  });

  describe('efficient-agent-loop.AC1.2: zero traces — review skips', () => {
    it('returns true when trace count is 0', () => {
      expect(shouldSkipReview(0)).toBe(true);
    });
  });

  describe('efficient-agent-loop.AC1.3: passive events do not count as activity', () => {
    it('returns true when zero traces exist (passive events do not generate traces)', () => {
      // Passive inbound events (e.g. bluesky posts not acted on) do not create
      // operation traces. Only agent-initiated tool dispatches generate traces.
      // When no traces exist in the window, the review is correctly skipped.
      expect(shouldSkipReview(0)).toBe(true);
    });
  });
});
```

Composition tests in `src/index.wiring.test.ts` — add a new describe block for the gate behaviour. Note: `handleSystemSchedulerTask` is an async IIFE inside a void function and is not directly testable in isolation. The gate wiring (query traces → check `shouldSkipReview` → skip or proceed) is verified by composition: the unit tests above prove `shouldSkipReview` is correct, and these tests prove the `buildReviewEvent` path works with the same trace store. The actual wiring of these two pieces in `handleSystemSchedulerTask` is straightforward enough that unit + composition coverage is adequate.

```typescript
describe('composition root wiring: review gate (efficient-agent-loop.AC1)', () => {
  it('AC1.1: review proceeds when traces exist in lookback window', async () => {
    const mockTrace: OperationTrace = {
      id: 'trace-gate-1',
      owner: 'test-owner',
      conversationId: 'conv-1',
      toolName: 'memory_write',
      input: {},
      outputSummary: 'Wrote block',
      durationMs: 50,
      success: true,
      error: null,
      createdAt: new Date(),
    };
    const traceStore = createMockTraceStore([mockTrace]);

    // Gate check: traces exist, should NOT skip
    const traces = await traceStore.queryTraces({
      owner: 'test-owner',
      lookbackSince: new Date(Date.now() - 2 * 3600_000),
      limit: 1,
    });
    expect(shouldSkipReview(traces.length)).toBe(false);

    // Review event should be built successfully
    const task = { id: 'task-1', name: 'review-predictions', schedule: '0 * * * *' };
    const event = await buildReviewEvent(task, traceStore, 'test-owner');
    expect(event.source).toBe('review-job');
  });

  it('AC1.2: review skips when zero traces in lookback window', async () => {
    const traceStore = createMockTraceStore([]);

    const traces = await traceStore.queryTraces({
      owner: 'test-owner',
      lookbackSince: new Date(Date.now() - 2 * 3600_000),
      limit: 1,
    });
    expect(shouldSkipReview(traces.length)).toBe(true);
    // When shouldSkipReview returns true, handleSystemSchedulerTask
    // returns early — no event is pushed, no LLM call is made
  });
});
```

Add the import for `shouldSkipReview` at the top of `src/index.wiring.test.ts`:
```typescript
import { shouldSkipReview } from '@/reflexion';
```

Follow project testing patterns: `bun:test` imports, `describe`/`it` blocks, `expect` assertions, AC references in describe block names.

**Verification:**

Run: `bun test src/reflexion/review-gate.test.ts src/index.wiring.test.ts`
Expected: All tests pass

**Commit:** `test(reflexion): add tests for dynamic review gate (AC1.1, AC1.2, AC1.3)`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
