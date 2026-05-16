# Architectural Hardening Implementation Plan

**Goal:** Migrate checkpoint-restore and shell/session to ConstellationError hierarchy with structured codes and traceError integration

**Architecture:** New `ShellError` extends `ConstellationError` with subsystem `'shell'` and four error codes. `checkpoint-restore.ts` replaces its generic `Error` with `AgentError('CHECKPOINT_FAILED')` and adds `traceError()` calls. `ShellCreationError` is removed entirely.

**Tech Stack:** Bun (TypeScript)

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC5: Structured errors adopted
- **arch-hardening.AC5.1 Success:** `checkpoint-restore.ts` throws `AgentError('CHECKPOINT_FAILED')` with `conversationId` and `checkpointId` in context
- **arch-hardening.AC5.2 Success:** `traceError()` called in checkpoint-restore catch blocks
- **arch-hardening.AC5.3 Success:** `ShellError` extends `ConstellationError` with subsystem `'shell'`
- **arch-hardening.AC5.4 Success:** All four shell error codes produce errors with actionable `suggestion` field
- **arch-hardening.AC5.5 Failure:** No generic `Error` or `ShellCreationError` thrown in either file

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create ShellError class

**Verifies:** arch-hardening.AC5.3, arch-hardening.AC5.4

**Files:**
- Create: `src/errors/shell.ts`
- Modify: `src/errors/index.ts` (add barrel export)

**Implementation:**

Create `src/errors/shell.ts` following the exact pattern of `src/errors/agent.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.ts';

export type ShellErrorCode =
  | 'SHELL_CREATION_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'MARKER_NOT_FOUND'
  | 'SESSION_CLOSED';

const SUGGESTIONS: Record<ShellErrorCode, string> = {
  SHELL_CREATION_FAILED: 'verify shell binary exists and user has permissions to spawn processes',
  COMMAND_TIMEOUT: 'increase timeout or check for commands that block on stdin/confirmation',
  MARKER_NOT_FOUND: 'shell process may have died or produced unexpected output that consumed the marker',
  SESSION_CLOSED: 'create a new shell session — the previous one exited or was killed',
};

export class ShellError extends ConstellationError {
  constructor(
    code: ShellErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { cause?: Error },
  ) {
    super(message, code, 'shell', context ?? {}, {
      suggestion: SUGGESTIONS[code],
      cause: options?.cause,
    });
    this.name = 'ShellError';
  }
}
```

Add to `src/errors/index.ts` after the Phase 3 section:

```typescript
export { ShellError } from './shell.js';
export type { ShellErrorCode } from './shell.js';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(errors): add ShellError structured error class`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ShellError unit tests

**Verifies:** arch-hardening.AC5.3, arch-hardening.AC5.4

**Files:**
- Create: `src/errors/shell.test.ts`

**Implementation:**

Unit tests (no database needed — these are pure Functional Core tests).

**Testing:**

- **arch-hardening.AC5.3:** Instantiate `ShellError` with each code. Verify `error.subsystem === 'shell'`, `error instanceof ConstellationError`, `error.name === 'ShellError'`.

- **arch-hardening.AC5.4:** For each of the four codes (`SHELL_CREATION_FAILED`, `COMMAND_TIMEOUT`, `MARKER_NOT_FOUND`, `SESSION_CLOSED`), verify `error.suggestion` is a non-empty string containing actionable text. Verify `error.toDisplayString()` includes the suggestion.

Additional tests:
- Verify `error.context` includes whatever was passed in the constructor
- Verify `error.cause` propagates when `options.cause` is provided
- Verify `error.toJSON()` serializes all fields

Follow project pattern: `describe('arch-hardening.AC5.3: ...', () => { it('...', () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/errors/shell.test.ts`
Expected: All tests pass

**Commit:** `test(errors): add unit tests for ShellError`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Migrate shell/session.ts to ShellError

**Verifies:** arch-hardening.AC5.4, arch-hardening.AC5.5

