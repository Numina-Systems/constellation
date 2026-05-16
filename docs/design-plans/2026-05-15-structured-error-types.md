# Structured Error Types Design

## Summary

Constellation mostly throws generic `Error` objects or string messages. When something fails, debugging requires reading stack traces and guessing context — there's no programmatic way to distinguish between a rate limit and a connection failure, no structured context attached to errors, and no consistent guidance for the operator on what to do about it. Error handling is ad-hoc: some functions return `null` for missing data, some throw, some do both depending on the code path.

This feature introduces a unified error type hierarchy with rich diagnostics. A base `ConstellationError` class carries a string `code`, subsystem identifier, structured context, and an optional human-readable suggestion. Each subsystem defines its own error codes covering its failure modes. Read operations (`get*`) return `T | null` for missing data (not-found is not an error). Write operations (`persist*`, `update*`, `delete*`) throw typed errors when targets are missing (writing to nothing is an error). Errors format for both human display (`.toDisplayString()`) and structured logging (`.toJSON()`), and integrate with `TraceRecorder` for automatic trace recording.

The migration path is incremental — errors are introduced per subsystem starting with the highest-traffic paths (memory, model), and existing `catch` blocks continue to work because `ConstellationError` extends `Error`.

Ported from Pattern's unified error enum design, adapted for Constellation's TypeScript class hierarchy, factory-function conventions, and `TraceRecorder` integration.

## Definition of Done

1. A `ConstellationError` base class extends `Error` with `code`, `subsystem`, `context`, and `suggestion` fields.
2. Each subsystem has a typed error subclass with enumerated codes covering its failure modes.
3. Read vs write semantics are consistently applied: reads return `T | null`, writes throw typed errors.
4. Errors provide `.toDisplayString()` for human output and `.toJSON()` for structured logging.
5. Errors integrate with `TraceRecorder` — subsystem errors are automatically recorded as traces.
6. Existing `catch` blocks continue to work (`ConstellationError` is an `Error`).
7. Migration is incremental — subsystems adopt typed errors one at a time without a big-bang refactor.

## Acceptance Criteria

### structured-error-types.AC1: Base Error Type
- **structured-error-types.AC1.1 Success:** `ConstellationError` extends `Error` and is `instanceof Error`
- **structured-error-types.AC1.2 Success:** `ConstellationError` has `code` (string), `subsystem` (string), `context` (Record<string, unknown>), and optional `suggestion` (string)
- **structured-error-types.AC1.3 Success:** `ConstellationError` preserves the original `message` and `stack` from `Error`
- **structured-error-types.AC1.4 Success:** `ConstellationError` supports `cause` chaining (wrapping an original error)
- **structured-error-types.AC1.5 Edge:** Empty `context` object is valid (not all errors have extra context)

