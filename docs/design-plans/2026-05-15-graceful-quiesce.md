# Graceful Quiesce Design

## Summary

Constellation has no coordinated shutdown protocol. When the process receives SIGTERM or SIGINT, in-flight operations — memory writes, trace recordings, scheduler updates, MCP connections — are abandoned mid-flight. This risks inconsistent state: a memory block partially written, a compaction that archived messages but didn't update the conversation, or a scheduled task that fired but whose completion wasn't recorded.

Graceful Quiesce adds an ordered drain protocol that coordinates shutdown across all subsystems. Each subsystem implements a `drain()` method. The quiesce orchestrator calls them in dependency order with per-subsystem timeouts. Signal handling is wired so SIGTERM and first SIGINT trigger quiesce; a second SIGINT within the quiesce window forces immediate exit.

Ported from Pattern's drain protocol, adapted for Constellation's composition-root architecture and PostgreSQL persistence (Pattern uses WAL+fsync; Constellation uses PostgreSQL transactions which handle consistency differently).

## Definition of Done

1. SIGTERM and SIGINT trigger an ordered shutdown sequence instead of hard exit.
2. Each subsystem drains pending work within a per-subsystem timeout.
3. Shutdown order respects dependencies: agent loop stops before memory flushes, memory flushes before database closes.
4. A second SIGINT during quiesce forces immediate exit.
5. Pre-compaction quiesce ensures all pending writes are flushed before compaction rewrites history.
6. An `isQuiescing` flag is available for subsystems to check before starting long-running operations.

## Acceptance Criteria

### graceful-quiesce.AC1: Signal Handling
- **graceful-quiesce.AC1.1 Success:** SIGTERM triggers quiesce sequence
- **graceful-quiesce.AC1.2 Success:** First SIGINT triggers quiesce sequence
- **graceful-quiesce.AC1.3 Success:** Second SIGINT during quiesce forces immediate `process.exit(1)`
- **graceful-quiesce.AC1.4 Success:** Second SIGTERM during quiesce forces immediate exit
- **graceful-quiesce.AC1.5 Edge:** Signal received when already quiescing does not restart the sequence

### graceful-quiesce.AC2: Shutdown Order
- **graceful-quiesce.AC2.1 Success:** Agent loop stops accepting new messages first
- **graceful-quiesce.AC2.2 Success:** In-flight tool rounds drain to completion or timeout
- **graceful-quiesce.AC2.3 Success:** Pending memory writes flush to PostgreSQL
- **graceful-quiesce.AC2.4 Success:** Pending trace recordings flush
- **graceful-quiesce.AC2.5 Success:** Pending scheduler updates flush
- **graceful-quiesce.AC2.6 Success:** MCP connections close cleanly
- **graceful-quiesce.AC2.7 Success:** Database connections close last
- **graceful-quiesce.AC2.8 Success:** Process exits with code 0 after successful quiesce

### graceful-quiesce.AC3: Drain Timeouts
- **graceful-quiesce.AC3.1 Success:** Each subsystem's `drain()` has a configurable timeout (default 10s)
- **graceful-quiesce.AC3.2 Success:** Subsystem exceeding its drain timeout is logged and skipped — shutdown continues
- **graceful-quiesce.AC3.3 Success:** Total quiesce timeout (default 30s) kills the process if drain sequence hasn't completed
- **graceful-quiesce.AC3.4 Edge:** Subsystem that completes drain instantly does not wait for timeout

### graceful-quiesce.AC4: Quiescing Flag
- **graceful-quiesce.AC4.1 Success:** `isQuiescing` is `false` during normal operation
- **graceful-quiesce.AC4.2 Success:** `isQuiescing` is `true` once quiesce begins
- **graceful-quiesce.AC4.3 Success:** Tools check `isQuiescing` before starting long-running operations (shell sessions, web fetches)
- **graceful-quiesce.AC4.4 Success:** Scheduler does not dispatch new tasks when quiescing

### graceful-quiesce.AC5: Pre-Compaction Flush
- **graceful-quiesce.AC5.1 Success:** Before compaction rewrites conversation history, all pending memory writes are flushed
- **graceful-quiesce.AC5.2 Success:** Pre-compaction flush uses the same `drain()` interface as shutdown
- **graceful-quiesce.AC5.3 Edge:** Pre-compaction flush does not trigger full shutdown — only flushes writes, then compaction proceeds

