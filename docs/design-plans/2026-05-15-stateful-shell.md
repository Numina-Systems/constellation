# Stateful Shell Design

## Summary

Constellation spawns a fresh Deno subprocess for each code execution via the sandbox in `src/runtime/`. This works well for untrusted code but makes multi-step shell workflows impossible — `cd`, environment variable exports, and partial build state all evaporate between calls. The agent has to redundantly set up context every time it runs a command.

Stateful Shell adds a persistent PTY session per agent lifecycle. A single shell process survives across multiple `execute()` calls, preserving working directory, environment variables, and shell state. The agent gains a new `shell_execute` tool that targets this persistent session, while the existing Deno sandbox remains untouched for sandboxed code execution.

The PTY is managed via Bun's native `Bun.spawn` with PTY allocation (or `node-pty` as fallback). A `PROMPT_COMMAND`-based completion marker detects when a command finishes, and output is captured with ANSI stripping, byte-capped truncation, and configurable timeouts.

Ported from Pattern's stateful shell design, adapted for Bun's process model and Constellation's factory-function / port-adapter architecture.

## Definition of Done

1. The agent can execute shell commands that persist working directory and environment variables across calls within a single session.
2. Output is captured with ANSI escape codes stripped, truncated at a configurable byte limit (default 64KB).
3. Commands time out after a configurable duration (default 30s) without killing the session.
4. The shell session is created on agent start and destroyed on agent stop, timeout, or quiesce.
5. The `shell_execute` tool is registered alongside existing tools and uses the persistent session.
6. The Deno sandbox remains unchanged and independent — untrusted code execution still uses the sandbox.

## Acceptance Criteria

### stateful-shell.AC1: Session Lifecycle
- **stateful-shell.AC1.1 Success:** Shell session created during agent initialisation, destroyed on agent stop
- **stateful-shell.AC1.2 Success:** Session survives across multiple `execute()` calls
- **stateful-shell.AC1.3 Success:** Session destroyed after idle timeout (configurable, default 10m)
- **stateful-shell.AC1.4 Edge:** Creating a session when one already exists returns the existing session
- **stateful-shell.AC1.5 Failure:** Session creation failure (no shell binary) returns descriptive error, agent continues without shell

### stateful-shell.AC2: Environment Persistence
- **stateful-shell.AC2.1 Success:** `export FOO=bar` followed by `echo $FOO` in a subsequent call returns `bar`
- **stateful-shell.AC2.2 Success:** `cd /tmp` followed by `pwd` in a subsequent call returns `/tmp`
- **stateful-shell.AC2.3 Success:** Shell aliases set in one call are available in subsequent calls

### stateful-shell.AC3: Output Capture
- **stateful-shell.AC3.1 Success:** stdout and stderr are captured and returned as a single string
- **stateful-shell.AC3.2 Success:** ANSI escape codes are stripped from output
- **stateful-shell.AC3.3 Success:** Output exceeding `max_output_bytes` (default 64KB) is truncated with `[truncated — X bytes total]` marker
- **stateful-shell.AC3.4 Success:** Empty output returns empty string, not null

### stateful-shell.AC4: Completion Detection
- **stateful-shell.AC4.1 Success:** `PROMPT_COMMAND` marker injected at session start, used to detect command completion
- **stateful-shell.AC4.2 Success:** Marker is stripped from returned output
- **stateful-shell.AC4.3 Edge:** Commands that produce no output still complete correctly via marker detection

### stateful-shell.AC5: Safety
- **stateful-shell.AC5.1 Success:** Command exceeding timeout (default 30s) is interrupted (SIGINT), output captured so far is returned with `[timeout after Xs]`
- **stateful-shell.AC5.2 Success:** Shell does not run as root (drops privileges if parent is root)
- **stateful-shell.AC5.3 Success:** Second timeout after SIGINT sends SIGKILL and recreates the session
- **stateful-shell.AC5.4 Success:** Exit code is captured and returned alongside output

### stateful-shell.AC6: Tool Integration
- **stateful-shell.AC6.1 Success:** `shell_execute` tool registered in tool registry with `command` parameter
- **stateful-shell.AC6.2 Success:** `shell_execute` returns output, exit code, and working directory
- **stateful-shell.AC6.3 Success:** Tool description makes clear this is a persistent shell, not a fresh subprocess
- **stateful-shell.AC6.4 Success:** Tool dispatch records a trace via `TraceRecorder`

### stateful-shell.AC7: Isolation from Deno Sandbox
- **stateful-shell.AC7.1 Success:** Deno sandbox tools (`execute_code`) continue to spawn fresh subprocesses
- **stateful-shell.AC7.2 Success:** Shell session and sandbox do not share environment or working directory
- **stateful-shell.AC7.3 Success:** Both can run concurrently without interference

## Architecture

### Components

**ShellSession** (`src/shell/session.ts`, Imperative Shell) — Manages a single PTY process. Handles spawn, write, read with marker detection, timeout, ANSI stripping, output truncation, and teardown. Exposes `execute(command: string): Promise<ShellResult>` and `destroy(): Promise<void>`.

**ShellSessionFactory** (`src/shell/index.ts`, Imperative Shell) — `createShellSession(config)` factory function that allocates the PTY, injects `PROMPT_COMMAND`, and returns a `ShellSession`. Barrel exports for the module.

**ANSI Stripper** (`src/shell/ansi.ts`, Functional Core) — Pure function `stripAnsi(raw: string): string` that removes escape codes. Extracted for testability.

**Output Truncator** (`src/shell/truncate.ts`, Functional Core) — Pure function `truncateOutput(raw: string, maxBytes: number): string` that caps output with a truncation marker.