### structured-error-types.AC2: Subsystem Error Hierarchies
- **structured-error-types.AC2.1 Success:** `MemoryError` defines codes: `BLOCK_NOT_FOUND`, `PERMISSION_DENIED`, `MUTATION_REJECTED`, `EMBEDDING_FAILED`
- **structured-error-types.AC2.2 Success:** `MemoryError` with `BLOCK_NOT_FOUND` includes `available` labels in context for discoverability
- **structured-error-types.AC2.3 Success:** `ModelError` defines codes: `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `CONTEXT_OVERFLOW`, `INVALID_RESPONSE`, `TIMEOUT`
- **structured-error-types.AC2.4 Success:** `ModelError` with `RATE_LIMITED` includes `retryAfter` (seconds) in context
- **structured-error-types.AC2.5 Success:** `PersistenceError` defines codes: `CONNECTION_FAILED`, `MIGRATION_FAILED`, `QUERY_FAILED`
- **structured-error-types.AC2.6 Success:** `PersistenceError` with `QUERY_FAILED` includes sanitized query context (no parameter values, only query shape)
- **structured-error-types.AC2.7 Success:** `AgentError` defines codes: `TOOL_DISPATCH_FAILED`, `COMPACTION_FAILED`, `RECALL_FAILED`, `CHECKPOINT_FAILED`
- **structured-error-types.AC2.8 Success:** `ConfigError` defines codes: `VALIDATION_FAILED`, `MISSING_REQUIRED`
- **structured-error-types.AC2.9 Success:** `ConfigError` with `VALIDATION_FAILED` includes the Zod error path in context

### structured-error-types.AC3: Read vs Write Semantics
- **structured-error-types.AC3.1 Success:** `get*` / `load*` / `find*` functions return `T | null` when the target is not found
- **structured-error-types.AC3.2 Success:** `persist*` / `update*` / `delete*` functions throw a typed error when the target is not found
- **structured-error-types.AC3.3 Success:** Write functions that create new resources (insert) do not throw on "not found" (there's nothing to find)
- **structured-error-types.AC3.4 Failure:** A `get*` function does not throw for a missing resource — returns `null` instead
- **structured-error-types.AC3.5 Edge:** `delete*` on a nonexistent target throws `BLOCK_NOT_FOUND` (or equivalent) with context identifying the target

### structured-error-types.AC4: Display Formatting
- **structured-error-types.AC4.1 Success:** `.toDisplayString()` produces a human-readable single-line summary: `[SUBSYSTEM:CODE] message`
- **structured-error-types.AC4.2 Success:** `.toDisplayString()` appends `suggestion` if present: `[SUBSYSTEM:CODE] message — Suggestion: try X`
- **structured-error-types.AC4.3 Success:** `.toJSON()` produces a structured object with `code`, `subsystem`, `message`, `context`, `suggestion`, and `stack`
- **structured-error-types.AC4.4 Success:** `.toJSON()` omits `suggestion` when absent (no null or empty string)
- **structured-error-types.AC4.5 Edge:** Context values that are not JSON-serializable (e.g., functions, circular refs) are safely stringified or omitted

### structured-error-types.AC5: Trace Integration
- **structured-error-types.AC5.1 Success:** When a `ConstellationError` is caught in the agent loop, it is recorded via `TraceRecorder` with the subsystem as the tool name and the code as the operation
- **structured-error-types.AC5.2 Success:** Trace output includes the display string and context
- **structured-error-types.AC5.3 Success:** Errors that are caught and handled (not propagated) are still traced
- **structured-error-types.AC5.4 Edge:** Errors thrown outside the agent loop (e.g., during startup) are not traced (no TraceRecorder available yet)

### structured-error-types.AC6: Backward Compatibility
- **structured-error-types.AC6.1 Success:** Existing `catch (error)` blocks that check `error instanceof Error` still match `ConstellationError`
- **structured-error-types.AC6.2 Success:** Existing `catch` blocks that read `error.message` get the human-readable message
- **structured-error-types.AC6.3 Success:** Code that doesn't use typed errors continues to work — adoption is opt-in per call site
- **structured-error-types.AC6.4 Success:** Subsystem errors can be narrowed with `instanceof` checks: `if (error instanceof MemoryError)`
- **structured-error-types.AC6.5 Edge:** Thrown plain `Error` objects in un-migrated code don't cause type mismatches at catch sites

### structured-error-types.AC7: Incremental Adoption
- **structured-error-types.AC7.1 Success:** Each subsystem's errors can be adopted independently without touching other subsystems
- **structured-error-types.AC7.2 Success:** Phase 1 (base + memory + model) delivers value without requiring all subsystems to migrate
- **structured-error-types.AC7.3 Success:** New error types are additive — existing error-throwing code is replaced one function at a time

## Glossary

- **ConstellationError**: The base error class for all typed errors in the project. Extends native `Error` with structured fields.
- **Error code**: A string constant (e.g., `RATE_LIMITED`) identifying the specific failure mode within a subsystem. Used for programmatic error handling.
- **Subsystem**: The module that produced the error (e.g., `memory`, `model`, `persistence`, `agent`, `config`). Used for log grouping and trace recording.
- **Context**: A `Record<string, unknown>` carrying additional diagnostic data specific to the error — e.g., the missing block label, the retry-after duration, the Zod validation path.
- **Suggestion**: An optional human-readable string suggesting what the operator can do about the error — e.g., "Check that the model provider is configured and reachable."
- **Read vs write semantics**: Convention where read operations return `T | null` for missing data (absence is expected) and write operations throw for missing targets (writing to nothing is a bug).
- **Cause chaining**: The standard `Error.cause` property (ES2022) that allows wrapping an original error inside a new one, preserving the full error chain.
- **TraceRecorder**: Existing interface (`src/reflexion/types.ts`) for fire-and-forget operation tracing.

## Architecture

The error hierarchy is a shallow class tree: one base class and one subclass per subsystem. Each subclass defines its error codes as a string union type and provides a factory function for ergonomic construction.

### Hierarchy

```
Error (native)
└── ConstellationError
    ├── MemoryError        (codes: BLOCK_NOT_FOUND, PERMISSION_DENIED, ...)
    ├── ModelError          (codes: PROVIDER_UNAVAILABLE, RATE_LIMITED, ...)
    ├── PersistenceError    (codes: CONNECTION_FAILED, QUERY_FAILED, ...)
    ├── AgentError          (codes: TOOL_DISPATCH_FAILED, COMPACTION_FAILED, ...)
    └── ConfigError         (codes: VALIDATION_FAILED, MISSING_REQUIRED)
