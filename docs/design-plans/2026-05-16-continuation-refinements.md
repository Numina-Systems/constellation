# Impulse Continuation Post-Merge Refinements

## Summary

The impulse continuation subsystem lets the agent decide, after completing an event-driven task, whether there is more worth exploring — and if so, to run additional rounds autonomously before going idle. This document covers four post-merge refinements to that subsystem. None of them change what the system does at runtime; they tighten how it is built: correcting a misclassified file, replacing brittle manual type casts with schema validation, making logging injectable so tests can assert on it, and adding an integration test that proves transaction boundaries hold under failure.

The approach is deliberately surgical — all four changes are independent of each other, confined to `src/subconscious/`, and follow patterns already established elsewhere in the codebase (Zod validation, optional log deps, factory functions, pattern annotations). The goal is a codebase that is easier to test and reason about, not a behaviour change.

## Definition of Done

Four targeted refinements to the impulse continuation subsystem that improve type safety, architectural consistency, and testability without changing runtime behaviour:

1. **Pattern annotation corrected** — `continuation-budget.ts` is reclassified from Imperative Shell to Functional Core, reflecting its zero-I/O stateful nature.

2. **Continuation response parsing uses Zod** — `parseContinuationResponse` replaces manual `as` casts with a Zod schema, centralising validation and decoupling LLM field names from domain types.

3. **Injectable logger in continuation loop** — `runContinuationLoop` accepts an optional `log` dependency (falling back to `console.log`), matching the pattern in `checkpoint-restore.ts` and enabling silent or assertable logging in tests.

4. **Transaction boundary verification test** — An integration test confirms that continuation rounds executed via `processEvent` produce traces with correct `conversationId` and ownership, and that mid-round failures leave no orphaned traces.

**Out of scope:** Budget priority/reservation tiers (v2), structured logger infrastructure, refactoring other subconscious modules to injectable logging.

## Acceptance Criteria

### continuation-refinements.AC1: Pattern annotation is correct
- **continuation-refinements.AC1.1 Success:** `continuation-budget.ts` line 1 reads `// pattern: Functional Core`
- **continuation-refinements.AC1.2 Success:** File has zero imports from I/O modules (no `pg`, no `fetch`, no `fs`)

### continuation-refinements.AC2: Continuation response parsing uses Zod
- **continuation-refinements.AC2.1 Success:** Valid `{ continue: true, reason: "..." }` returns `{ shouldContinue: true, reason: "..." }`
- **continuation-refinements.AC2.2 Success:** Valid response wrapped in markdown code fences parses correctly
- **continuation-refinements.AC2.3 Success:** Response with extra fields (e.g., `confidence: 0.9`) parses without error
- **continuation-refinements.AC2.4 Failure:** Missing `continue` field returns `{ shouldContinue: false, reason: 'Failed to parse...' }`
- **continuation-refinements.AC2.5 Failure:** Non-JSON string returns fallback without throwing
- **continuation-refinements.AC2.6 Failure:** `continue` field is string instead of boolean returns fallback
- **continuation-refinements.AC2.7 Edge:** Empty string input returns fallback without throwing

### continuation-refinements.AC3: Injectable logger in continuation loop
- **continuation-refinements.AC3.1 Success:** When `log` dep is provided, all log output goes through it (not console)
- **continuation-refinements.AC3.2 Success:** When `log` dep is omitted, falls back to `console.log`
- **continuation-refinements.AC3.3 Success:** Error catch block includes stack trace in logged message
- **continuation-refinements.AC3.4 Edge:** Logger receives `[continuation]` prefix in all messages

### continuation-refinements.AC4: Transaction boundary verification
- **continuation-refinements.AC4.1 Success:** Traces from multi-round continuation carry correct `conversationId`
- **continuation-refinements.AC4.2 Success:** Each continuation round is independently atomic
- **continuation-refinements.AC4.3 Failure:** Error thrown mid-round does not leave orphaned traces
- **continuation-refinements.AC4.4 Success:** Loop continues to next round after a single-round failure

## Glossary

