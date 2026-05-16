# Structured Error Types Test Requirements

Generated from Acceptance Criteria in the design plan.

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| structured-error-types.AC1.1 | `ConstellationError` extends `Error` and is `instanceof Error` | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC1.2 | `ConstellationError` has `code`, `subsystem`, `context`, and optional `suggestion` | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC1.3 | `ConstellationError` preserves the original `message` and `stack` from `Error` | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC1.4 | `ConstellationError` supports `cause` chaining (wrapping an original error) | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC1.5 | Empty `context` object is valid | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC2.1 | `MemoryError` defines codes: `BLOCK_NOT_FOUND`, `PERMISSION_DENIED`, `MUTATION_REJECTED`, `EMBEDDING_FAILED` | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC2.2 | `MemoryError` with `BLOCK_NOT_FOUND` includes `available` labels in context | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC2.3 | `ModelError` defines codes: `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `CONTEXT_OVERFLOW`, `INVALID_RESPONSE`, `TIMEOUT` | unit | src/errors/model.test.ts | 2 |
| structured-error-types.AC2.4 | `ModelError` with `RATE_LIMITED` includes `retryAfter` in context | unit | src/errors/model.test.ts | 2 |
| structured-error-types.AC2.5 | `PersistenceError` defines codes: `CONNECTION_FAILED`, `MIGRATION_FAILED`, `QUERY_FAILED` | unit | src/errors/persistence.test.ts | 3 |
| structured-error-types.AC2.6 | `PersistenceError` with `QUERY_FAILED` includes sanitized query context (no parameter values) | unit | src/errors/persistence.test.ts | 3 |
| structured-error-types.AC2.7 | `AgentError` defines codes: `TOOL_DISPATCH_FAILED`, `COMPACTION_FAILED`, `RECALL_FAILED`, `CHECKPOINT_FAILED` | unit | src/errors/agent.test.ts | 3 |
| structured-error-types.AC2.8 | `ConfigError` defines codes: `VALIDATION_FAILED`, `MISSING_REQUIRED` | unit | src/errors/config.test.ts | 3 |
| structured-error-types.AC2.9 | `ConfigError` with `VALIDATION_FAILED` includes Zod error path in context | unit | src/errors/config.test.ts | 3 |
| structured-error-types.AC3.1 | `get*` / `load*` / `find*` functions return `T \| null` when target is not found | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC3.2 | `persist*` / `update*` / `delete*` functions throw typed error when target is not found | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC3.3 | Write functions that create new resources (insert) do not throw on "not found" | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC3.4 | A `get*` function does not throw for a missing resource — returns `null` | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC3.5 | `delete*` on a nonexistent target throws `BLOCK_NOT_FOUND` (or equivalent) with context identifying the target | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC4.1 | `.toDisplayString()` produces `[SUBSYSTEM:CODE] message` format | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC4.2 | `.toDisplayString()` appends suggestion if present | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC4.3 | `.toJSON()` produces structured object with `code`, `subsystem`, `message`, `context`, `suggestion`, `stack` | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC4.4 | `.toJSON()` omits `suggestion` when absent | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC4.5 | Context values that are not JSON-serializable are safely stringified or omitted | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC5.1 | Caught `ConstellationError` in agent loop is recorded via `TraceRecorder` with subsystem as tool name and code as operation | unit | src/errors/trace.test.ts | 4 |
| structured-error-types.AC5.2 | Trace output includes the display string and context | unit | src/errors/trace.test.ts | 4 |
| structured-error-types.AC5.3 | Errors that are caught and handled (not propagated) are still traced | unit | src/errors/trace.test.ts | 4 |
| structured-error-types.AC5.4 | Errors thrown outside the agent loop (e.g., during startup) are not traced | unit | src/errors/trace.test.ts | 4 |
| structured-error-types.AC6.1 | Existing `catch (error)` blocks that check `error instanceof Error` still match `ConstellationError` | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC6.2 | Existing `catch` blocks that read `error.message` get the human-readable message | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC6.3 | Code that doesn't use typed errors continues to work — adoption is opt-in | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC6.4 | Subsystem errors can be narrowed with `instanceof` checks | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC6.5 | Thrown plain `Error` objects in un-migrated code don't cause type mismatches at catch sites | unit | src/errors/base.test.ts | 1 |
| structured-error-types.AC7.1 | Each subsystem's errors can be adopted independently without touching other subsystems | unit | src/errors/memory.test.ts | 2 |
| structured-error-types.AC7.2 | Phase 1 (base + memory + model) delivers value without requiring all subsystems to migrate | unit | src/errors/model.test.ts | 2 |
| structured-error-types.AC7.3 | New error types are additive — existing error-throwing code is replaced one function at a time | unit | src/errors/base.test.ts | 1 |

## Human Verification Required

_No acceptance criteria require human verification. All are covered by automated tests._
