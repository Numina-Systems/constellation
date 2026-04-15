# Impulse Continuation — Human Test Plan

## Prerequisites
- PostgreSQL running with migrations applied (`bun run migrate`)
- `config.toml` with `[subconscious]` section: `enabled = true`, valid `inner_conversation_id`, `max_continuations_per_event = 2`, `max_continuations_per_cycle = 10`
- A model provider configured and accessible (for the continuation judge)
- `bun test` passing (150/150 tests green)
- `bun run build` passing (type-check confirms wiring correctness)

## Phase 1: Impulse Continuation Firing

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | Daemon starts, REPL available, subconscious system initialises with log message |
| 2 | Wait for the first impulse event to fire (controlled by `impulse_interval_minutes`) | Log shows impulse event processing, agent produces a response |
| 3 | After the impulse response, watch for continuation judge invocation | Log shows `[continuation] impulse continuation round (reason: ...)` if the judge decided to continue, OR the loop exits silently if the judge decided not to continue |
| 4 | If continuation fired, verify a second round produces a new agent response | Log shows another impulse event processed, followed by another judge evaluation |
| 5 | Verify continuation stops at the per-event limit (default 2) | After at most 2 continuation rounds, log shows the loop exiting regardless of judge decision |

## Phase 2: Budget Exhaustion and Wake Reset

| Step | Action | Expected |
|------|--------|----------|
| 1 | Allow multiple impulse events to fire across a wake cycle, tracking total continuation rounds in logs | Total continuation rounds across all events in the cycle does not exceed `max_continuations_per_cycle` (default 10) |
| 2 | Trigger a sleep transition (either wait for scheduled sleep or use the REPL) | Daemon enters sleep state, logs indicate sleep transition |
| 3 | Trigger a wake transition | Log shows budget reset. Continuation rounds can fire again on subsequent impulse events |
| 4 | Verify at least one continuation chain fires after the wake reset | Log shows `[continuation] impulse continuation round (reason: ...)` confirming budget was restored |

## Phase 3: Introspection Continuation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Wait for or trigger an introspection event (periodic review) | Log shows introspection event processing |
| 2 | Watch for continuation after introspection | Log shows `[continuation] introspection continuation round (reason: ...)` or the loop exits if the judge decided not to continue |
| 3 | If continuation fired, verify it assembles another introspection event (not an impulse) | The continuation round processes a review/introspection event, not an impulse event. Visible in log content and conversation context |

## End-to-End: Full Wake Cycle with Mixed Event Types

**Purpose:** Validate that impulse and introspection continuations share the same per-cycle budget and that the system behaves correctly across a complete wake cycle.

**Steps:**
1. Start daemon with `max_continuations_per_cycle = 5` (low value to make budget exhaustion observable)
2. Let impulse events fire with continuations until several budget slots are consumed
3. Trigger an introspection event and observe whether its continuation is limited by the remaining cycle budget
4. Once cycle budget is exhausted, verify no further continuations fire for either event type (budget check short-circuits)
5. Trigger a sleep/wake cycle
6. Verify continuations resume for both event types after wake

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| Composition root wiring (Phase 5, Tasks 4-7) | Imperative shell wiring connects tested components -- integration correctness requires observing live daemon behaviour | Start daemon, observe impulse continuation logs, verify wake reset restores budget, verify judge errors log but don't crash |
| Concurrency safety of introspection continuation | Race conditions between impulse and introspection handlers are non-deterministic and impractical to unit test | Trigger impulse and introspection events in close succession; observe no interleaved conversation state, no deadlocks, no unhandled promise rejections, both complete normally |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `continuation.test.ts` -- buildContinuationPrompt includes required content | -- |
| AC1.2 | `continuation.test.ts` -- parseContinuationResponse parses valid JSON | -- |
| AC1.3 | `continuation.test.ts` -- parseContinuationResponse handles malformed input | -- |
| AC1.4 | `continuation.test.ts` -- buildContinuationPrompt handles edge cases | -- |
| AC2.1 | `continuation-judge.test.ts` -- calls ModelProvider correctly | -- |
| AC2.2 | `continuation-judge.test.ts` -- handles model provider errors | -- |
| AC2.3 | `continuation-judge.test.ts` -- handles unparseable responses | -- |
| AC3.1 | `continuation-budget.test.ts` -- canContinue true when both remain | -- |
| AC3.2 | `continuation-budget.test.ts` -- false when per-event exhausted | -- |
| AC3.3 | `continuation-budget.test.ts` -- false when per-cycle exhausted | -- |
| AC3.4 | `continuation-budget.test.ts` -- resetEvent restores per-event only | -- |
| AC3.5 | `continuation-budget.test.ts` -- resetCycle restores both | -- |
| AC3.6 | `schema.test.ts` -- config validation with defaults and bounds | -- |
| AC4.1 | `continuation-loop.test.ts` -- judge called with correct context | -- |
| AC4.2 | `continuation-loop.test.ts` -- continuation round fires on shouldContinue: true | -- |
| AC4.3 | `continuation-loop.test.ts` -- chains up to per-event limit | -- |
| AC4.4 | `continuation-loop.test.ts` -- judge error doesn't throw | -- |
| AC4.5 | `continuation-loop.test.ts` -- housekeeping runs per round | -- |
| AC5.1 | `continuation-loop.test.ts` -- introspection eventType passed correctly | -- |
| AC5.2 | `index.wiring.test.ts` -- shared budget across event types | -- |
| Composition root wiring | Type-check (`bun run build`) | Phase 1 Steps 1-5, Phase 2 Steps 1-4 |
| Concurrency safety | -- | Phase 3 Step 1-3, End-to-End Steps 1-6 |