**Shell Execute Tool** (`src/tool/shell-execute.ts`, Imperative Shell) — Tool definition for `shell_execute`. Takes `command` string, calls `session.execute()`, returns formatted result. Registered in the tool registry alongside existing tools.

### Contracts

```typescript
// src/shell/types.ts

type ShellConfig = {
  readonly shell: string;           // default: process.env.SHELL || '/bin/bash'
  readonly commandTimeout: number;  // ms, default 30_000
  readonly idleTimeout: number;     // ms, default 600_000
  readonly maxOutputBytes: number;  // default 65_536
  readonly promptMarker: string;    // default: unique UUID-based marker
};

type ShellResult = {
  readonly output: string;
  readonly exitCode: number | null;
  readonly workingDirectory: string;
  readonly timedOut: boolean;
};

interface ShellSession {
  execute(command: string): Promise<ShellResult>;
  destroy(): Promise<void>;
  readonly isAlive: boolean;
  readonly workingDirectory: string;
}
```

```typescript
// src/shell/index.ts

function createShellSession(config?: Partial<ShellConfig>): Promise<ShellSession>;
```

```typescript
// src/shell/ansi.ts

function stripAnsi(raw: string): string;
```

```typescript
// src/shell/truncate.ts

function truncateOutput(raw: string, maxBytes: number): string;
```

### Data Flow

```
agent calls shell_execute("git status")
    │
    ▼
┌──────────────┐
│ ShellSession  │
│ write to PTY  │
│ "git status"  │
└──────┬───────┘
       │
       ▼
  PTY process (persistent bash)
       │
       ▼
  stdout/stderr → buffer
       │
       ▼
  PROMPT_MARKER detected
       │
       ▼
┌──────────────┐
│ stripAnsi()  │
│ truncate()   │
│ parse exit   │
└──────┬───────┘
       │
       ▼
  ShellResult returned to tool
```

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Core Types and Pure Functions

**Goal:** Define shell types and implement ANSI stripping and output truncation as pure, testable functions.

**Components:**
- `src/shell/types.ts` (Functional Core) — `ShellConfig`, `ShellResult`, `ShellSession` interface
- `src/shell/ansi.ts` (Functional Core) — `stripAnsi()` function
- `src/shell/truncate.ts` (Functional Core) — `truncateOutput()` function
- `src/shell/ansi.test.ts` — Tests for common ANSI sequences (colour, cursor, clear), nested sequences, no-op on clean strings
- `src/shell/truncate.test.ts` — Tests for under-limit passthrough, exact-limit passthrough, over-limit truncation with marker, empty input

**Dependencies:** None

**Covers:** stateful-shell.AC3.2, stateful-shell.AC3.3, stateful-shell.AC3.4

**Done when:** Pure functions correctly strip ANSI and truncate output. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Shell Session

**Goal:** Implement the persistent PTY session with completion detection, timeout handling, and lifecycle management.

**Components:**
- `src/shell/session.ts` (Imperative Shell) — `ShellSession` implementation using `Bun.spawn` with PTY options or `node-pty` fallback. `PROMPT_COMMAND` injection, marker-based completion detection, timeout with SIGINT/SIGKILL escalation, idle timeout teardown
- `src/shell/session.test.ts` — Integration tests: execute simple command, env persistence across calls, working directory persistence, timeout handling, idle timeout, session destroy

**Dependencies:** Phase 1

**Covers:** stateful-shell.AC1 (lifecycle), stateful-shell.AC2 (persistence), stateful-shell.AC4 (completion detection), stateful-shell.AC5 (safety)

**Done when:** A shell session can execute multiple commands with persisted state, handle timeouts gracefully, and clean up on destroy. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Tool and Agent Integration

**Goal:** Register `shell_execute` tool, wire session lifecycle to agent start/stop, add config fields.

**Components:**
- `src/tool/shell-execute.ts` (Imperative Shell) — Tool definition with `command` parameter, returns output + exit code + cwd
- `src/shell/index.ts` (Imperative Shell) — `createShellSession()` factory, barrel exports
- `src/config/schema.ts` — Add `shell` config section: `shell_enabled` (default false), `shell_command_timeout`, `shell_idle_timeout`, `shell_max_output_bytes`
- `src/index.ts` — Create shell session at agent start (if enabled), pass to tool registry, destroy on shutdown
- `src/tool/shell-execute.test.ts` — Tool dispatch tests with mocked session

**Dependencies:** Phase 2

**Covers:** stateful-shell.AC6 (tool integration), stateful-shell.AC7 (sandbox isolation)

**Done when:** `shell_execute` tool is registered and functional. Shell session lifecycle is wired to agent start/stop. Config fields control behaviour. Deno sandbox is unaffected. Build succeeds (`bun run build`).
<!-- END_PHASE_3 -->

## Additional Considerations

**PTY availability:** Bun's `Bun.spawn` supports PTY allocation on macOS and Linux via the `stdio` option. If PTY allocation fails (e.g., inside a container without `/dev/ptmx`), fall back to pipe-based spawn with a polling-based completion detection strategy (echo exit code to marker). This is less reliable but functional.

**Security boundary:** The stateful shell runs with the same privileges as the Constellation process. It is explicitly NOT a sandbox — it's the agent's own hands. The Deno sandbox remains the boundary for untrusted code from the model. The shell is for trusted operations the agent performs (file reads, git, system inspection).

**Windows:** Not supported. Constellation targets Linux and macOS. Windows PTY (`conpty`) has materially different semantics and is out of scope.