```

### Components

**ConstellationError** (`src/errors/base.ts`, Functional Core) — Base class extending `Error`. Constructor takes `message`, `code`, `subsystem`, `context`, optional `suggestion`, and optional `cause`. Implements `.toDisplayString()` and `.toJSON()`.

**Subsystem errors** (`src/errors/memory.ts`, `src/errors/model.ts`, etc., Functional Core) — Each file defines a subclass with its code union type and a convenience factory. Example:

```typescript
// src/errors/memory.ts

type MemoryErrorCode =
  | 'BLOCK_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MUTATION_REJECTED'
  | 'EMBEDDING_FAILED';

class MemoryError extends ConstellationError {
  constructor(
    code: MemoryErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'memory', context ?? {}, options);
  }
}
```

**Error utilities** (`src/errors/utils.ts`, Functional Core) — Helper functions:
- `isConstellationError(error: unknown): error is ConstellationError` — type guard
- `isSubsystemError<T>(error: unknown, subsystem: string): error is T` — narrowing by subsystem
- `wrapError(error: unknown, code: string, subsystem: string): ConstellationError` — wraps unknown errors in a ConstellationError with the original as `cause`

**Trace integration** (`src/errors/trace.ts`, Imperative Shell) — `traceError(error: ConstellationError, recorder: TraceRecorder)` records the error as a trace with the subsystem as tool name and code as operation.

**Barrel export** (`src/errors/index.ts`) — Re-exports all error types, utilities, and the trace helper.

### Contracts

```typescript
// src/errors/base.ts

class ConstellationError extends Error {
  readonly code: string;
  readonly subsystem: string;
  readonly context: Record<string, unknown>;
  readonly suggestion: string | undefined;

  constructor(
    message: string,
    code: string,
    subsystem: string,
    context: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  );

  toDisplayString(): string;
  toJSON(): Record<string, unknown>;
}
```

```typescript
// src/errors/model.ts

type ModelErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT';

class ModelError extends ConstellationError {
  constructor(
    code: ModelErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  );
}
```

```typescript
// src/errors/persistence.ts

type PersistenceErrorCode =
  | 'CONNECTION_FAILED'
  | 'MIGRATION_FAILED'
  | 'QUERY_FAILED';

class PersistenceError extends ConstellationError {
  constructor(
    code: PersistenceErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  );
}
```

```typescript
// src/errors/agent.ts

type AgentErrorCode =
  | 'TOOL_DISPATCH_FAILED'
  | 'COMPACTION_FAILED'
  | 'RECALL_FAILED'
  | 'CHECKPOINT_FAILED';

class AgentError extends ConstellationError {
  constructor(
    code: AgentErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  );
}
```

```typescript
// src/errors/config.ts

type ConfigErrorCode =
  | 'VALIDATION_FAILED'
  | 'MISSING_REQUIRED';

class ConfigError extends ConstellationError {
  constructor(
    code: ConfigErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  );
}
```

```typescript
// src/errors/utils.ts

