# Spawn Model Design

## Summary

Constellation has a single subconscious agent (`src/subconscious/`) but no general mechanism for spawning scoped child agents. Every subtask — summarise a document, explore an alternative approach, run an independent background investigation — must be handled inline by the main agent, polluting its context and consuming its turn budget.

Spawn Model introduces a `SpawnRegistry` and three distinct spawn paths: Ephemeral (bounded worker), Fork (memory snapshot), and Sibling (independent persona). Each path has different lifecycle semantics, memory isolation, and cleanup rules. The existing subconscious agent is refactored to use the Sibling spawn path, validating the abstraction against a real use case.

Ported from Pattern's three-path spawn model, adapted for Constellation's factory-function architecture, PostgreSQL-backed memory, and owner-scoped isolation. Pattern uses Rust's ownership model for RAII cleanup; Constellation uses explicit registry tracking with `AbortController`-based cancellation.

## Definition of Done

1. The agent can spawn Ephemeral workers that execute a bounded subtask and return a result.
2. The agent can spawn Forks that snapshot working memory and explore alternatives without affecting the parent.
3. The agent can spawn Siblings that run independently with their own memory and survive parent shutdown.
4. Active children are tracked in a registry with concurrency limits and RAII-style cleanup.
5. The existing subconscious agent is refactored to use Sibling spawn.
6. New tools (`spawn_worker`, `spawn_fork`, `spawn_sibling`) are registered in the tool registry.

## Acceptance Criteria

### spawn-model.AC1: Ephemeral Workers
- **spawn-model.AC1.1 Success:** `spawn_worker` creates a child agent with a task prompt that returns a result string
- **spawn-model.AC1.2 Success:** Worker inherits parent's tool set (or a configured subset via capability intersection)
- **spawn-model.AC1.3 Success:** Worker terminates after completing task, exceeding turn limit (default 10), or exceeding timeout (default 60s)
- **spawn-model.AC1.4 Success:** Worker result is returned to the parent as a tool result
- **spawn-model.AC1.5 Failure:** Worker that exceeds both timeout and turn limit is forcibly killed, partial output returned
- **spawn-model.AC1.6 Success:** Worker gets its own `owner` scope — memory writes are isolated from parent