- **Functional Core / Imperative Shell (FCIS)**: An architectural pattern that separates pure business logic (no I/O, deterministic) from code that performs side effects (database, network, file system). Files in this codebase declare which category they belong to on line 1.
- **Pattern annotation**: A `// pattern: Functional Core` or `// pattern: Imperative Shell` comment on line 1 of every source file, used to enforce FCIS boundaries during review.
- **Impulse continuation**: The mechanism by which the agent evaluates whether to run follow-up reasoning rounds after completing an event. Controlled by a budget manager that tracks round counts and enforces limits.
- **Continuation budget**: A stateful (but I/O-free) object that tracks how many continuation rounds have run and whether the agent is permitted to continue. Managed by `continuation-budget.ts`.
- **`processEvent`**: The entry point for dispatching an event through the subconscious pipeline. Continuation rounds run inside this call, nested within its transaction scope.
- **Zod**: A TypeScript-first schema validation library. Used here to parse and validate the LLM's JSON response deciding whether to continue, replacing manual `as` type casts.
- **`safeParse`**: Zod's non-throwing parse method. Returns a discriminated union (`{ success: true, data }` or `{ success: false, error }`) rather than throwing on invalid input.
- **Injectable dependency (log dep)**: A function passed into a module at call time rather than imported directly, allowing callers (including tests) to substitute their own implementation. Pattern: `readonly log?: (message: string) => void`.
- **Orphaned trace**: A database record written inside a failed transaction that was not rolled back — a consistency bug where a trace exists without a valid parent or owning round.
- **Atomic round**: Each continuation round commits or rolls back as a unit. If one round fails, prior rounds' data persists but the failed round leaves no partial writes.
- **Conversation ID (`conversationId`)**: The identifier linking traces to their originating conversation. Verified in the transaction boundary test to confirm correct parentage across multi-round continuation.
- **`assembleEvent`**: A pipeline step that prepares an event for processing before it reaches `processEvent`. Part of the unchanged data flow.

## Architecture

These are four independent, surgical changes to the existing `src/subconscious/` module. No new modules, no new dependencies (Zod is already in `package.json`), no changes to the public API of the continuation subsystem.

**Data flow unchanged:** Event → `assembleEvent` → `processEvent` → continuation decision → next round (or stop). The refinements affect internal classification, parsing robustness, and observability — not control flow.

## Existing Patterns

Investigation confirmed these existing patterns that the refinements follow:

- **Zod validation** — Used extensively in `src/config/schema.ts`, `src/agent/checkpoint-types.ts`, `src/mcp/schema.ts`, and `src/skill/parser.ts`. The continuation schema follows the same `z.object().safeParse()` pattern.
- **Optional log dependency** — `src/agent/checkpoint-restore.ts` uses `readonly log?: (message: string) => void` with `deps.log ?? console.log` fallback. Continuation loop adopts the identical interface.
- **Pattern annotations** — Every file in the project declares `// pattern: Functional Core` or `// pattern: Imperative Shell` on line 1. The budget manager's reclassification aligns it with the correct category (stateful, no I/O = Functional Core).
- **Factory functions** — `createContinuationBudget()` already follows the project's factory-over-class convention.

No divergence from existing patterns introduced.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Pattern Annotation and Zod Schema

**Goal:** Fix classification and replace manual type narrowing with validated parsing.

**Components:**
- `src/subconscious/continuation-budget.ts` — Change pattern annotation from `Imperative Shell` to `Functional Core`
- `src/subconscious/continuation.ts` — Add `ContinuationResponseSchema` (Zod), rewrite `parseContinuationResponse` to use `safeParse`, maintain identical return contract
- Existing unit tests in `src/subconscious/continuation.test.ts` — Must continue passing with no changes (behaviour preserved)

**Dependencies:** None (first phase)

**Done when:** `bun test` passes, `parseContinuationResponse` uses Zod internally, budget file annotation is `Functional Core`
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Injectable Logger

**Goal:** Add optional log dependency to continuation loop, matching checkpoint-restore pattern.

**Components:**
- `src/subconscious/continuation-loop.ts` — Add `readonly log?: (message: string) => void` to deps interface, replace `console.log`/`console.error` with `const log = deps.log ?? console.log`, include stack trace in error messages
- Existing tests for continuation loop — Update to pass mock logger, verify log output on error paths

**Dependencies:** None (independent of Phase 1)

**Done when:** `bun test` passes, continuation loop uses injectable logger, error cases include stack trace in log message
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Transaction Boundary Verification

**Goal:** Prove that continuation rounds produce correctly-parented traces and that failures don't orphan data.

**Components:**
- New integration test file `src/subconscious/continuation-transaction.test.ts` — Tests that:
  - Multi-round continuation writes traces with correct `conversationId`
  - A thrown error mid-continuation leaves no orphaned traces outside the transaction boundary
  - Each round is an independent atomic unit (no cross-round transaction leakage)

**Dependencies:** Phase 1 and Phase 2 (so the test exercises the final code shape)

**Done when:** Integration test passes, verifying trace parentage and atomicity per round
<!-- END_PHASE_3 -->

## Additional Considerations

**Error in log messages:** When the `log` function receives error information, the stack trace is inlined into the message string (`${error.message}\n${error.stack}`) rather than changing the logger signature. This keeps the interface identical to `checkpoint-restore.ts` and avoids a premature structured-logging abstraction.

**LLM response resilience:** The Zod schema uses default (non-strict) mode, meaning extra fields from LLM responses (e.g., `"confidence"`, `"thought"`) are silently ignored. This is intentional — strict mode would cause validation failures when models add unexpected fields.
