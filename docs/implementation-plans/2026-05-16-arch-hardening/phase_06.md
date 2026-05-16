# Architectural Hardening Implementation Plan

**Goal:** Replace static shell markers with per-invocation nonces so that stale output from a previous command cannot falsely signal completion

**Architecture:** Each `execute()` call generates an 8-char hex nonce via `crypto.randomBytes(4)`. PS1 is re-set per command to include the nonce. Both the marker regex and CWD pattern are generated per-call and scoped within `execute()`. The session-level `promptMarker` remains as the base prefix for the overall prompt format.

**Tech Stack:** Bun (TypeScript), crypto module

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC6: Per-command shell nonces
- **arch-hardening.AC6.1 Success:** Each `execute()` call generates a unique 8-char hex nonce
- **arch-hardening.AC6.2 Success:** `waitForMarker` only matches the nonce from the current invocation
- **arch-hardening.AC6.3 Success:** CWD extraction uses nonce-scoped markers
- **arch-hardening.AC6.4 Edge:** Output from a previous command containing the base marker prefix does not trigger false completion

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Refactor execute() for per-command nonce generation

**Verifies:** arch-hardening.AC6.1, arch-hardening.AC6.2, arch-hardening.AC6.3

**Files:**
- Modify: `src/shell/session.ts` (execute method, ~lines 106-148; marker matching logic, ~lines 64-88; CWD extraction, ~line 169; output filtering, ~lines 171-192)

**Implementation:**

The current implementation has a session-level `markerRegex` compiled once at creation. This must change to per-invocation.

**Step 1: Remove session-level markerRegex**

The regex at lines 64-66:
```typescript
const markerRegex = new RegExp(
  `\\[${promptMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\]> `,
);
```
Remove this from the session scope. It will be generated inside `execute()` instead.

**Step 2: Modify execute() to generate nonce and set PS1 per-call**

At the start of `execute()`, generate a nonce and build per-call patterns:

```typescript
async execute(command: string): Promise<ExecuteResult> {
  if (!isAliveFlag) {
    throw new ShellError('SESSION_CLOSED', 'cannot execute command on closed shell session');
  }

  const nonce = crypto.randomBytes(4).toString('hex');
  const marker = `${promptMarker}_${nonce}`;
  const cwdMarker = `___CWD_${nonce}___`;

  const markerRegex = new RegExp(
    `\\[${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\]> `,
  );
  const cwdPattern = new RegExp(`${cwdMarker} (.+?) ${cwdMarker}`);

  // Set PS1 for this command
  const wrappedCommand = [
    `PS1="[${marker}\\$?]> "`,
    `${command}; __x=$?; echo "${cwdMarker} $(pwd) ${cwdMarker}"; (exit $__x)`,
  ].join('\n');

  // Reset output buffer
  outputBuffer = '';

  // Write command
  proc.terminal!.write(wrappedCommand + '\n');

  // Wait for nonce-scoped marker
  const result = await waitForMarker(markerRegex, cwdPattern, commandTimeout);
  return result;
}
```

**Step 3: Update waitForMarker to accept per-call patterns**

Change `waitForMarker` from using session-level regex to accepting it as a parameter:

```typescript
async function waitForMarker(
  markerRegex: RegExp,
  cwdPattern: RegExp,
  timeout: number,
): Promise<ExecuteResult> {
  // ... existing polling/detection logic but using the passed-in patterns
}
```

**Step 4: Update output filtering to use nonce-scoped CWD pattern**

The CWD extraction (currently `const cwdPattern = /___CWD___ (.+?) ___CWD___/`) moves inside `execute()` as shown above, using the nonce-scoped pattern.

Output filtering must also strip the PS1 set command and the nonce-specific markers from the output. Update the line-filtering logic to remove lines matching:
- The PS1 assignment command
- Lines containing only the marker prompt
- CWD marker lines

**Step 5: Keep session-level promptMarker for initialization**

The initial PS1 set during session creation (line 96) remains unchanged — it sets a baseline prompt so the shell is ready. The first `execute()` call will override PS1 with its nonce.

Add import at top:
```typescript
import crypto from 'node:crypto';
```

**Note on shell compatibility:** The `PS1=`, `__x=$?`, and `(exit $__x)` syntax assumes a POSIX-compatible shell (bash/zsh). This is consistent with the existing implementation which spawns `bash -i --norc --noprofile`. The `ShellConfig.shell` field defaults to `/bin/bash`. If a non-POSIX shell is configured, these patterns will fail — but this is an existing constraint, not one introduced by the nonce change.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(shell): implement per-command nonce markers`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update existing shell tests for nonce-aware behaviour

**Verifies:** arch-hardening.AC6.1, arch-hardening.AC6.2, arch-hardening.AC6.3

**Files:**
- Modify: `src/shell/session.test.ts` (update any tests that rely on static marker patterns)

**Implementation:**

Review existing tests in `src/shell/session.test.ts`. Tests that check for marker stripping or output cleanliness need to be verified against the new nonce-based markers.

Key tests to verify still pass:
- "Marker detection and stripping" — markers should still be stripped from output, even though they now include a nonce
- "Working directory persistence" — CWD extraction still works with nonce-scoped markers
- "Exit code capture" — exit codes still captured from the nonce-scoped marker
- "No-output commands" — still return correct exit code
- "Command timeout" — timeout detection still works with nonce markers

Most tests should pass without modification since they test the public `execute()` API and don't inspect marker internals. However, any test that:
- Injects raw marker text into stdout and expects completion
- Checks for specific marker format strings in output

...will need updating.

Run the existing tests first. Fix any failures caused by the nonce refactor.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/shell/session.test.ts`
Expected: All existing tests pass

**Commit:** `test(shell): update tests for per-command nonce markers`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add nonce isolation tests

**Verifies:** arch-hardening.AC6.4

**Files:**
- Modify: `src/shell/session.test.ts` (add new test cases)

**Implementation:**

Add test cases specifically for the nonce isolation guarantee.

**Testing:**

- **arch-hardening.AC6.4:** Execute a command that outputs text containing the base marker prefix (e.g., `echo "[___CSML___0]> "`). Immediately execute another command. Verify that the second command:
  1. Completes normally (the echoed marker from command 1 did NOT trigger false completion)
  2. Returns the correct output and exit code
  3. Extracts the correct CWD

Test approach:
```typescript
it('output containing base marker prefix does not trigger false completion', async () => {
  // Execute a command that outputs something resembling an old-style marker
  const result1 = await session.execute(`echo "[${promptMarker}0]> "`);
  expect(result1.exitCode).toBe(0);

  // Execute a second command — should complete normally
  const result2 = await session.execute('echo "hello"');
  expect(result2.exitCode).toBe(0);
  expect(result2.output).toContain('hello');
});
```

Additional nonce uniqueness test:
```typescript
it('generates unique nonces for consecutive execute calls', async () => {
  // Execute two rapid commands and verify both complete independently
  const result1 = await session.execute('echo "first"');
  const result2 = await session.execute('echo "second"');
  expect(result1.output).toContain('first');
  expect(result2.output).toContain('second');
  // Both have correct exit codes — proves independent nonce matching
  expect(result1.exitCode).toBe(0);
  expect(result2.exitCode).toBe(0);
});
```

Follow project pattern: `describe('arch-hardening.AC6.4: ...', () => { it('...', async () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/shell/session.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(shell): add nonce isolation tests for false completion prevention`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
