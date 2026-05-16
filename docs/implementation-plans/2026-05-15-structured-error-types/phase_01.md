# Structured Error Types Implementation Plan

**Goal:** Implement the `ConstellationError` base class, type guards, wrapping utility, and display formatting methods.

**Architecture:** Functional Core module providing the error base class and pure utility functions. No side effects, no I/O. All subsystem error types will extend this base in later phases.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 1 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### structured-error-types.AC1: Base Error Type
- **structured-error-types.AC1.1 Success:** `ConstellationError` extends `Error` and is `instanceof Error`
- **structured-error-types.AC1.2 Success:** `ConstellationError` has `code` (string), `subsystem` (string), `context` (Record<string, unknown>), and optional `suggestion` (string)
- **structured-error-types.AC1.3 Success:** `ConstellationError` preserves the original `message` and `stack` from `Error`
- **structured-error-types.AC1.4 Success:** `ConstellationError` supports `cause` chaining (wrapping an original error)
- **structured-error-types.AC1.5 Edge:** Empty `context` object is valid (not all errors have extra context)

### structured-error-types.AC4: Display Formatting
- **structured-error-types.AC4.1 Success:** `.toDisplayString()` produces a human-readable single-line summary: `[SUBSYSTEM:CODE] message`
- **structured-error-types.AC4.2 Success:** `.toDisplayString()` appends `suggestion` if present: `[SUBSYSTEM:CODE] message — Suggestion: try X`
- **structured-error-types.AC4.3 Success:** `.toJSON()` produces a structured object with `code`, `subsystem`, `message`, `context`, `suggestion`, and `stack`
- **structured-error-types.AC4.4 Success:** `.toJSON()` omits `suggestion` when absent (no null or empty string)
- **structured-error-types.AC4.5 Edge:** Context values that are not JSON-serializable (e.g., functions, circular refs) are safely stringified or omitted

### structured-error-types.AC6: Backward Compatibility (partial)
- **structured-error-types.AC6.1 Success:** Existing `catch (error)` blocks that check `error instanceof Error` still match `ConstellationError`
- **structured-error-types.AC6.2 Success:** Existing `catch` blocks that read `error.message` get the human-readable message

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: ConstellationError base class

**Verifies:** structured-error-types.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC6.1, AC6.2

**Files:**
- Create: `src/errors/base.ts`
- Test: `src/errors/base.test.ts`

**Implementation:**

Create `src/errors/base.ts`:

```typescript
// pattern: Functional Core

export class ConstellationError extends Error {
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
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ConstellationError';
    this.code = code;
    this.subsystem = subsystem;
    this.context = context;
    this.suggestion = options?.suggestion;
  }

  toDisplayString(): string {
    const base = `[${this.subsystem}:${this.code}] ${this.message}`;
    if (this.suggestion) {
      return `${base} — Suggestion: ${this.suggestion}`;
    }
    return base;
  }

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      code: this.code,
      subsystem: this.subsystem,
      message: this.message,
      context: safeSerializeContext(this.context),
      stack: this.stack,
    };
    if (this.suggestion !== undefined) {
      result.suggestion = this.suggestion;
    }
    return result;
  }
}
```

The `safeSerializeContext` function handles non-serializable values in the context object. It iterates over each key-value pair and attempts `JSON.stringify` on the value. If that throws (circular references, BigInt, etc.), it falls back to `String(value)`. If even that fails, it omits the key. This is a module-private helper, not exported:

```typescript
function safeSerializeContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    try {
      JSON.stringify(value);
      result[key] = value;
    } catch {
      try {
        result[key] = String(value);
      } catch {
        // Skip entirely unserializable values
      }
    }
  }
  return result;
}
```

**Testing:**

Create `src/errors/base.test.ts` with the following test cases:

1. **AC1.1:** `ConstellationError` is `instanceof Error` and `instanceof ConstellationError`
2. **AC1.2:** Constructor sets `code`, `subsystem`, `context`, and `suggestion` fields correctly
3. **AC1.3:** `message` and `stack` are preserved from the `Error` base class
4. **AC1.4:** Passing `{ cause: originalError }` sets `error.cause` to the original error
5. **AC1.5:** Empty context `{}` is valid — no error on construction, `.toJSON()` includes `context: {}`
6. **AC4.1:** `.toDisplayString()` without suggestion returns `[subsystem:CODE] message`
7. **AC4.2:** `.toDisplayString()` with suggestion returns `[subsystem:CODE] message — Suggestion: try X`
8. **AC4.3:** `.toJSON()` returns object with all expected keys (`code`, `subsystem`, `message`, `context`, `stack`)
9. **AC4.4:** `.toJSON()` omits `suggestion` key entirely when no suggestion provided (verify `'suggestion' in result` is `false`)
10. **AC4.5:** Context with a circular reference is safely serialized (value replaced with string representation)
11. **AC4.5:** Context with a function value is safely serialized (function stringified or omitted)
12. **AC6.1:** A `catch (error)` with `error instanceof Error` matches `ConstellationError`
13. **AC6.2:** `error.message` returns the human-readable message string

Mock pattern: No mocks needed — `ConstellationError` is pure construction and formatting.

**Verification:**
Run: `bun test src/errors/base.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(errors): add ConstellationError base class with display formatting`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Error utilities

**Verifies:** structured-error-types.AC1.4 (cause chaining via wrapError), AC6.1 (type guard)

**Files:**
- Create: `src/errors/utils.ts`
- Test: `src/errors/utils.test.ts`

**Implementation:**

Create `src/errors/utils.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export function isConstellationError(
  error: unknown,
): error is ConstellationError {
  return error instanceof ConstellationError;
}

export function wrapError(
  error: unknown,
  code: string,
  subsystem: string,
  context?: Record<string, unknown>,
): ConstellationError {
  const cause = error instanceof Error ? error : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  return new ConstellationError(message, code, subsystem, context ?? {}, {
    cause,
  });
}
```

`isConstellationError` is a type guard for use at catch sites that need to narrow before accessing `.code` or `.subsystem`.

**Note:** `isSubsystemError<T>()` from the design plan is intentionally omitted. `instanceof` checks on subsystem error classes (e.g., `error instanceof MemoryError`) provide the same narrowing capability with simpler code.

`wrapError` wraps an unknown caught value into a `ConstellationError` with cause chaining. If the caught value is an `Error`, it becomes the `cause` and its `message` is preserved. If it's a string, that string becomes the message. Otherwise, the message defaults to `'Unknown error'`.

**Testing:**

Create `src/errors/utils.test.ts`:

1. `isConstellationError` returns `true` for a `ConstellationError` instance
2. `isConstellationError` returns `false` for a plain `Error`
3. `isConstellationError` returns `false` for `null`, `undefined`, a string, and a number
4. `wrapError` given an `Error` preserves its message and sets it as `cause`
5. `wrapError` given a string uses that string as the message
6. `wrapError` given a non-Error, non-string value (e.g., `42`) uses `'Unknown error'` as message
7. `wrapError` sets the provided `code`, `subsystem`, and `context` on the resulting `ConstellationError`
8. `wrapError` with no `context` argument produces `context: {}`
9. **AC6.5:** Catching a mix of plain `Error` and `ConstellationError` in the same catch block works without type issues — verify that a catch block receiving `unknown` can use `instanceof` narrowing to distinguish `ConstellationError` from plain `Error`, accessing `.code` and `.subsystem` only after narrowing

**Verification:**
Run: `bun test src/errors/utils.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add isConstellationError guard and wrapError utility`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/errors/index.ts`

**Implementation:**

```typescript
// pattern: Functional Core (barrel export)

export { ConstellationError } from './base.js';
export { isConstellationError, wrapError } from './utils.js';
```

This barrel will be extended in subsequent phases as subsystem error types and the trace helper are added.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(errors): add barrel export`
<!-- END_TASK_3 -->
