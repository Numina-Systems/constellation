# Human Test Plan: Structured Error Types

## Prerequisites
- Bun runtime installed
- `bun test src/errors/` passes (134 tests, 0 failures)
- Working tree at commit 5e124ba or later

## Phase 1: Base Error Class and Serialization

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/errors/base.ts`, verify `ConstellationError` class declaration | Class extends `Error`, constructor accepts `(message, code, subsystem, context, options?)` |
| 2 | Check that `name` property is set to `'ConstellationError'` in constructor | Ensures stack traces display the correct error name |
| 3 | Inspect `toJSON()` implementation for circular-reference handling | Should use try/catch around JSON.stringify or a replacer function |
| 4 | Verify `toDisplayString()` format matches `[subsystem:CODE] message` pattern exactly | No extra whitespace, colons and brackets positioned correctly |

## Phase 2: Subsystem Error Integration Readiness

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/memory/types.ts` (or equivalent barrel export) | Re-exports `MemoryError` from `@/errors/memory.js` |
| 2 | Open `src/model/types.ts` | Re-exports `ModelError` from `@/errors/model.js` |
| 3 | Run `bun run build` (tsc --noEmit) | Zero type errors -- proves error types integrate with existing code |
| 4 | Grep for `throw new Error(` in `src/memory/` and `src/model/` | Identify remaining un-migrated throw sites (informational, not blocking) |

## Phase 3: Trace Integration Wiring

| Step | Action | Expected |
|------|--------|----------|
| 1 | Search agent loop code (`src/agent/`) for `traceError` call sites | At least one catch block calls `traceError(error, recorder, owner, conversationId)` |
| 2 | Verify `traceError` is fire-and-forget (no `await` in catch block) | Function returns void, recorder failures logged to console but never thrown |
| 3 | Check that startup/config code does NOT call `traceError` | Validates AC5.4 architectural boundary in real code |

## End-to-End: Error Throw Through Trace Recording

**Purpose:** Validates that a structured error thrown in a subsystem flows through the agent loop catch block into the trace recorder.

**Steps:**
1. In `src/errors/trace.ts`, confirm `traceError` constructs an `OperationTrace` with `toolName = error.subsystem`, `success = false`, `outputSummary = error.toDisplayString()`
2. Confirm the trace record includes `input.errorCode`, `input.subsystem`, `input.context`
3. Verify truncation logic: outputSummary capped at 500 chars with `...` suffix
4. Confirm recorder rejection is caught (console.warn, no propagation)

## End-to-End: Incremental Adoption Safety

**Purpose:** Validates that adopting structured errors in one subsystem doesn't break others.

**Steps:**
1. Run `bun test` (full suite, not just `src/errors/`)
2. Verify no test failures outside `src/errors/` directory
3. Confirm no import changes needed in subsystems that haven't adopted structured errors yet
4. Check that `src/persistence/`, `src/agent/`, `src/config/` still compile with their existing error patterns

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| (none) | All criteria are automated | N/A |

The test-requirements document explicitly states "No acceptance criteria require human verification. All are covered by automated tests." The manual steps above provide defense-in-depth integration confidence beyond unit test coverage.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1-1.5 | base.test.ts | Phase 1, Step 1-2 |
| AC2.1-2.2 | memory.test.ts | Phase 2, Step 1 |
| AC2.3-2.4 | model.test.ts | Phase 2, Step 2 |
| AC2.5-2.6 | persistence.test.ts | Phase 2, Step 3 |
| AC2.7 | agent.test.ts | Phase 2, Step 3 |
| AC2.8-2.9 | config.test.ts | Phase 2, Step 3 |
| AC3.1-3.5 | read-write-convention.test.ts | Phase 2, Step 4 |
| AC4.1-4.5 | base.test.ts | Phase 1, Step 3-4 |
| AC5.1-5.4 | trace.test.ts | Phase 3, Steps 1-3 |
| AC6.1-6.5 | base.test.ts + adoption.test.ts + utils.test.ts | E2E: Incremental Adoption |
| AC7.1-7.3 | adoption.test.ts | E2E: Incremental Adoption |