function isConstellationError(error: unknown): error is ConstellationError;
function wrapError(
  error: unknown,
  code: string,
  subsystem: string,
  context?: Record<string, unknown>,
): ConstellationError;
```

```typescript
// src/errors/trace.ts

function traceError(
  error: ConstellationError,
  recorder: TraceRecorder,
): void;
```

### Read vs Write Convention

This is a codebase-wide convention, not a runtime enforcement mechanism:

| Operation prefix | Missing target behavior | Rationale |
|-----------------|------------------------|-----------|
| `get*`, `load*`, `find*` | Return `T \| null` | Absence is a valid query result |
| `persist*`, `save*` (insert) | Do not throw for "not found" | Creating new resources |
| `update*` | Throw typed error | Updating nothing is a logic bug |
| `delete*` | Throw typed error | Deleting nothing is a logic bug |

This convention is documented in the base error module and enforced through code review, not runtime checks. Existing functions are migrated incrementally as subsystems adopt typed errors.

### Display Format Examples

```
// .toDisplayString()
[memory:BLOCK_NOT_FOUND] Block "daily-summary" not found — Suggestion: available blocks: status, goals, personality
[model:RATE_LIMITED] Anthropic rate limit exceeded, retry after 30s
[persistence:QUERY_FAILED] Failed to persist message — Suggestion: check database connectivity

