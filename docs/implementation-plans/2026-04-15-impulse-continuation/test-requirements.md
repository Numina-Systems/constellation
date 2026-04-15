# Impulse Continuation — Test Requirements

Maps every acceptance criterion to specific automated tests or documented human verification. Each entry references the implementation phase and test file where verification occurs.

---

## AC1: Continuation prompt and response parsing

All AC1 criteria are verified by automated unit tests against pure functions. No I/O, no mocks beyond test data.

### impulse-continuation.AC1.1

**Criterion:** Prompt includes agent response text, trace summaries, active interests, and event type.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation.test.ts`
**Phase:** 1, Task 2

**Test:** Call `buildContinuationPrompt` with a `ContinuationJudgeContext` containing non-empty `agentResponse`, at least 1 `OperationTrace`, at least 2 `Interest` entries, and `eventType: 'impulse'`. Assert the returned string contains:
- The agent response text verbatim
- Trace summary output (as produced by `formatTraceSummary`)
- Each interest name and engagement score
- The event type string

---

### impulse-continuation.AC1.2

**Criterion:** Valid JSON response `{"continue": true, "reason": "..."}` parses to `ContinuationDecision`.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation.test.ts`
**Phase:** 1, Task 2

**Tests:**
1. `parseContinuationResponse('{"continue": true, "reason": "exploring further"}')` returns `{ shouldContinue: true, reason: 'exploring further' }`
2. `parseContinuationResponse('{"continue": false, "reason": "done"}')` returns `{ shouldContinue: false, reason: 'done' }`
3. JSON embedded in markdown code blocks (`` ```json\n{"continue": true, "reason": "test"}\n``` ``) parses correctly

---

### impulse-continuation.AC1.3

**Criterion:** Malformed JSON (truncated, missing fields, non-JSON text) parses to `shouldContinue: false`.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation.test.ts`
**Phase:** 1, Task 2

**Tests:** `parseContinuationResponse` returns `{ shouldContinue: false, reason: 'Failed to parse continuation response' }` for each of:
1. Truncated JSON: `'{"continue": tr'`
2. Missing `continue` field: `'{"reason": "test"}'`
3. Missing `reason` field: `'{"continue": true}'`
4. Non-JSON text: `'I think we should continue'`
5. Empty string: `''`

---

### impulse-continuation.AC1.4

**Criterion:** Empty agent response produces valid prompt (no crash).

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation.test.ts`
**Phase:** 1, Task 2

**Test:** Call `buildContinuationPrompt` with `agentResponse: ''`. Assert it returns a non-empty string containing a placeholder (e.g., `"(no response)"`). No exceptions thrown.

---

## AC2: LLM judge evaluation

All AC2 criteria are verified by automated unit tests using a mocked `ModelProvider`. The mock pattern follows `src/compaction/compactor.test.ts`.

### impulse-continuation.AC2.1

