# Structured Error Types Implementation Plan

**Goal:** Define error subclasses for the two highest-traffic subsystems (memory and model) and migrate their primary throw sites.

**Architecture:** Functional Core error types extending `ConstellationError`. Memory errors cover block operations; model errors replace the existing `ModelError` class in `src/model/types.ts`. Migration of throw sites is targeted — only the primary error paths are converted, not exhaustive.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 2 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### structured-error-types.AC2: Subsystem Error Hierarchies (memory and model)
- **structured-error-types.AC2.1 Success:** `MemoryError` defines codes: `BLOCK_NOT_FOUND`, `PERMISSION_DENIED`, `MUTATION_REJECTED`, `MUTATION_NOT_FOUND`, `EMBEDDING_FAILED`
- **structured-error-types.AC2.2 Success:** `MemoryError` with `BLOCK_NOT_FOUND` includes `available` labels in context for discoverability
- **structured-error-types.AC2.3 Success:** `ModelError` defines codes: `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `CONTEXT_OVERFLOW`, `INVALID_RESPONSE`, `TIMEOUT`
- **structured-error-types.AC2.4 Success:** `ModelError` with `RATE_LIMITED` includes `retryAfter` (seconds) in context

### structured-error-types.AC3: Read vs Write Semantics
- **structured-error-types.AC3.1 Success:** `get*` / `load*` / `find*` functions return `T | null` when the target is not found
- **structured-error-types.AC3.2 Success:** `persist*` / `update*` / `delete*` functions throw a typed error when the target is not found
- **structured-error-types.AC3.3 Success:** Write functions that create new resources (insert) do not throw on "not found" (there's nothing to find)
- **structured-error-types.AC3.4 Failure:** A `get*` function does not throw for a missing resource — returns `null` instead
- **structured-error-types.AC3.5 Edge:** `delete*` on a nonexistent target throws `BLOCK_NOT_FOUND` (or equivalent) with context identifying the target

### structured-error-types.AC6: Backward Compatibility (continued)
- **structured-error-types.AC6.4 Success:** Subsystem errors can be narrowed with `instanceof` checks: `if (error instanceof MemoryError)`

### structured-error-types.AC7: Incremental Adoption
- **structured-error-types.AC7.1 Success:** Each subsystem's errors can be adopted independently without touching other subsystems
- **structured-error-types.AC7.2 Success:** Phase 1 (base + memory + model) delivers value without requiring all subsystems to migrate
- **structured-error-types.AC7.3 Success:** New error types are additive — existing error-throwing code is replaced one function at a time

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: MemoryError type

**Verifies:** structured-error-types.AC2.1, AC2.2, AC6.4

**Files:**
- Create: `src/errors/memory.ts`
- Test: `src/errors/memory.test.ts`

**Implementation:**

Create `src/errors/memory.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type MemoryErrorCode =
  | 'BLOCK_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MUTATION_REJECTED'
  | 'MUTATION_NOT_FOUND'
  | 'EMBEDDING_FAILED';

export class MemoryError extends ConstellationError {
  constructor(
    code: MemoryErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'memory', context ?? {}, options);
    this.name = 'MemoryError';
  }
}
```

**Testing:**

Create `src/errors/memory.test.ts`:

1. **AC2.1:** Each `MemoryErrorCode` constructs a valid `MemoryError` — test all five codes
2. **AC2.2:** `BLOCK_NOT_FOUND` with `{ available: ['status', 'goals', 'personality'] }` in context — verify context includes the `available` array
3. **AC6.4:** `MemoryError` is `instanceof MemoryError`, `instanceof ConstellationError`, and `instanceof Error`
4. `MemoryError` `.toDisplayString()` formats as `[memory:BLOCK_NOT_FOUND] ...`
5. `MemoryError` with suggestion formats correctly via inherited `.toDisplayString()`
6. Default context is `{}` when no context argument provided

**Verification:**
Run: `bun test src/errors/memory.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add MemoryError type with block and permission codes`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ModelError type (new, replaces existing)

**Verifies:** structured-error-types.AC2.3, AC2.4, AC6.4

**Files:**
- Create: `src/errors/model.ts`
- Test: `src/errors/model.test.ts`

**Implementation:**

Create `src/errors/model.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type ModelErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT';

export class ModelError extends ConstellationError {
  readonly retryable: boolean;

