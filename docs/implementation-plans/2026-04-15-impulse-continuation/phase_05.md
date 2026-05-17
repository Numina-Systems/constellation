# Impulse Continuation Implementation Plan — Phase 5

**Goal:** Wire the continuation loop into the composition root's impulse and introspection handlers, and wire budget reset into wake transition.

**Architecture:** Imperative Shell integration. Extracts the continuation loop into a testable pure-ish function (`runContinuationLoop`) in a new file `src/subconscious/continuation-loop.ts`, then wires it into `src/index.ts`. Creates `ContinuationBudget` and `ContinuationJudge` instances in the composition root, passes them to the loop function after each impulse/introspection event, and resets budget on wake transition.

**Tech Stack:** TypeScript, Bun test runner

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### impulse-continuation.AC4: Impulse continuation loop
- **impulse-continuation.AC4.1 Success:** After impulse completes, judge is called with response, traces since round start, active interests, and event type `impulse`
- **impulse-continuation.AC4.2 Success:** When judge returns `shouldContinue: true` and budget allows, a new impulse is assembled and processed immediately
- **impulse-continuation.AC4.3 Success:** Continuation chains up to per-event limit then stops
- **impulse-continuation.AC4.4 Failure:** Judge error during continuation does not prevent the original impulse from completing normally
- **impulse-continuation.AC4.5 Success:** Each continuation round runs post-impulse housekeeping (engagement decay, cap enforcement)

### impulse-continuation.AC5: Introspection continuation loop
- **impulse-continuation.AC5.1 Success:** After introspection completes, judge is called with event type `introspection` and continuation fires another introspection (not an impulse)
- **impulse-continuation.AC5.2 Success:** Introspection continuations share the same per-cycle budget as impulse continuations

---

## Reference Files

The executor MUST read these files before implementing:

- `src/index.ts:1040-1058` — Current impulse handler (`handleSystemSchedulerTaskWithActivity`)
- `src/index.ts:1023-1038` — `runPostImpulseHousekeeping()` function
- `src/index.ts:1073-1104` — `handleTransition` function (wake/sleep transitions)
- `src/index.ts:1088-1099` — Wake transition handler (morning agenda + `wakeHandler()`)
- `src/index.ts:856-864` — `impulseAssembler` instantiation
- `src/index.ts:453-472` — `model` (ModelProvider) instantiation
- `src/index.ts:513` — `interestRegistry` instantiation
- `src/index.ts:528` — `traceRecorder` (TraceStore) instantiation
- `src/index.ts:933-970` — `handleSystemSchedulerTask` with review-predictions handling
- `src/index.ts:135` — `buildReviewEvent()` function for introspection events
- `src/index.wiring.test.ts` — Existing composition root tests
- `src/subconscious/continuation.ts` — Types and pure functions (Phase 1)
- `src/subconscious/continuation-budget.ts` — Budget counter (Phase 2)
- `src/subconscious/continuation-judge.ts` — Judge adapter (Phase 3)

---

## Important Architectural Notes

**Two different event paths exist:**
- **Impulse events** → `subconsciousAgent.processEvent(event)` (separate conversation, separate Agent instance)
- **Introspection events** (review-predictions) → main `agent` via `processEventQueue` (main conversation)

**`processEvent` returns `Promise<string>`** — the agent's response text, which is passed to the continuation judge.

**Introspection builds events with `buildReviewEvent(task, traceRecorder, owner)`** — not via `impulseAssembler`. The continuation loop for introspection must call `buildReviewEvent` to create follow-up introspection events.

**Concurrency model for introspection continuation:** The introspection continuation loop calls `agent.processEvent()` directly rather than going through the `schedulerEventQueue`. This is safe because:
1. The handler runs inside an async IIFE — the continuation loop is sequential within it
2. The `schedulerProcessing` mutex in `processSchedulerEvent()` prevents concurrent queue processing
3. This is the same concurrency pattern used by the impulse handler, which calls `subconsciousAgent.processEvent()` directly (line 1047)
4. The existing architecture already allows scheduler-triggered `processEvent` calls to race with REPL user input — this is a pre-existing design choice, not a new risk