### graceful-quiesce.AC6: Data Integrity
- **graceful-quiesce.AC6.1 Success:** No memory blocks are partially written after graceful shutdown
- **graceful-quiesce.AC6.2 Success:** No trace recordings are lost after graceful shutdown
- **graceful-quiesce.AC6.3 Success:** Conversation state is consistent after graceful shutdown (no orphaned tool calls)
- **graceful-quiesce.AC6.4 Failure:** Hard kill (SIGKILL) may lose in-flight data — this is acceptable and expected

## Architecture

### Components

**Drainable Interface** (`src/quiesce/types.ts`, Functional Core) — Interface that subsystems implement to participate in quiesce:

```typescript
interface Drainable {
  readonly name: string;
  drain(): Promise<void>;
}
```

**QuiesceProtocol** (`src/quiesce/protocol.ts`, Imperative Shell) — Orchestrator that holds an ordered list of `Drainable` subsystems and executes drain in sequence with per-subsystem timeouts. Manages the `isQuiescing` flag. Created by `createQuiesceProtocol(config)`.

**Signal Handler** (`src/quiesce/signals.ts`, Imperative Shell) — Registers SIGTERM and SIGINT handlers. Tracks whether quiesce is in progress for double-signal detection. Calls `protocol.execute()` on first signal, `process.exit(1)` on second.

**Composition Root Wiring** — `src/index.ts` registers all subsystems with the protocol in dependency-reverse order (agent last to register = first to drain).

### Contracts

```typescript
// src/quiesce/types.ts

interface Drainable {
  readonly name: string;
  drain(): Promise<void>;
}

type QuiesceConfig = {
  readonly perSubsystemTimeout: number;  // ms, default 10_000
  readonly totalTimeout: number;         // ms, default 30_000
};

interface QuiesceProtocol {
  register(subsystem: Drainable): void;
  execute(): Promise<void>;
  readonly isQuiescing: boolean;
}
```

```typescript
// src/quiesce/protocol.ts

function createQuiesceProtocol(config?: Partial<QuiesceConfig>): QuiesceProtocol;
```

```typescript
// src/quiesce/signals.ts

function installSignalHandlers(protocol: QuiesceProtocol): void;
```

### Shutdown Sequence

```
SIGTERM / SIGINT received
    │
    ▼
isQuiescing = true
    │
    ▼
┌─────────────────────────┐
│ 1. Agent loop            │ ← stop accepting messages, drain in-flight tool round
│    timeout: 10s          │
├─────────────────────────┤
│ 2. Shell session         │ ← destroy PTY if stateful-shell is active
│    timeout: 10s          │
├─────────────────────────┤
│ 3. Scheduler             │ ← flush pending task updates
│    timeout: 10s          │
├─────────────────────────┤
│ 4. Trace recorder        │ ← flush pending traces
│    timeout: 10s          │
├─────────────────────────┤
│ 5. Memory store          │ ← flush pending writes
│    timeout: 10s          │
├─────────────────────────┤
│ 6. MCP connections       │ ← close transports
│    timeout: 10s          │
├─────────────────────────┤
│ 7. Database pool         │ ← close connections
│    timeout: 10s          │
└─────────────────────────┘
    │
    ▼
process.exit(0)
```

If any subsystem exceeds its timeout, the orchestrator logs a warning and proceeds to the next. If the total timeout (30s) is exceeded, `process.exit(1)`.

### Existing Patterns

- **Composition root** — `src/index.ts` already creates all subsystems and wires dependencies. Quiesce registration happens at the same point.
- **Factory functions** — `createQuiesceProtocol()` follows the `createFoo()` pattern used throughout the codebase.
- **TraceRecorder** — Already a fire-and-forget interface. The `drain()` implementation flushes any buffered traces.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types and Protocol

**Goal:** Define the `Drainable` interface and implement the quiesce orchestrator with ordered drain and timeouts.