  constructor(
    code: ModelErrorCode,
    message: string,
    retryable: boolean = false,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'model', context ?? {}, options);
    this.name = 'ModelError';
    this.retryable = retryable;
  }
}
```

The `retryable` field is preserved from the existing `ModelError` in `src/model/types.ts` (lines 110-119). The new class extends `ConstellationError` instead of plain `Error`, expands the code union from 4 values (`auth`, `rate_limit`, `timeout`, `api_error`) to the design's 5 (`PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `CONTEXT_OVERFLOW`, `INVALID_RESPONSE`, `TIMEOUT`), and adds structured `context` and `suggestion` support.

**CRITICAL:** This is a NEW file at `src/errors/model.ts`. The existing `ModelError` class in `src/model/types.ts` is NOT removed or modified in this task. Task 4 handles the migration of `src/model/types.ts` and all its consumers.

**Testing:**

Create `src/errors/model.test.ts`:

1. **AC2.3:** Each `ModelErrorCode` constructs a valid `ModelError` — test all five codes
2. **AC2.4:** `RATE_LIMITED` with `{ retryAfter: 30, provider: 'anthropic' }` in context — verify context includes `retryAfter`
3. **AC6.4:** `ModelError` is `instanceof ModelError`, `instanceof ConstellationError`, and `instanceof Error`
4. `retryable` field defaults to `false` when not provided
5. `retryable: true` is preserved and accessible
6. `.toDisplayString()` formats as `[model:RATE_LIMITED] ...`
7. `.toJSON()` includes the standard fields from `ConstellationError`

**Verification:**
Run: `bun test src/errors/model.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add ModelError type with retryable flag and expanded codes`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/errors/index.ts`

**Implementation:**

Add exports for the new error types:

```typescript
export { MemoryError } from './memory.js';
export type { MemoryErrorCode } from './memory.js';
export { ModelError } from './model.js';
export type { ModelErrorCode } from './model.js';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(errors): export memory and model error types`
<!-- END_TASK_3 -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Migrate existing ModelError in src/model/

**Verifies:** structured-error-types.AC7.1, AC7.3

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/retry.ts`
- Modify: `src/model/anthropic.ts` (~8 `new ModelError(` call sites)
- Modify: `src/model/ollama.ts` (~8 call sites)
- Modify: `src/model/openai-compat.ts` (~8 call sites)
- Modify: `src/model/openrouter.ts` (check for additional call sites)

**Implementation:**

This is the critical migration step. The existing `ModelError` class at `src/model/types.ts:110-119` must be replaced with a re-export from `src/errors/model.ts`.

**Step 1: Update `src/model/types.ts`**

Remove the existing `ModelError` class and `ModelErrorCode` type (lines 108-119):

```typescript
// REMOVE:
export type ModelErrorCode = "auth" | "rate_limit" | "timeout" | "api_error";

export class ModelError extends Error {
  constructor(
    public code: ModelErrorCode,
    public retryable: boolean = false,
    message: string = ""
  ) {
    super(message);
    this.name = "ModelError";
  }
}
```

Replace with a re-export from the new errors module:

```typescript
export { ModelError } from '@/errors/model.js';
export type { ModelErrorCode } from '@/errors/model.js';
```

This preserves backward compatibility — any file that imports `ModelError` from `@/model/types.js` or `@/model/index.js` continues to get the class, just the new one.

**Step 2: Update model adapter throw sites**

Each adapter currently constructs `ModelError` with the OLD signature: `new ModelError(code, retryable, message)`. The NEW signature is: `new ModelError(code, message, retryable, context?, options?)` — note that `retryable` is the third argument (moved after `message`), and it remains a direct property on the class (not moved into `context`).

Search all `.ts` files in `src/model/` for `new ModelError(` and update each call site. The code mappings are:

| Old code | New code |
|----------|----------|
| `'auth'` | `'PROVIDER_UNAVAILABLE'` |
| `'rate_limit'` | `'RATE_LIMITED'` |
| `'timeout'` | `'TIMEOUT'` |
| `'api_error'` | `'INVALID_RESPONSE'` |

Example transformation:

```typescript
// BEFORE:
throw new ModelError('rate_limit', true, 'Rate limit exceeded');

// AFTER:
throw new ModelError('RATE_LIMITED', 'Rate limit exceeded', true, {
  provider: 'anthropic',
});
```

Add `context` with the provider name at each throw site where it's available.

**Step 3: Update `src/model/retry.ts`**

The `callWithRetry` function itself doesn't need changes — it uses a predicate `isRetryableError` passed by each adapter. But each adapter's `isRetryableError` implementation may check `error.code` against old code values. Update those predicates to use the new codes:

