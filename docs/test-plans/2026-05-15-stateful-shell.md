# Human Test Plan: Stateful Shell

## Prerequisites
- Bun installed and available
- `bun test src/shell/ src/tool/builtin/shell-execute.test.ts` passing (all green)
- Deno sandbox tests passing: `bun test src/runtime/`
- The daemon can be started via `bun run start`

## Phase 1: Isolation from Deno Sandbox (AC7.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/runtime/` | All existing Deno sandbox tests pass without modification |
| 2 | Open `src/runtime/executor.ts` in editor | No imports from `src/shell/`, no references to `ShellSession`, `createShellSession`, or shell-related types |
| 3 | Search entire `src/runtime/` directory: `grep -r "shell" src/runtime/` | No matches referencing the stateful shell module (only unrelated uses of "shell" if any) |

## Phase 2: Environment Isolation (AC7.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | REPL available |
| 2 | Via the agent, invoke `shell_execute` with command: `export ISOLATION_TEST=shellvalue123` | Success, exit code 0 |
| 3 | Immediately invoke `execute_code` with code: `console.log(Deno.env.get("ISOLATION_TEST") ?? "NOT_FOUND")` | Output is `NOT_FOUND` -- env var set in shell is not visible in Deno sandbox |
| 4 | Invoke `shell_execute` with command: `echo $ISOLATION_TEST` | Output contains `shellvalue123` -- confirming it persists within the shell |

## Phase 3: Concurrency Independence (AC7.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Invoke `shell_execute` with command: `sleep 2 && echo shell_done` | Takes ~2 seconds, returns "shell_done" |
| 2 | While step 1 is pending (or immediately after), invoke `execute_code` with: `console.log("deno_done")` | Returns "deno_done" without waiting for shell command |
| 3 | Search codebase for shared locks: `grep -rn "mutex\|semaphore\|lock" src/shell/ src/runtime/` | No shared synchronisation primitives between the two subsystems |

## End-to-End: Full Agent Session with Shell

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon, begin conversation | Agent loop initialises, shell session created on first use |
| 2 | Ask agent to "create a file /tmp/constellation-test.txt with hello in it using the shell" | Agent invokes `shell_execute` with `echo hello > /tmp/constellation-test.txt`; result shows exit code 0 |
| 3 | Ask agent to "read that file back" | Agent invokes `shell_execute` with `cat /tmp/constellation-test.txt`; output contains "hello" |
| 4 | Ask agent to "what directory are you in?" | Agent invokes `shell_execute` with `pwd`; result shows current working directory, consistent with `[cwd: ...]` in output |
| 5 | Ask agent to run an invalid command like `nonexistent_binary_xyz` | Agent reports failure with non-zero exit code, no crash |
| 6 | Ask agent to run a quick command after the failure | Shell session still alive; command succeeds normally |
| 7 | Clean up: `rm /tmp/constellation-test.txt` | File removed |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | session.test.ts "creates/destroys" | -- |
| AC1.2 | session.test.ts "multiple commands" | -- |
| AC1.3 | session.test.ts "idle timeout" | -- |
| AC1.4 | shell-execute.test.ts "same session instance" | -- |
| AC1.5 | session.test.ts "nonexistent shell binary" | -- |
| AC2.1 | session.test.ts "env var persistence" | -- |
| AC2.2 | session.test.ts "cwd persistence" | -- |
| AC2.3 | session.test.ts "alias persistence" | -- |
| AC3.1 | session.test.ts "captures both" | -- |
| AC3.2 | ansi.test.ts "strips SGR/cursor/OSC" | -- |
| AC3.3 | truncate.test.ts "truncated with marker" | -- |
| AC3.4 | ansi.test.ts + truncate.test.ts "empty string" | -- |
| AC4.1 | session.test.ts "marker detection" | -- |
| AC4.2 | session.test.ts "strips marker" | -- |
| AC4.3 | session.test.ts "no output, exit 0" | -- |
| AC5.1 | session.test.ts "timeout" | -- |
| AC5.2 | session.test.ts "root check" | -- |
| AC5.3 | session.test.ts "SIGKILL escalation" | -- |
| AC5.4 | session.test.ts "exit codes" | -- |
| AC6.1 | shell-execute.test.ts "name + params" | -- |
| AC6.2 | shell-execute.test.ts "output format" | -- |
| AC6.3 | shell-execute.test.ts "description" | -- |
| AC6.4 | shell-execute.test.ts "registry dispatch" | -- |
| AC7.1 | -- | Phase 1: run runtime tests, inspect executor.ts |
| AC7.2 | -- | Phase 2: cross-subsystem env var isolation |
| AC7.3 | -- | Phase 3: concurrent execution independence |