**Components:**
- `src/quiesce/types.ts` (Functional Core) — `Drainable`, `QuiesceConfig`, `QuiesceProtocol` types
- `src/quiesce/protocol.ts` (Imperative Shell) — `createQuiesceProtocol()` factory with ordered drain execution, per-subsystem timeout, total timeout, `isQuiescing` flag
- `src/quiesce/protocol.test.ts` — Tests: ordered drain execution, timeout handling (subsystem that hangs), total timeout, `isQuiescing` flag transitions, idempotent execution (calling execute twice)

**Dependencies:** None

**Covers:** graceful-quiesce.AC2 (shutdown order), graceful-quiesce.AC3 (drain timeouts), graceful-quiesce.AC4 (quiescing flag)

**Done when:** Protocol drains registered subsystems in order, respects timeouts, sets `isQuiescing` correctly. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Signal Handling

**Goal:** Wire SIGTERM/SIGINT to the quiesce protocol with double-signal force-exit.

**Components:**
- `src/quiesce/signals.ts` (Imperative Shell) — `installSignalHandlers()` function
- `src/quiesce/index.ts` (Imperative Shell) — Barrel exports
- `src/quiesce/signals.test.ts` — Tests: signal triggers quiesce, second signal exits, signal during quiesce doesn't restart

**Dependencies:** Phase 1

**Covers:** graceful-quiesce.AC1 (signal handling)

**Done when:** Signal handlers correctly trigger quiesce on first signal and force-exit on second. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Subsystem Drain Implementations

**Goal:** Add `Drainable` implementations to existing subsystems that have pending-write semantics.

**Components:**
- Agent loop (`src/agent/agent.ts`) — Add `drain()` that waits for in-flight tool round to complete or timeout, then stops accepting messages
- Memory store (`src/persistence/`) — Add `drain()` that flushes any pending writes (if batching is in use) and closes connections
- Trace recorder (`src/reflexion/`) — Add `drain()` that flushes buffered traces
- Scheduler (`src/scheduler/`) — Add `drain()` that marks in-progress tasks complete and stops dispatch
- MCP client (`src/mcp/`) — Add `drain()` that closes all transports

**Dependencies:** Phase 1

**Covers:** graceful-quiesce.AC2 (subsystem-specific drains), graceful-quiesce.AC6 (data integrity)

**Done when:** Each subsystem implements `Drainable` and correctly flushes or closes its resources. Unit tests verify each drain.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Composition Root Wiring and Pre-Compaction Flush

**Goal:** Register all subsystems with the protocol in the composition root. Add pre-compaction flush.

**Components:**
- `src/index.ts` — Register subsystems with `protocol.register()` in dependency-reverse order. Install signal handlers. Pass `isQuiescing` to tool dispatch and scheduler for guard checks.
- `src/compaction/compactor.ts` — Before compaction rewrites history, call `memoryStore.drain()` to flush pending writes
- `src/config/schema.ts` — Add `quiesce` config section: `per_subsystem_timeout`, `total_timeout`

**Dependencies:** Phase 2, Phase 3

**Covers:** graceful-quiesce.AC5 (pre-compaction flush), graceful-quiesce.AC4.3 (tool guard), graceful-quiesce.AC4.4 (scheduler guard)

**Done when:** Full shutdown sequence works end-to-end from signal to exit. Pre-compaction flush works. Build succeeds (`bun run build`).
<!-- END_PHASE_4 -->

## Additional Considerations

**PostgreSQL vs WAL:** Pattern's quiesce protocol checkpoints a WAL and calls fsync. Constellation uses PostgreSQL, where transaction commit already guarantees durability. The main risk is not partially-written data (PostgreSQL prevents that) but logically incomplete operations — e.g., an archive block written but the corresponding conversation messages not yet pruned. The agent loop drain handles this by completing the in-flight tool round before proceeding.

**REPL interaction:** Constellation runs as a REPL (`src/index.ts`). During quiesce, the REPL should print a shutdown message and stop reading input. The readline interface should be closed as part of the agent loop drain.

**Daemon mode:** When Constellation runs as a daemon (systemd, launchd), SIGTERM is the primary shutdown signal. The 30s total timeout should be less than the systemd `TimeoutStopSec` (default 90s) to ensure clean exit before the service manager escalates to SIGKILL.
