# Errors

Last verified: 2026-05-16

## Purpose
Provides a structured error hierarchy so all subsystems throw typed, traceable errors with consistent shape. Enables structured logging, trace recording, and actionable error messages.

## Contracts
- **Exposes**: `ConstellationError` (base class), subsystem errors (`MemoryError`, `ModelError`, `PersistenceError`, `AgentError`, `ConfigError`, `ShellError`), `isConstellationError(e)`, `wrapError(e, code, subsystem, context)`, `traceError(recorder, error, operation)`, `sanitizeQuery(sql)`
- **Guarantees**: All subsystem errors extend `ConstellationError` and carry `code` (string enum per subsystem), `subsystem` (identifier), `context` (serializable metadata), and optional `suggestion`. `toJSON()` safely serializes context (skipping unserializable values). `toDisplayString()` produces `[subsystem:code] message` format. `traceError()` records errors as operation traces fire-and-forget.
- **Expects**: Subsystem modules import their error class from here and throw it. Catch blocks use `traceError()` when a `TraceRecorder` is available. Domain `types.ts` files re-export error types for backward compatibility.

## Dependencies
- **Uses**: `src/reflexion/` (optional, `TraceRecorder` type for `traceError`)
- **Used by**: All domain modules (`src/agent/`, `src/persistence/`, `src/shell/`, `src/model/`, `src/memory/`, `src/config/`, `src/compaction/`, `src/rate-limit/`)
- **Boundary**: This module defines error types only. No business logic, no I/O (except trace recording which is fire-and-forget).

## Key Decisions
- Class hierarchy over union types: Enables `instanceof` checks and preserves stack traces via `Error.cause` chaining
- Per-subsystem error codes as string enums: Type-safe error matching without numeric magic constants
- `sanitizeQuery`: Strips query parameters from SQL before including in error context (prevents leaking sensitive data)

## Invariants
- All `ConstellationError` instances have non-empty `code` and `subsystem`
- `toJSON()` never throws (unserializable context values are stringified or skipped)
- `traceError()` never throws (fire-and-forget, swallows recorder failures)
- Error codes are string literals scoped per subsystem (e.g., `RATE_LIMITED`, `CONNECTION_FAILED`)
- Context must never contain secrets -- `sanitizeQuery` exists for SQL; callers responsible for other data
- `cause` chain preserved via standard `Error.cause` (ES2022)

## Key Files
- `base.ts` -- `ConstellationError` base class
- `utils.ts` -- `isConstellationError`, `wrapError` utilities
- `trace.ts` -- `traceError` integration with reflexion traces
- `agent.ts`, `config.ts`, `memory.ts`, `model.ts`, `persistence.ts`, `shell.ts` -- Subsystem error classes