### spawn-model.AC2: Fork Spawn
- **spawn-model.AC2.1 Success:** `spawn_fork` creates a child with a copy of parent's working memory blocks
- **spawn-model.AC2.2 Success:** Memory writes in the fork do not propagate to the parent
- **spawn-model.AC2.3 Success:** Memory writes in the parent after fork do not propagate to the child
- **spawn-model.AC2.4 Success:** Fork can be explicitly merged back (agent calls a merge tool that copies fork's new/modified memory blocks to parent)
- **spawn-model.AC2.5 Success:** Fork is dropped (memory cleaned up) when parent conversation ends, unless explicitly persisted
- **spawn-model.AC2.6 Edge:** Fork of a fork is allowed (creates a new snapshot from the child's current state)

### spawn-model.AC3: Sibling Spawn
- **spawn-model.AC3.1 Success:** `spawn_sibling` creates an independent agent session with its own memory, tools, and conversation
- **spawn-model.AC3.2 Success:** Sibling is not tracked by parent lifecycle — survives parent shutdown
- **spawn-model.AC3.3 Success:** Sibling has its own `owner` scope for complete isolation
- **spawn-model.AC3.4 Success:** Parent can send messages to sibling via the registry
- **spawn-model.AC3.5 Success:** Sibling cannot access parent's memory or conversation
- **spawn-model.AC3.6 Edge:** Existing subconscious agent refactored to use sibling spawn without behaviour change

### spawn-model.AC4: Registry and Concurrency
- **spawn-model.AC4.1 Success:** `SpawnRegistry` tracks all active children (ephemeral, fork, sibling)
- **spawn-model.AC4.2 Success:** Concurrency limit (configurable, default 3) blocks new spawns when at capacity
- **spawn-model.AC4.3 Success:** Registry exposes `list()` to enumerate active children with type and status
- **spawn-model.AC4.4 Success:** Registry exposes `kill(id)` to forcibly terminate a child
- **spawn-model.AC4.5 Success:** On parent agent shutdown: ephemeral children are killed, forks are dropped, siblings are left running

### spawn-model.AC5: Communication
- **spawn-model.AC5.1 Success:** Parent can send a message to a child via `sendToChild(id, message)`
- **spawn-model.AC5.2 Success:** Ephemeral workers return their final result to the parent automatically
- **spawn-model.AC5.3 Success:** Forks do not automatically communicate back — merge is explicit
- **spawn-model.AC5.4 Failure:** Direct child-to-child communication is not supported (must go through parent)

### spawn-model.AC6: Owner Isolation
- **spawn-model.AC6.1 Success:** Each child agent gets a unique `owner` string derived from parent owner + spawn type + ID
- **spawn-model.AC6.2 Success:** Memory store queries are scoped to owner — children cannot read parent's memory unless forked
- **spawn-model.AC6.3 Success:** Trace recordings include the child's owner for attribution
- **spawn-model.AC6.4 Success:** Scheduler tasks created by children are owned by the child, not the parent

### spawn-model.AC7: Tool Integration
- **spawn-model.AC7.1 Success:** `spawn_worker` tool takes `task` (prompt), `tools` (optional subset), `timeout` (optional), `max_turns` (optional)
- **spawn-model.AC7.2 Success:** `spawn_fork` tool takes `task` (prompt), `persist` (optional, default false)
- **spawn-model.AC7.3 Success:** `spawn_sibling` tool takes `name`, `system_prompt`, `tools` (optional subset)
- **spawn-model.AC7.4 Success:** All spawn tools return the child ID for subsequent interaction
- **spawn-model.AC7.5 Success:** `list_children` tool returns active children with type, status, and ID
- **spawn-model.AC7.6 Success:** `kill_child` tool terminates a specific child by ID

## Architecture

### Components

**SpawnRegistry** (`src/spawn/registry.ts`, Imperative Shell) — Tracks active children, enforces concurrency limits, handles cleanup on parent exit. Created by `createSpawnRegistry(config)`. Uses a `Map<string, ChildHandle>` internally.

**ChildHandle** (`src/spawn/types.ts`, Functional Core) — Union type representing an active child:

```typescript
type ChildHandle =
  | { readonly type: 'ephemeral'; readonly id: string; readonly abort: AbortController; readonly result: Promise<string>; }
  | { readonly type: 'fork'; readonly id: string; readonly abort: AbortController; readonly owner: string; readonly persisted: boolean; }
  | { readonly type: 'sibling'; readonly id: string; readonly owner: string; };
```

**Ephemeral Spawner** (`src/spawn/ephemeral.ts`, Imperative Shell) — Creates a short-lived agent loop with bounded turns and timeout. Uses `AbortController` for cancellation. Returns result string via the handle's `result` promise.

**Fork Spawner** (`src/spawn/fork.ts`, Imperative Shell) — Copies parent's working memory blocks to a new owner scope, creates a child agent loop with the snapshot. Merge copies new/modified blocks back to parent owner.

**Sibling Spawner** (`src/spawn/sibling.ts`, Imperative Shell) — Creates an independent agent session with fresh memory. Not bound to parent lifecycle. The existing subconscious agent refactored to use this path.

**Spawn Tools** (`src/tool/spawn-worker.ts`, `src/tool/spawn-fork.ts`, `src/tool/spawn-sibling.ts`, `src/tool/list-children.ts`, `src/tool/kill-child.ts`, Imperative Shell) — Tool definitions that delegate to the registry and spawners.

### Contracts

```typescript
// src/spawn/types.ts

type SpawnConfig = {
  readonly maxChildren: number;       // default 3
  readonly ephemeralTimeout: number;   // ms, default 60_000
  readonly ephemeralMaxTurns: number;  // default 10
  readonly forkTimeout: number;        // ms, default 300_000
};

type ChildInfo = {
  readonly id: string;
  readonly type: 'ephemeral' | 'fork' | 'sibling';
  readonly owner: string;
  readonly status: 'running' | 'completed' | 'failed' | 'killed';
  readonly createdAt: Date;
};

interface SpawnRegistry {
  spawnEphemeral(task: string, opts?: EphemeralOpts): Promise<string>;  // returns child ID
  spawnFork(task: string, opts?: ForkOpts): Promise<string>;
  spawnSibling(name: string, systemPrompt: string, opts?: SiblingOpts): Promise<string>;
  sendMessage(childId: string, message: string): Promise<void>;
  awaitResult(childId: string): Promise<string>;
  kill(childId: string): Promise<void>;
  list(): ReadonlyArray<ChildInfo>;
  drainEphemeral(): Promise<void>;  // kill all ephemeral + drop forks (for parent shutdown)
  readonly activeCount: number;
}

type EphemeralOpts = {
  readonly tools?: ReadonlyArray<string>;  // tool name subset
  readonly timeout?: number;
  readonly maxTurns?: number;
};

type ForkOpts = {
  readonly persist?: boolean;
};

type SiblingOpts = {
  readonly tools?: ReadonlyArray<string>;
};
```

```typescript
// src/spawn/registry.ts

function createSpawnRegistry(
  config: SpawnConfig,
  agentFactory: AgentFactory,
  memoryStore: MemoryStore,
  traceRecorder?: TraceRecorder,
): SpawnRegistry;
```

### Owner Scoping

Each child agent gets a deterministic owner string:

- Ephemeral: `{parentOwner}/ephemeral/{childId}`
- Fork: `{parentOwner}/fork/{childId}`
- Sibling: `{siblingName}` (independent, no parent prefix)

This leverages the existing `owner` field in memory blocks, scheduler tasks, and trace recordings. All stores already filter by owner, so isolation is automatic.

### Lifecycle Diagram

```
Parent Agent
    │
    ├── spawn_worker("summarise X")
    │       │
    │       ▼
    │   Ephemeral child
    │       ├── runs up to 10 turns or 60s
    │       ├── result returned to parent
    │       └── cleaned up (memory deleted)
    │
    ├── spawn_fork("explore alternative")
    │       │
    │       ▼
    │   Fork child (working memory snapshot)
    │       ├── independent exploration
    │       ├── merge_fork() → copies blocks back
    │       └── dropped on parent exit (unless persisted)
    │
    └── spawn_sibling("subconscious", "...")
            │
            ▼
        Sibling (independent lifecycle)
            ├── own memory, own conversation
            ├── survives parent shutdown
            └── parent can send messages
```

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types and Registry

**Goal:** Define spawn types and implement the registry with concurrency limits and lifecycle tracking.

**Components:**
- `src/spawn/types.ts` (Functional Core) — `SpawnConfig`, `ChildHandle`, `ChildInfo`, `SpawnRegistry` interface, option types
- `src/spawn/registry.ts` (Imperative Shell) — `createSpawnRegistry()` factory with `Map`-based tracking, concurrency semaphore, `list()`, `kill()`, `drainEphemeral()`
- `src/spawn/registry.test.ts` — Tests: concurrency limit enforcement, list/kill operations, drain cleanup

**Dependencies:** None

**Covers:** spawn-model.AC4 (registry and concurrency)

**Done when:** Registry tracks children, enforces limits, and cleans up correctly. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Ephemeral Workers

**Goal:** Implement ephemeral spawn path with bounded execution and result passing.

**Components:**
- `src/spawn/ephemeral.ts` (Imperative Shell) — Creates a minimal agent loop with turn counter, `AbortController` timeout, tool subset filtering. Returns result string.
- `src/spawn/ephemeral.test.ts` — Tests: successful task completion, turn limit exceeded, timeout exceeded, tool subset restriction, owner isolation

**Dependencies:** Phase 1, existing agent loop infrastructure

**Covers:** spawn-model.AC1 (ephemeral workers), spawn-model.AC5.2 (result return), spawn-model.AC6 (owner isolation)

**Done when:** Ephemeral workers execute bounded subtasks and return results. Timeout and turn limits enforced. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Fork Spawn

**Goal:** Implement fork spawn with memory snapshot, isolation, and merge-back capability.

**Components:**
- `src/spawn/fork.ts` (Imperative Shell) — Copies working memory blocks to fork owner, creates child agent. Merge function copies new/modified blocks from fork owner to parent owner.
- `src/spawn/fork.test.ts` — Tests: memory snapshot at fork time, write isolation both directions, merge-back, fork-of-fork, cleanup on parent exit

**Dependencies:** Phase 1, existing memory store

**Covers:** spawn-model.AC2 (fork spawn), spawn-model.AC5.3 (explicit merge)

**Done when:** Forks get memory snapshots, writes are isolated, merge works correctly. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Sibling Spawn and Subconscious Refactor

**Goal:** Implement sibling spawn and refactor the existing subconscious agent to use it.

**Components:**
- `src/spawn/sibling.ts` (Imperative Shell) — Creates independent agent session with fresh memory and own owner. Not tracked by parent lifecycle.
- `src/spawn/index.ts` (Imperative Shell) — Barrel exports for the module
- `src/subconscious/` — Refactor to use `registry.spawnSibling()` instead of bespoke agent creation. Verify no behaviour change.
- `src/spawn/sibling.test.ts` — Tests: independent lifecycle, own memory scope, parent message delivery, survives parent shutdown

**Dependencies:** Phase 1

**Covers:** spawn-model.AC3 (sibling spawn), spawn-model.AC3.6 (subconscious refactor)

**Done when:** Siblings run independently. Subconscious refactored without behaviour change. All tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Tools and Agent Integration

**Goal:** Register spawn tools, wire registry to composition root, add config fields.

**Components:**
- `src/tool/spawn-worker.ts` (Imperative Shell) — `spawn_worker` tool definition
- `src/tool/spawn-fork.ts` (Imperative Shell) — `spawn_fork` tool definition
- `src/tool/spawn-sibling.ts` (Imperative Shell) — `spawn_sibling` tool definition
- `src/tool/list-children.ts` (Imperative Shell) — `list_children` tool definition
- `src/tool/kill-child.ts` (Imperative Shell) — `kill_child` tool definition
- `src/config/schema.ts` — Add `spawn` config section: `max_children`, `ephemeral_timeout`, `ephemeral_max_turns`, `fork_timeout`
- `src/index.ts` — Create registry at startup, pass to tool registration, wire `drainEphemeral()` to quiesce protocol (if available)

**Dependencies:** Phases 2, 3, 4

**Covers:** spawn-model.AC7 (tool integration), spawn-model.AC5 (communication)

**Done when:** All spawn tools are registered and functional. Config is wired. Registry integrates with shutdown. Build succeeds (`bun run build`).
<!-- END_PHASE_5 -->

## Additional Considerations

**Agent factory:** Spawning children requires creating new agent loop instances. This implies an `AgentFactory` interface that the composition root provides — a function that creates a configured agent loop with specified owner, tools, and system prompt. This factory likely already exists implicitly in `src/index.ts`; it needs to be extracted and formalised.

**Token cost:** Each child agent consumes its own model calls. Ephemeral workers with 10-turn limits can use up to 10x the parent's per-turn token cost. The concurrency limit (default 3) provides a ceiling, but cost monitoring should be considered for production use.

**Memory cleanup:** Ephemeral workers and dropped forks should have their memory blocks deleted after termination. This requires a `deleteByOwner(owner: string)` method on the memory store. If this doesn't exist, it should be added in Phase 1 as a prerequisite.

**Subconscious migration:** The subconscious agent (`src/subconscious/`) currently has bespoke agent creation logic. Refactoring it to use sibling spawn should be a behaviour-preserving change — same system prompt, same tools, same memory scope. The key difference is that lifecycle management moves from bespoke code to the registry.