The direct call is necessary because the continuation loop needs the response text from each round, which `processEventQueue` discards.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Extract continuation loop into testable function

**Verifies:** impulse-continuation.AC4.1, impulse-continuation.AC4.2, impulse-continuation.AC4.3, impulse-continuation.AC4.4, impulse-continuation.AC4.5

**Files:**
- Create: `src/subconscious/continuation-loop.ts`

**Implementation:**

Create `src/subconscious/continuation-loop.ts` with pattern annotation `// pattern: Imperative Shell` on line 1.

Extract the continuation loop logic into a testable function that receives all dependencies as parameters:

```typescript
import type { ContinuationJudge, ContinuationBudget } from './continuation-budget.ts';
import type { ContinuationJudgeContext } from './continuation.ts';
import type { OperationTrace } from '@/reflexion/types';
import type { Interest } from './types.ts';
import type { ExternalEvent } from '@/agent/types';

type ContinuationLoopDeps = {
  readonly judge: ContinuationJudge;
  readonly budget: ContinuationBudget;
  readonly queryTraces: (since: Date) => Promise<ReadonlyArray<OperationTrace>>;
  readonly queryInterests: () => Promise<ReadonlyArray<Interest>>;
  readonly assembleEvent: () => Promise<ExternalEvent>;
  readonly processEvent: (event: ExternalEvent) => Promise<string>;
  readonly onHousekeeping?: () => Promise<void>;
  readonly eventType: 'impulse' | 'introspection';
};
```

Implement the loop function:

```typescript
async function runContinuationLoop(
  deps: Readonly<ContinuationLoopDeps>,
  initialResponse: string,
  roundStart: Date,
): Promise<void>
```

The function:
1. Enters a while loop checking `deps.budget.canContinue()`
2. Queries traces since `roundStart` via `deps.queryTraces(roundStart)`
3. Queries active interests via `deps.queryInterests()`
4. Calls `deps.judge.evaluate({ agentResponse, traces, interests, eventType: deps.eventType })`
5. If `shouldContinue` is false, logs reason and breaks
6. If `shouldContinue` is true:
   - Calls `deps.budget.spend()`
   - Logs: `console.log(\`[continuation] ${deps.eventType} continuation round (reason: ${decision.reason})\`)`
   - Updates `roundStart = new Date()`
   - Assembles new event via `deps.assembleEvent()`
   - Processes via `deps.processEvent(event)` and captures response
   - Calls `deps.onHousekeeping?.()` if provided
7. Wraps the ENTIRE loop in try/catch — on error, logs and returns (AC4.4)

Export `ContinuationLoopDeps` and `runContinuationLoop` as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): extract continuation loop into testable function`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Continuation loop tests

**Verifies:** impulse-continuation.AC4.1, impulse-continuation.AC4.2, impulse-continuation.AC4.3, impulse-continuation.AC4.4, impulse-continuation.AC4.5, impulse-continuation.AC5.1

**Files:**
- Create: `src/subconscious/continuation-loop.test.ts`
- Test: `src/subconscious/continuation-loop.test.ts` (unit)

**Testing:**

Tests use closure-based mocks for all dependencies (same pattern as `impulse-assembler.test.ts`). Create a helper that builds mock deps with configurable judge responses and budget limits.

Tests must verify each AC:

- **impulse-continuation.AC4.1:** Mock all deps. Call `runContinuationLoop`. Capture the `ContinuationJudgeContext` passed to `judge.evaluate`. Assert it contains: the `initialResponse` text, traces returned by `queryTraces`, interests returned by `queryInterests`, and `eventType: 'impulse'`.

- **impulse-continuation.AC4.2:** Mock judge to return `{ shouldContinue: true, reason: 'momentum' }` on first call, then `{ shouldContinue: false, reason: 'done' }`. Assert `processEvent` was called exactly once (the continuation round), `assembleEvent` was called once, and `budget.spend()` was called once.

- **impulse-continuation.AC4.3:** Mock judge to always return `{ shouldContinue: true, reason: 'more' }`. Budget with `maxPerEvent: 3, maxPerCycle: 10`. Assert exactly 3 continuation rounds fire (3 `processEvent` calls, 3 `spend` calls), then loop exits.

- **impulse-continuation.AC4.4:** Mock judge to throw `new Error('model timeout')`. Assert loop exits without throwing. Assert initial impulse response was not affected (function returns void, doesn't throw).

- **impulse-continuation.AC4.5:** Mock judge to return `shouldContinue: true` once, then false. Assert `onHousekeeping` was called exactly once (after the continuation round).

- **impulse-continuation.AC5.1:** Call `runContinuationLoop` with `eventType: 'introspection'`. Capture the context passed to judge. Assert `eventType` is `'introspection'`. Assert `assembleEvent` was called (to build another introspection event, not an impulse).

**Verification:**
Run: `bun test src/subconscious/continuation-loop.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add continuation loop tests`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports for continuation-loop

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/subconscious/index.ts`

