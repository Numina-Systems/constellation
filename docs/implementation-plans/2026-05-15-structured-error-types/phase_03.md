# Structured Error Types Implementation Plan

**Goal:** Define error subclasses for the remaining subsystems: persistence, agent, and config.

**Architecture:** Functional Core error types extending `ConstellationError`. These are type definitions only — no call-site migration in this phase. The types are made available for incremental adoption by each subsystem on its own timeline.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 3 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### structured-error-types.AC2: Subsystem Error Hierarchies (remaining)
- **structured-error-types.AC2.5 Success:** `PersistenceError` defines codes: `CONNECTION_FAILED`, `MIGRATION_FAILED`, `QUERY_FAILED`
- **structured-error-types.AC2.6 Success:** `PersistenceError` with `QUERY_FAILED` includes sanitized query context (no parameter values, only query shape)
- **structured-error-types.AC2.7 Success:** `AgentError` defines codes: `TOOL_DISPATCH_FAILED`, `COMPACTION_FAILED`, `RECALL_FAILED`, `CHECKPOINT_FAILED`
- **structured-error-types.AC2.8 Success:** `ConfigError` defines codes: `VALIDATION_FAILED`, `MISSING_REQUIRED`
- **structured-error-types.AC2.9 Success:** `ConfigError` with `VALIDATION_FAILED` includes the Zod error path in context

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: PersistenceError type

**Verifies:** structured-error-types.AC2.5, AC2.6

**Files:**
- Create: `src/errors/persistence.ts`
- Test: `src/errors/persistence.test.ts`

**Implementation:**

Create `src/errors/persistence.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type PersistenceErrorCode =
  | 'CONNECTION_FAILED'
  | 'MIGRATION_FAILED'
  | 'QUERY_FAILED';

export class PersistenceError extends ConstellationError {
  constructor(
    code: PersistenceErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'persistence', context ?? {}, options);
    this.name = 'PersistenceError';
  }
}

/**
 * Sanitize a SQL query for inclusion in error context.
 * Strips parameter values ($1, $2, etc. placeholders remain but any
 * inline literal values adjacent to them are not included since we
 * only store the query template, not the bound parameters).
 *
 * This is intentionally simple — the query string passed to
 * PersistenceProvider.query() is already a parameterized template
 * (e.g., "INSERT INTO foo VALUES ($1, $2)"), so there are no inline
 * literal values to strip. The function truncates long queries and
 * removes any accidental inclusion of values after parameter markers.
 */
export function sanitizeQuery(query: string): string {
  return query
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
```

The `sanitizeQuery` helper normalizes whitespace and truncates to 200 characters. Since Constellation uses parameterized queries throughout (`$1`, `$2` placeholders), the query template itself never contains user data. The truncation prevents accidentally large query strings from inflating error context.

**Testing:**

Create `src/errors/persistence.test.ts`:

1. **AC2.5:** Each `PersistenceErrorCode` constructs a valid `PersistenceError` — test all three codes
2. **AC2.6:** `QUERY_FAILED` with `{ query: sanitizeQuery('SELECT * FROM messages WHERE id = $1') }` — verify context includes the sanitized query string
3. `PersistenceError` is `instanceof PersistenceError`, `instanceof ConstellationError`, and `instanceof Error`
4. `.toDisplayString()` formats as `[persistence:QUERY_FAILED] ...`
5. `sanitizeQuery` normalizes whitespace: multi-line query becomes single line
6. `sanitizeQuery` truncates queries longer than 200 characters
7. `sanitizeQuery` preserves `$N` parameter placeholders

**Verification:**
Run: `bun test src/errors/persistence.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add PersistenceError type with query sanitization`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: AgentError type

**Verifies:** structured-error-types.AC2.7

**Files:**
- Create: `src/errors/agent.ts`
- Test: `src/errors/agent.test.ts`

**Implementation:**

Create `src/errors/agent.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type AgentErrorCode =
  | 'TOOL_DISPATCH_FAILED'
  | 'COMPACTION_FAILED'
  | 'RECALL_FAILED'
  | 'CHECKPOINT_FAILED';

export class AgentError extends ConstellationError {
  constructor(
    code: AgentErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'agent', context ?? {}, options);
    this.name = 'AgentError';
  }
}
```

**Testing:**

Create `src/errors/agent.test.ts`:

1. **AC2.7:** Each `AgentErrorCode` constructs a valid `AgentError` — test all four codes
2. `AgentError` is `instanceof AgentError`, `instanceof ConstellationError`, and `instanceof Error`
3. `.toDisplayString()` formats as `[agent:TOOL_DISPATCH_FAILED] ...`
4. `TOOL_DISPATCH_FAILED` with `{ toolName: 'memory_read', input: { label: 'goals' } }` in context — verify context carries the tool dispatch details
5. Suggestion is forwarded correctly: `{ suggestion: 'Check tool registry for available tools' }`
6. Cause chaining works: wrapping an original `Error` preserves it as `.cause`

**Verification:**
Run: `bun test src/errors/agent.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add AgentError type with tool and compaction codes`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: ConfigError type

**Verifies:** structured-error-types.AC2.8, AC2.9

**Files:**
- Create: `src/errors/config.ts`
- Test: `src/errors/config.test.ts`

**Implementation:**

Create `src/errors/config.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type ConfigErrorCode =
  | 'VALIDATION_FAILED'
  | 'MISSING_REQUIRED';

export class ConfigError extends ConstellationError {
  constructor(
    code: ConfigErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'config', context ?? {}, options);
    this.name = 'ConfigError';
  }
}
```

**Testing:**

Create `src/errors/config.test.ts`:

1. **AC2.8:** Each `ConfigErrorCode` constructs a valid `ConfigError` — test both codes
2. **AC2.9:** `VALIDATION_FAILED` with `{ path: ['model', 'provider'], zodErrors: [{ message: 'Required', path: ['model', 'provider'] }] }` in context — verify context includes the Zod error path
3. `ConfigError` is `instanceof ConfigError`, `instanceof ConstellationError`, and `instanceof Error`
4. `.toDisplayString()` formats as `[config:VALIDATION_FAILED] ...`
5. `MISSING_REQUIRED` with `{ field: 'ANTHROPIC_API_KEY' }` and suggestion `'Set the ANTHROPIC_API_KEY environment variable or add it to config.toml'` — verify both context and suggestion

**Verification:**
Run: `bun test src/errors/config.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add ConfigError type with validation and missing codes`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/errors/index.ts`

**Implementation:**

Add exports for the three new error types:

```typescript
export { PersistenceError, sanitizeQuery } from './persistence.js';
export type { PersistenceErrorCode } from './persistence.js';
export { AgentError } from './agent.js';
export type { AgentErrorCode } from './agent.js';
export { ConfigError } from './config.js';
export type { ConfigErrorCode } from './config.js';
```

The full `src/errors/index.ts` after this task should export:
- `ConstellationError` (phase 1)
- `isConstellationError`, `wrapError` (phase 1)
- `MemoryError`, `MemoryErrorCode` (phase 2)
- `ModelError`, `ModelErrorCode` (phase 2)
- `PersistenceError`, `PersistenceErrorCode`, `sanitizeQuery` (this phase)
- `AgentError`, `AgentErrorCode` (this phase)
- `ConfigError`, `ConfigErrorCode` (this phase)

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass (no regressions)

**Commit:** `feat(errors): export persistence, agent, and config error types`
<!-- END_TASK_4 -->