// .toJSON()
{
  "code": "RATE_LIMITED",
  "subsystem": "model",
  "message": "Anthropic rate limit exceeded, retry after 30s",
  "context": { "provider": "anthropic", "retryAfter": 30 },
  "suggestion": "Request will be retried automatically",
  "stack": "ModelError: Anthropic rate limit...\n    at ..."
}
```

## Existing Patterns

- **Error handling in model adapters** — `src/model/` adapters currently throw generic `Error` or SDK-specific errors. These are the first migration targets for `ModelError`.
- **Memory block operations** — `src/memory/` and `src/persistence/` mix `null` returns and throws inconsistently. Typed errors with read/write semantics will standardize this.
- **TraceRecorder** — `src/reflexion/types.ts` defines fire-and-forget trace recording. Error traces follow the same pattern.
- **Zod validation errors** — `src/config/` already uses Zod for config validation. `ConfigError` with `VALIDATION_FAILED` wraps Zod errors with the path context.
- **`callWithRetry`** — `src/model/retry.ts` currently checks error messages to determine retryability. `ModelError` codes make this check programmatic (`code === 'RATE_LIMITED'` instead of `message.includes('rate')`).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Base Error Type and Utilities

**Goal:** Implement the `ConstellationError` base class, type guards, and formatting methods.

**Components:**
- `src/errors/base.ts` (Functional Core) — `ConstellationError` class with `code`, `subsystem`, `context`, `suggestion`, `cause` chaining, `.toDisplayString()`, `.toJSON()`
- `src/errors/utils.ts` (Functional Core) — `isConstellationError()` type guard, `wrapError()` helper
- `src/errors/index.ts` — Barrel exports
- `src/errors/base.test.ts` — Unit tests: instanceof Error, message/stack preservation, cause chaining, toDisplayString format (with and without suggestion), toJSON structure (omits suggestion when absent), context with non-serializable values handled safely

**Dependencies:** None

**Covers:** structured-error-types.AC1 (base error type), structured-error-types.AC4 (display formatting), structured-error-types.AC6.1-6.2 (backward compatibility with Error)

**Done when:** `ConstellationError` is `instanceof Error`, formats correctly for display and JSON, chains causes, handles edge cases. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Memory and Model Error Types

**Goal:** Define error subclasses for the two highest-traffic subsystems and migrate their primary error sites.

**Components:**
- `src/errors/memory.ts` (Functional Core) — `MemoryError` class with `MemoryErrorCode` union
- `src/errors/model.ts` (Functional Core) — `ModelError` class with `ModelErrorCode` union
- `src/errors/memory.test.ts` — Unit tests: each code constructs correctly, BLOCK_NOT_FOUND includes available labels in context, instanceof checks (MemoryError, ConstellationError, Error)
- `src/errors/model.test.ts` — Unit tests: each code constructs correctly, RATE_LIMITED includes retryAfter in context, TIMEOUT includes duration in context
- `src/memory/` — Migrate primary `throw new Error(...)` sites to `throw new MemoryError(...)` in block update/delete operations. Read operations return `null`.
- `src/model/` — Migrate primary error sites in adapters: rate limit detection, timeout, connection failure. Update `callWithRetry` to check `ModelError` codes for retryability.

**Dependencies:** Phase 1

**Covers:** structured-error-types.AC2.1-2.4 (memory and model hierarchies), structured-error-types.AC3 (read vs write semantics), structured-error-types.AC7 (incremental adoption)

**Done when:** Memory and model subsystems throw typed errors for their primary failure modes. Read operations return `null`. `callWithRetry` uses error codes for retryability. Existing tests still pass. All new tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Persistence, Agent, and Config Error Types

**Goal:** Define error subclasses for remaining subsystems.

**Components:**
- `src/errors/persistence.ts` (Functional Core) — `PersistenceError` class with `PersistenceErrorCode` union
- `src/errors/agent.ts` (Functional Core) — `AgentError` class with `AgentErrorCode` union
- `src/errors/config.ts` (Functional Core) — `ConfigError` class with `ConfigErrorCode` union
- `src/errors/persistence.test.ts` — Unit tests: QUERY_FAILED includes sanitized query in context (no parameter values)
- `src/errors/agent.test.ts` — Unit tests: each code constructs correctly
- `src/errors/config.test.ts` — Unit tests: VALIDATION_FAILED includes Zod path in context
- Update barrel exports in `src/errors/index.ts`

**Dependencies:** Phase 1

**Covers:** structured-error-types.AC2.5-2.9 (remaining hierarchies)

**Done when:** All subsystem error types are defined with their codes, tested, and exported. No migration of call sites yet (that happens incrementally in follow-up work). All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Trace Integration and Agent Loop Wiring

**Goal:** Integrate error tracing into the agent loop so caught `ConstellationError` instances are automatically recorded.

**Components:**
- `src/errors/trace.ts` (Imperative Shell) — `traceError()` function that records a `ConstellationError` via `TraceRecorder`
- `src/agent/agent.ts` — In the main error handling paths (tool dispatch catch, compaction catch, recall catch), check for `ConstellationError` and call `traceError()`. Wrap unknown errors via `wrapError()` before tracing.
- `src/errors/trace.test.ts` — Unit tests: trace recorded with correct tool name (subsystem), operation (code), output (display string), and success=false

**Dependencies:** Phases 1, 2, 3

**Covers:** structured-error-types.AC5 (trace integration)

**Done when:** `ConstellationError` instances caught in the agent loop are automatically traced. Unknown errors are wrapped before tracing. Trace output includes subsystem, code, and display string. Build succeeds (`bun run build`). All tests pass.
<!-- END_PHASE_4 -->

## Additional Considerations

**Why classes, not factory functions?** This is the one place where classes are justified over factory functions. `instanceof` checks are the idiomatic TypeScript way to narrow error types in catch blocks, and they require a class hierarchy. The `createFoo()` convention applies to service objects, not to error types.

**Query sanitization in PersistenceError.** The `QUERY_FAILED` context should include the query shape (e.g., `"INSERT INTO messages ..."`) but never parameter values, which may contain user content or secrets. The sanitization strips `$1`, `$2`, etc. placeholders and their bound values.

**Suggestion quality.** Suggestions should be actionable and specific. "An error occurred" is not a suggestion. "Check that the ANTHROPIC_API_KEY environment variable is set and the key is valid" is. Each error code should have a default suggestion that can be overridden at the throw site.

**Migration velocity.** The incremental approach means the codebase will have a mix of typed and untyped errors for a while. This is acceptable — the typed errors deliver value immediately in the subsystems that adopt them, and the `wrapError()` utility bridges the gap at catch sites that handle both.

**Error codes as string unions, not enums.** TypeScript enums have known pitfalls (runtime objects, no exhaustiveness checking in some cases). String union types are lighter, tree-shakeable, and provide the same type safety at catch sites.
