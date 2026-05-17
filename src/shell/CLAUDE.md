# Shell

Last verified: 2026-05-16

## Purpose
Provides a persistent PTY shell session that survives across commands, enabling stateful interactions (cd, environment variables, etc.) without spawning a new process per command.

## Contracts
- **Exposes**: `ShellSession` type (`execute(cmd)`, `destroy()`, `isAlive`, `workingDirectory`), `ShellConfig` type, `ShellResult` type, `createShellSession(config)`, `stripAnsi(text)`, `truncateOutput(text, maxBytes)`
- **Guarantees**: Commands are delimited by per-command nonce markers (UUID-based), ensuring output from one command is never mixed with another. `execute` resolves with output, exit code, working directory, and timeout status. Session auto-detects working directory after each command. Output is truncated to `maxOutputBytes` if exceeded.
- **Expects**: A POSIX-compatible shell binary at `config.shell` path. PTY available (node-pty).

## Dependencies
- **Uses**: `node-pty` (PTY subprocess), `src/errors/` (`ShellError`)
- **Used by**: `src/tool/` (shell tool), `src/agent/` (via tool dispatch)
- **Boundary**: Consumers interact only through `ShellSession` interface. No direct PTY access outside this module.

## Key Decisions
- Nonce-based command markers: Each command is wrapped with unique start/end markers so output parsing is deterministic regardless of shell prompt configuration
- Persistent session over spawn-per-command: Enables stateful shell usage (cd, env vars persist) which is critical for agent workflows
- Separate `stripAnsi` and `truncateOutput` as pure utilities: Reusable outside the session context

## Invariants
- A destroyed session always returns `isAlive === false`
- `execute` on a destroyed session throws `ShellError`
- Nonce markers are never included in the returned output
- Exit code is null only when the command timed out

## Key Files
- `types.ts` -- `ShellSession`, `ShellConfig`, `ShellResult` type definitions
- `session.ts` -- `createShellSession` factory (Imperative Shell)
- `ansi.ts` -- `stripAnsi` utility (Functional Core)
- `truncate.ts` -- `truncateOutput` utility (Functional Core)