**Implementation:**

Add exports for the new continuation-loop module (in addition to exports added in Phase 4 Task 3):

```typescript
export { runContinuationLoop } from './continuation-loop.ts';
export type { ContinuationLoopDeps } from './continuation-loop.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): export continuation loop from barrel`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Instantiate ContinuationBudget and ContinuationJudge in composition root

**Verifies:** None (infrastructure wiring)

**Files:**
- Modify: `src/index.ts`

**Implementation:**

Add imports near the top of `src/index.ts` (with other subconscious imports):

```typescript
import { createContinuationBudget, createContinuationJudge, runContinuationLoop } from '@/subconscious';
```

After the `impulseAssembler` instantiation (line ~864), add budget and judge creation:

```typescript
// Continuation budget and judge — undefined when subconscious is disabled.
// Fallback defaults match Zod schema defaults, covering the case where
// config.subconscious is entirely absent (section omitted from TOML).
const continuationBudget = subconsciousAgent
  ? createContinuationBudget({
      maxPerEvent: config.subconscious?.max_continuations_per_event ?? 2,
      maxPerCycle: config.subconscious?.max_continuations_per_cycle ?? 10,
    })
  : undefined;

const continuationJudge = subconsciousAgent
  ? createContinuationJudge({
      model,
      modelName: config.model.model,
    })
  : undefined;
```