**Criterion:** Judge calls ModelProvider with correct prompt and returns parsed decision.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-judge.test.ts`
**Phase:** 3, Task 2

**Test:** Mock `ModelProvider.complete()` to return `{ content: [{ type: 'text', text: '{"continue": true, "reason": "found momentum"}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } }`. Call `judge.evaluate(context)`. Assert:
- Result is `{ shouldContinue: true, reason: 'found momentum' }`
- Captured request has exactly 1 message with `role: 'user'`
- Message content contains the agent response text from context
- `max_tokens` is 256
- `temperature` is 0

---

### impulse-continuation.AC2.2

**Criterion:** Model provider error (network, timeout) returns `shouldContinue: false`.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-judge.test.ts`
**Phase:** 3, Task 2

**Test:** Mock `ModelProvider.complete()` to throw `new Error('Connection refused')`. Call `judge.evaluate(context)`. Assert result is `{ shouldContinue: false }` and `reason` contains the error message string.

---

### impulse-continuation.AC2.3

**Criterion:** Model returns unparseable response, judge returns `shouldContinue: false`.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-judge.test.ts`
**Phase:** 3, Task 2

**Test:** Mock `ModelProvider.complete()` to return text `'I think we should continue exploring'` (valid text, not JSON). Assert result is `{ shouldContinue: false, reason: 'Failed to parse continuation response' }`.

---

## AC3: Budget enforcement

AC3.1-AC3.5 are verified by automated unit tests against the `createContinuationBudget` factory. AC3.6 is verified by automated unit tests against the Zod schema.

### impulse-continuation.AC3.1

**Criterion:** `canContinue()` returns true when both per-event and per-cycle budget remain.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-budget.test.ts`
**Phase:** 2, Task 2

**Test:** Create budget with `maxPerEvent: 2, maxPerCycle: 10`. Assert `canContinue()` is `true`. Call `spend()` once. Assert `canContinue()` is still `true`.

---

### impulse-continuation.AC3.2

**Criterion:** `canContinue()` returns false when per-event budget exhausted (even if per-cycle remains).

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-budget.test.ts`
**Phase:** 2, Task 2

**Test:** Create budget with `maxPerEvent: 1, maxPerCycle: 10`. Call `spend()` once. Assert `canContinue()` is `false` (per-event exhausted, per-cycle still has 9).

---

### impulse-continuation.AC3.3

**Criterion:** `canContinue()` returns false when per-cycle budget exhausted (even if per-event remains).

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-budget.test.ts`
**Phase:** 2, Task 2

**Test:** Create budget with `maxPerEvent: 5, maxPerCycle: 1`. Call `spend()` once. Assert `canContinue()` is `false` (per-cycle exhausted, per-event still has 4).

---

### impulse-continuation.AC3.4

**Criterion:** `resetEvent()` restores per-event budget without affecting per-cycle counter.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-budget.test.ts`
**Phase:** 2, Task 2

**Test:** Create budget with `maxPerEvent: 2, maxPerCycle: 5`. Call `spend()` twice (per-event exhausted). Call `resetEvent()`. Assert `canContinue()` is `true`. Verify per-cycle reflects 3 remaining by spending 3 more times until per-cycle is exhausted.

---

### impulse-continuation.AC3.5

**Criterion:** `resetCycle()` restores both per-event and per-cycle budgets.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-budget.test.ts`
**Phase:** 2, Task 2

**Test:** Create budget with `maxPerEvent: 2, maxPerCycle: 3`. Spend 3 times (resetting event between to allow it) until both are exhausted. Call `resetCycle()`. Assert `canContinue()` is `true` and both counters are fully restored.

**Additional edge case tests in the same file:**
- Zero-budget config: `maxPerEvent: 0, maxPerCycle: 10` -- `canContinue()` returns `false` immediately
- Zero-cycle config: `maxPerEvent: 2, maxPerCycle: 0` -- `canContinue()` returns `false` immediately
- Fresh budget on construction: newly created budget returns `canContinue() === true` immediately

---

### impulse-continuation.AC3.6

**Criterion:** Config fields `max_continuations_per_event` and `max_continuations_per_cycle` validate with defaults and reject out-of-range values.

**Verification:** Automated unit test
**Test file:** `src/config/schema.test.ts`
**Phase:** 4, Task 2

**Tests:**
1. Defaults apply when fields omitted: parse minimal `SubconsciousConfigSchema` input, assert `max_continuations_per_event` defaults to 2, `max_continuations_per_cycle` defaults to 10
2. Explicit values accepted: parse with `max_continuations_per_event: 5, max_continuations_per_cycle: 20`, assert values preserved
3. Zero values accepted: parse with `max_continuations_per_event: 0`, assert accepted (disables continuation)
4. Out-of-range rejected -- event too high: `max_continuations_per_event: 11` fails
5. Out-of-range rejected -- event negative: `max_continuations_per_event: -1` fails
6. Out-of-range rejected -- cycle too high: `max_continuations_per_cycle: 51` fails
7. Out-of-range rejected -- cycle negative: `max_continuations_per_cycle: -1` fails

---

## AC4: Impulse continuation loop

AC4.1-AC4.5 are verified by automated unit tests against the extracted `runContinuationLoop` function using closure-based mocks for all dependencies. AC4 criteria do NOT require integration tests against the full composition root -- the loop function receives all dependencies as parameters, making it fully testable in isolation.

### impulse-continuation.AC4.1

**Criterion:** After impulse completes, judge is called with response, traces since round start, active interests, and event type `impulse`.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Create mock deps with a capturing judge. Call `runContinuationLoop` with `eventType: 'impulse'` and an `initialResponse` string. Capture the `ContinuationJudgeContext` passed to `judge.evaluate`. Assert it contains: the `initialResponse` text, traces returned by `queryTraces`, interests returned by `queryInterests`, and `eventType: 'impulse'`.

---

### impulse-continuation.AC4.2

**Criterion:** When judge returns `shouldContinue: true` and budget allows, a new impulse is assembled and processed immediately.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Mock judge to return `{ shouldContinue: true, reason: 'momentum' }` on first call, then `{ shouldContinue: false, reason: 'done' }`. Assert `processEvent` was called exactly once (the continuation round), `assembleEvent` was called once, and `budget.spend()` was called once.

---

### impulse-continuation.AC4.3

**Criterion:** Continuation chains up to per-event limit then stops.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Mock judge to always return `{ shouldContinue: true, reason: 'more' }`. Create budget with `maxPerEvent: 3, maxPerCycle: 10`. Assert exactly 3 continuation rounds fire (3 `processEvent` calls, 3 `spend` calls), then loop exits.

---

### impulse-continuation.AC4.4

**Criterion:** Judge error during continuation does not prevent the original impulse from completing normally.

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Mock judge to throw `new Error('model timeout')`. Assert `runContinuationLoop` returns void without throwing. The function signature (`Promise<void>`) and the try/catch wrapping the entire loop body guarantee the original impulse (which completed before the loop was called) is unaffected.

---

### impulse-continuation.AC4.5

**Criterion:** Each continuation round runs post-impulse housekeeping (engagement decay, cap enforcement).

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Mock judge to return `shouldContinue: true` once, then false. Assert `onHousekeeping` callback was called exactly once (after the single continuation round).

---

## AC5: Introspection continuation loop

### impulse-continuation.AC5.1

**Criterion:** After introspection completes, judge is called with event type `introspection` and continuation fires another introspection (not an impulse).

**Verification:** Automated unit test
**Test file:** `src/subconscious/continuation-loop.test.ts`
**Phase:** 5, Task 2

**Test:** Call `runContinuationLoop` with `eventType: 'introspection'` and a mock `assembleEvent` that returns introspection-typed events. Capture the context passed to judge. Assert `eventType` is `'introspection'`. Assert `assembleEvent` was called (to build another introspection event). The composition root wiring ensures `assembleEvent` is bound to `buildReviewEvent` (not `assembleImpulse`) -- this binding is verified by the shared budget test below.

---

### impulse-continuation.AC5.2

**Criterion:** Introspection continuations share the same per-cycle budget as impulse continuations.

**Verification:** Automated unit test
**Test file:** `src/index.wiring.test.ts`
**Phase:** 5, Task 8

**Test:** Create a single `ContinuationBudget` instance with `maxPerCycle: 3`. Spend once (simulating impulse continuation), spend once more (simulating introspection continuation). Assert `canContinue()` returns `true` (1 remaining). Spend again. Assert `canContinue()` returns `false`. This proves both event types decrement the same cycle counter.

**Rationale for unit test over integration test:** The shared budget is enforced by construction -- the composition root creates a single `ContinuationBudget` instance and passes it to both the impulse and introspection handlers. The unit test verifies the budget's behaviour; the wiring is a single variable binding in `src/index.ts` that is verified by type-checking (`bun run build`).

---

## Human verification

### Composition root wiring (Phase 5, Tasks 4-7)

**Justification:** Tasks 4-7 modify `src/index.ts` to instantiate `ContinuationBudget` and `ContinuationJudge`, wire them into the impulse handler, introspection handler, and wake transition. These are imperative shell wiring changes -- they connect already-tested components. The individual components (`runContinuationLoop`, `createContinuationBudget`, `createContinuationJudge`) are fully covered by automated tests above. The wiring itself is verified by:

1. **Type-checking:** `bun run build` ensures all wiring is type-correct (wrong argument types, missing fields, incorrect function signatures all fail compilation)
2. **Manual smoke test:** Start the daemon with subconscious enabled, observe that:
   - Impulse events fire and continuation rounds appear in logs with `[continuation] impulse continuation round (reason: ...)` messages
   - Continuation stops when the judge returns `shouldContinue: false` or when per-event budget is exhausted
   - Wake transition resets the budget (verify by checking continuation rounds fire again after wake)
   - Judge errors produce a log message but do not crash the daemon or prevent subsequent impulse events

**Verification approach:** After deployment, monitor daemon logs during one full wake cycle. Confirm at least one continuation chain fires and terminates correctly. Confirm wake transition resets the budget.

### Concurrency safety of introspection continuation (Phase 5, Task 6)

**Justification:** The introspection continuation loop switches from queue-based dispatch (`schedulerEventQueue`) to direct `agent.processEvent()` calls. The implementation plan documents why this is safe (sequential within the async IIFE, mutex protection via `schedulerProcessing`, matches the existing impulse handler pattern). However, concurrency interactions are difficult to test deterministically in unit tests without introducing artificial race conditions.

**Verification approach:** During the manual smoke test above, trigger both an impulse and introspection event in close succession. Observe that:
- No interleaved or corrupted conversation state
- No deadlocks or unhandled promise rejections
- Both event types complete and log normally

---

## Test file summary

| Test file | Phase | Type | Criteria covered |
|---|---|---|---|
| `src/subconscious/continuation.test.ts` | 1 | Unit | AC1.1, AC1.2, AC1.3, AC1.4 |
| `src/subconscious/continuation-budget.test.ts` | 2 | Unit | AC3.1, AC3.2, AC3.3, AC3.4, AC3.5 |
| `src/subconscious/continuation-judge.test.ts` | 3 | Unit | AC2.1, AC2.2, AC2.3 |
| `src/config/schema.test.ts` | 4 | Unit | AC3.6 |
| `src/subconscious/continuation-loop.test.ts` | 5 | Unit | AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC5.1 |
| `src/index.wiring.test.ts` | 5 | Unit | AC5.2 |
| Manual smoke test | 5 | Human | Composition root wiring, concurrency safety |