```typescript
// BEFORE (in adapter):
const isRetryableError = (error: unknown) =>
  error instanceof ModelError && error.retryable;

// AFTER (same — retryable field still works):
const isRetryableError = (error: unknown) =>
  error instanceof ModelError && error.retryable;
```

The `retryable` field is preserved on the new `ModelError`, so predicates that check `.retryable` work without changes. Only predicates that check `.code === 'rate_limit'` (string comparison against old codes) need updating.

**Verification:**
Run: `bun run build`
Expected: Type-check passes — no type errors from the code mapping changes

Run: `bun test`
Expected: All existing model tests pass with the new error class

**Commit:** `refactor(model): migrate ModelError to extend ConstellationError`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Migrate primary memory throw sites

**Verifies:** structured-error-types.AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC7.3

**Files:**
- Modify: `src/memory/postgres-store.ts`

**Implementation:**

The memory store has two categories of operations that need attention:

**Read operations (NO changes needed — already correct):**
- `getBlock(id)` — returns `MemoryBlock | null` (line ~70)
- `getBlockByLabel(owner, label)` — returns `MemoryBlock | null`
- `getBlocksByTier(owner, tier)` — returns `Array<MemoryBlock>`

These already follow the read convention (return `null` for missing). Do NOT change them to throw.

**Write operations (migrate to MemoryError):**

1. `updateBlock()` at `src/memory/postgres-store.ts:182-184`:

```typescript
// BEFORE:
if (rows.length === 0) {
  throw new Error(`block not found: ${id}`);
}

// AFTER:
if (rows.length === 0) {
  throw new MemoryError(
    'BLOCK_NOT_FOUND',
    `Block not found: ${id}`,
    { blockId: id },
    { suggestion: 'Verify the block ID exists before updating' },
  );
}
```

2. `updateBlockTier()` at `src/memory/postgres-store.ts:200-204`:

```typescript
// BEFORE:
if (rows.length === 0) {
  throw new Error(`block not found: ${id}`);
}

// AFTER:
if (rows.length === 0) {
  throw new MemoryError(
    'BLOCK_NOT_FOUND',
    `Block not found: ${id}`,
    { blockId: id, targetTier: tier },
    { suggestion: 'Verify the block ID exists before changing tier' },
  );
}
```

3. `deleteBlock()` at `src/memory/postgres-store.ts:209-211` — currently idempotent (no error if missing). Per AC3.5, delete on a nonexistent target should throw. Update to check the result:

```typescript
// BEFORE:
async function deleteBlock(id: string): Promise<void> {
  await persistence.query('DELETE FROM memory_blocks WHERE id = $1', [id]);
}

// AFTER:
async function deleteBlock(id: string): Promise<void> {
  const result = await persistence.query(
    'DELETE FROM memory_blocks WHERE id = $1 RETURNING id',
    [id],
  );
  if (result.length === 0) {
    throw new MemoryError(
      'BLOCK_NOT_FOUND',
      `Block not found: ${id}`,
      { blockId: id },
      { suggestion: 'Verify the block ID exists before deleting' },
    );
  }
}
```

**IMPORTANT:** The `BLOCK_NOT_FOUND` context should include `available` labels when feasible (per AC2.2). However, the `postgres-store.ts` functions operate on block IDs, not labels — querying available labels would require an additional DB call inside the error path. For these low-level store functions, include only the `blockId` in context. The `available` labels context is more appropriate at the `MemoryManager` level (e.g., `manager.ts` where the label-based lookup happens) and should be wired in follow-up incremental adoption.

4. `resolveMutation()` at `src/memory/postgres-store.ts:310`:

```typescript
// BEFORE:
throw new Error('mutation not found: ${id}');

// AFTER:
throw new MemoryError(
  'MUTATION_NOT_FOUND',
  `Mutation not found: ${id}`,
  { mutationId: id },
  { suggestion: 'Verify the mutation ID exists before resolving' },
);
```

This is a write operation (resolving/completing a mutation) and should throw a typed error per AC3.2.

Add the import at the top of `src/memory/postgres-store.ts`:

```typescript
import { MemoryError } from '@/errors/index.js';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing memory tests pass. If any test relied on the exact error message text from the old `new Error(...)`, update the assertion to check for `MemoryError` instead.

**Commit:** `refactor(memory): migrate primary throw sites to MemoryError`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