Both are `undefined` when subconscious is disabled, matching the guard pattern used by `impulseAssembler` and `subconsciousAgent`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(index): instantiate continuation budget and judge`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Wire impulse continuation loop

**Verifies:** impulse-continuation.AC4.1, impulse-continuation.AC4.2, impulse-continuation.AC4.3, impulse-continuation.AC4.4, impulse-continuation.AC4.5

**Files:**
- Modify: `src/index.ts:1040-1058` (the `handleSystemSchedulerTaskWithActivity` function)

**Implementation:**

Modify the impulse handler branch (currently at line 1043-1054) to add the continuation loop after the initial impulse completes:

```typescript
} else if (task.name === 'subconscious-impulse' && subconsciousAgent && impulseAssembler) {
  (async () => {
    try {
      continuationBudget?.resetEvent();
      let roundStart = new Date();
      const event = await impulseAssembler.assembleImpulse();
      const responseText = await subconsciousAgent.processEvent(event);
      await runPostImpulseHousekeeping();

      // Continuation loop (best-effort, errors don't break normal flow)
      if (continuationBudget && continuationJudge) {
        await runContinuationLoop(
          {
            judge: continuationJudge,
            budget: continuationBudget,
            queryTraces: (since) => traceRecorder.queryTraces({ owner: AGENT_OWNER, lookbackSince: since, limit: 20 }),
            queryInterests: () => interestRegistry.listInterests(AGENT_OWNER, { status: 'active' }),
            assembleEvent: () => impulseAssembler.assembleImpulse(),
            processEvent: (e) => subconsciousAgent.processEvent(e),
            onHousekeeping: runPostImpulseHousekeeping,
            eventType: 'impulse',
          },
          responseText,
          roundStart,
        );
      }
    } catch (error) {
      console.error('impulse event processing error:', error);
    }
  })().catch((error) => {
    console.error('impulse task error:', error);
  });
}
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(index): wire impulse continuation loop`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Wire introspection continuation loop

**Verifies:** impulse-continuation.AC5.1, impulse-continuation.AC5.2

**Files:**
- Modify: `src/index.ts:933-970` (the `handleSystemSchedulerTask` function, review-predictions branch)

**Implementation:**

Modify the review-predictions branch inside `handleSystemSchedulerTask`. The existing code builds a review event, pushes it to `schedulerEventQueue`, and calls `processSchedulerEvent()`. Replace the queue-based approach with direct `agent.processEvent()` to capture the response text needed by the continuation loop.

The existing stale-prediction expiry logic and trace-check skip logic MUST remain unchanged before the continuation-aware block.

After the skip-check, replace the queue push with:

```typescript
if (task.name === 'review-predictions') {
  // ... existing trace check / skip logic stays ...

  continuationBudget?.resetEvent();
  const roundStart = new Date();
  const event = await buildReviewEvent(task, traceRecorder, AGENT_OWNER);
  const responseText = await agent.processEvent(event);

  // Introspection continuation loop (shared budget with impulse — AC5.2)
  if (continuationBudget && continuationJudge) {
    await runContinuationLoop(
      {
        judge: continuationJudge,
        budget: continuationBudget,
        queryTraces: (since) => traceRecorder.queryTraces({ owner: AGENT_OWNER, lookbackSince: since, limit: 20 }),
        queryInterests: () => interestRegistry.listInterests(AGENT_OWNER, { status: 'active' }),
        assembleEvent: () => buildReviewEvent(task, traceRecorder, AGENT_OWNER),
        processEvent: (e) => agent.processEvent(e),
        eventType: 'introspection',
        // No onHousekeeping — engagement decay is impulse-specific
      },
      responseText,
      roundStart,
    );
  }
}
```

**Concurrency safety note:** This changes introspection from queue-based to direct `processEvent` calls. See "Important Architectural Notes" above for why this is safe.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(index): wire introspection continuation loop`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Add budget reset on wake transition

**Verifies:** impulse-continuation.AC5.2 (budget resets on wake)

**Files:**
- Modify: `src/index.ts:1088-1099` (the `transition-to-wake` branch in `handleTransition`)

**Implementation:**

In the `transition-to-wake` branch (line 1088), add `continuationBudget?.resetCycle()` BEFORE the morning agenda dispatch. This resets both per-event and per-cycle counters at the start of each wake cycle.

```typescript
} else if (task.name === 'transition-to-wake') {
  // Reset continuation budget for new wake cycle
  continuationBudget?.resetCycle();

  // Dispatch morning agenda to subconscious before queue drain
  if (subconsciousAgent && impulseAssembler) {
    // ... existing morning agenda code unchanged ...
  }
  await wakeHandler();
}
```

The `?.` operator handles the case where `continuationBudget` is `undefined` (subconscious disabled).

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(index): reset continuation budget on wake transition`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Composition root wiring tests

**Verifies:** impulse-continuation.AC5.2

**Files:**
- Modify: `src/index.wiring.test.ts`
- Test: `src/index.wiring.test.ts` (unit)

**Testing:**

Add a new `describe` block for impulse continuation wiring. These tests verify the composition root imports and configuration, complementing the unit tests in `continuation-loop.test.ts` which cover the loop logic itself (AC4.1-AC4.5, AC5.1).

Tests must verify:

- **impulse-continuation.AC5.2 (shared budget):** Create a single `ContinuationBudget` with `maxPerCycle: 3`. Spend once (simulating impulse continuation), then spend once more (simulating introspection continuation). Assert `canContinue()` returns `true` (1 remaining). Spend again. Assert `canContinue()` returns `false`. This proves the same budget instance tracks both event types.

**Verification:**
Run: `bun test src/index.wiring.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(index): add continuation budget sharing test`

<!-- END_TASK_8 -->