**Files:**
- Modify: `src/shell/session.ts` (lines 15-20, 31-33, 56-58, 101, 108)
- Modify: `src/shell/index.ts` (remove ShellCreationError export)

**Implementation:**

Remove the `ShellCreationError` class definition (lines 15-20) from `src/shell/session.ts`.

Replace all error throws:

1. **Line 31-33** (root user check): Replace `throw new ShellCreationError(...)` with:
   ```typescript
   throw new ShellError('SHELL_CREATION_FAILED', 'cannot create shell session as root user', {
     uid: process.getuid?.(),
   });
   ```

2. **Line 56-58** (spawn failure): Replace with:
   ```typescript
   throw new ShellError('SHELL_CREATION_FAILED', `failed to spawn shell: ${err instanceof Error ? err.message : String(err)}`, {
     shell: shellPath,
   }, { cause: err instanceof Error ? err : undefined });
   ```

3. **Line 101** (prompt timeout during init): Replace with:
   ```typescript
   throw new ShellError('SHELL_CREATION_FAILED', 'shell initialization timed out waiting for prompt marker', {
     timeoutMs: 5000,
   });
   ```

4. **Line 108** (execute on dead session): Replace `throw new Error(...)` with:
   ```typescript
   throw new ShellError('SESSION_CLOSED', 'cannot execute command on closed shell session');
   ```

Add import at top of `src/shell/session.ts`:
```typescript
import { ShellError } from '@/errors/shell.ts';
```

Remove `ShellCreationError` from `src/shell/index.ts` exports. Add `ShellError` re-export if consumers need it from the shell module (check if anything imports `ShellCreationError` from `@/shell`).

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors (if anything imports ShellCreationError, update those imports too)

Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && grep -rn "ShellCreationError" src/`
Expected: No results (fully migrated)

Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && grep -n "new Error" src/shell/session.ts`
Expected: No results (no generic Error thrown)

**Commit:** `refactor(shell): migrate to ShellError structured errors`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Migrate checkpoint-restore.ts to AgentError with traceError

**Verifies:** arch-hardening.AC5.1, arch-hardening.AC5.2, arch-hardening.AC5.5

**Files:**
- Modify: `src/agent/checkpoint-restore.ts` (lines 52-54, add traceError calls)

**Implementation:**

The current error at lines 52-54:
```typescript
throw new Error(
  `cannot restore checkpoint ${checkpoint.id}: conversation ${checkpoint.conversationId} has no messages (deleted or missing)`,
);
```

Replace with:
```typescript
const error = new AgentError(
  'CHECKPOINT_FAILED',
  `cannot restore checkpoint: conversation has no messages (deleted or missing)`,
  { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
  { suggestion: 'verify the conversation exists and has not been deleted' },
);
traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
throw error;
```

Add imports at top:
```typescript
import { AgentError } from '@/errors/agent.ts';
import { traceError } from '@/errors/trace.ts';
```

The `deps` object (type `RestorationDependencies`) already includes `owner: string` (line 23 of checkpoint-restore.ts). Add `traceRecorder: TraceRecorder` to the type definition — this field is being introduced now (Phase 3) and the composition root caller in `src/index.ts` (around line 1072) must be updated to pass `traceRecorder` (which already exists in the composition root, created at line 552 as `const traceRecorder: TraceStore = createTraceRecorder(persistence)`).

Additionally, wrap the entire function body in a try/catch to trace unexpected errors:
```typescript
try {
  // existing restore logic
} catch (error) {
  if (error instanceof AgentError) {
    throw error; // already traced above
  }
  const wrapped = new AgentError(
    'CHECKPOINT_FAILED',
    `unexpected error during checkpoint restore: ${error instanceof Error ? error.message : String(error)}`,
    { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
    { cause: error instanceof Error ? error : undefined },
  );
  traceError(wrapped, deps.traceRecorder, deps.owner, checkpoint.conversationId);
  throw wrapped;
}
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && grep -n "new Error" src/agent/checkpoint-restore.ts`
Expected: No results (no generic Error thrown)

**Commit:** `refactor(agent): migrate checkpoint-restore to AgentError with traceError`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
