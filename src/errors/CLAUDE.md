# Errors Module

Last verified: 2026-05-16

Structured error hierarchy for Constellation. Cross-cutting concern consumed by all subsystems.

## Purpose

Replace raw Error throws with typed, traceable errors that carry subsystem context, machine-readable codes, and optional recovery suggestions.

## Contracts

### Exposes
- `ConstellationError` -- Base class. All subsystem errors extend this.
- `MemoryError`, `ModelError`, `PersistenceError`, `AgentError`, `ConfigError` -- Subsystem error classes
- `isConstellationError(e)` -- Type guard (works across realms)
- `wrapError(e, subsystem, code, context)` -- Wraps unknown caught values into ConstellationError
- `traceError(error, recorder, owner, conversationId)` -- Records error as operation trace (fire-and-forget)
- `sanitizeQuery(sql)` -- Strips literal values from SQL for safe logging

### Guarantees
- Every ConstellationError has: `code` (string), `subsystem` (string), `context` (Record), optional `suggestion`
- `toDisplayString()` produces `[subsystem:code] message` format
- `toJSON()` safely serializes context (unserializable values become strings or are dropped)
- `traceError` never throws -- recorder failures are caught and logged to console

### Expects
- Subsystem modules import their error type from here (canonical source)
- Domain `types.ts` files re-export error types for backward compatibility
- Catch blocks in agent loop call `traceError()` for ConstellationErrors

## Dependencies

- **Uses:** `@/reflexion/types.js` (TraceRecorder interface for trace.ts)
- **Used by:** `src/model/`, `src/memory/`, `src/persistence/`, `src/agent/`, `src/compaction/`, `src/rate-limit/`

## Invariants

- Error codes are string literals scoped per subsystem (e.g., `RATE_LIMITED`, `CONNECTION_FAILED`)
- Context must never contain secrets -- `sanitizeQuery` exists for SQL; callers responsible for other data
- `cause` chain preserved via standard `Error.cause` (ES2022)

## Key Decisions

- **Classes, not factory functions:** Errors are the one exception to the factory-function convention because `instanceof` checks and `Error.captureStackTrace` semantics require real inheritance.
- **Re-export migration:** Domain modules re-export from `src/errors/` rather than defining their own, keeping a single source of truth while preserving import paths.
