# Machine Spirit Core Implementation Plan - Phase 7: Extension Point Interfaces & Interaction Loop

**Goal:** Define extension point contracts (DataSource, Coordinator, Scheduler, ToolProvider) and build the full entry point with stdin/stdout REPL, pending mutation approval flow, and graceful shutdown.

**Architecture:** Extension interfaces are contracts only — no implementation in this slice. The entry point (`src/index.ts`) is the composition root that wires all adapters together using config, starts the REPL loop, and handles lifecycle (startup, shutdown, signal handling).

**Tech Stack:** Bun, TypeScript, readline for stdin interaction, all prior modules

**Scope:** 8 phases from original design (this is phase 7 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phases 1-6 provide all modules. `src/index.ts` exists as a placeholder from Phase 1.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC5: Extension point interfaces
- **machine-spirit-core.AC5.1 Success:** DataSource, Coordinator, Scheduler, and ToolProvider interfaces compile and are exported
- **machine-spirit-core.AC5.2 Success:** Extension interfaces are documented with their intended purpose

### machine-spirit-core.AC6: Minimal interaction mechanism
- **machine-spirit-core.AC6.1 Success:** Running `bun run src/index.ts` starts the daemon and accepts input via stdin
- **machine-spirit-core.AC6.2 Success:** Pending Familiar mutations surface in the interaction loop for approval/rejection
- **machine-spirit-core.AC6.3 Success:** SIGINT/SIGTERM triggers graceful shutdown (flush pending writes, close DB, kill Deno subprocesses)

---

<!-- START_TASK_1 -->
### Task 1: Extension point interfaces

**Verifies:** machine-spirit-core.AC5.1, machine-spirit-core.AC5.2

**Files:**
- Create: `src/extensions/data-source.ts`
- Create: `src/extensions/coordinator.ts`
- Create: `src/extensions/scheduler.ts`
- Create: `src/extensions/tool-provider.ts`
- Create: `src/extensions/index.ts`

**Implementation:**

These are contracts only — type definitions with JSDoc documentation. No implementation code.

**`src/extensions/data-source.ts`:**
```typescript
/**
 * DataSource represents an external data stream that produces and/or consumes messages.
 * Examples: Bluesky firehose, Discord channel, email inbox, webhook receiver.
 *
 * Implementations connect to an external service, emit incoming messages to a handler,
 * and optionally support sending outbound messages.
 */
export type IncomingMessage = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type OutgoingMessage = {
  readonly destination: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
};

export type DataSource = {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => void): void;
  send?(message: OutgoingMessage): Promise<void>;
};
```

**`src/extensions/coordinator.ts`:**
```typescript
/**
 * Coordinator handles multi-agent routing and orchestration.
 * Determines which agent should handle an incoming message when multiple agents are available.
 *
 * Coordination patterns include:
 * - Supervisor: a lead agent delegates to specialists
 * - RoundRobin: rotate through agents sequentially
 * - Pipeline: chain agents in sequence
 * - Voting: multiple agents respond, consensus selects winner
 */
export type CoordinationPattern = 'supervisor' | 'round_robin' | 'pipeline' | 'voting';

export type AgentRef = {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ReadonlyArray<string>;
};

export type AgentResponse = {
  readonly agentId: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
};

export type Coordinator = {
  readonly pattern: CoordinationPattern;
  route(message: IncomingMessage, agents: ReadonlyArray<AgentRef>): Promise<AgentRef>;
  onAgentResponse?(agent: AgentRef, response: AgentResponse): Promise<void>;
};
```

**`src/extensions/scheduler.ts`:**
```typescript
/**
 * Scheduler manages deferred and periodic tasks.
 * Enables "sleep time compute" — the agent performing background work between conversations.
 *
 * Use cases: periodic memory consolidation, scheduled data source polling,
 * deferred message delivery, background learning tasks.
 */
export type ScheduledTask = {
  readonly id: string;
  readonly name: string;
  readonly schedule: string; // cron expression or ISO timestamp
  readonly payload: Record<string, unknown>;
};

export type Scheduler = {
  schedule(task: ScheduledTask): Promise<void>;
  cancel(taskId: string): Promise<void>;
  onDue(handler: (task: ScheduledTask) => void): void;
};
```

**`src/extensions/tool-provider.ts`:**
```typescript
/**
 * ToolProvider represents an external source of tools that can be dynamically discovered and executed.
 * Examples: MCP servers, plugin systems, remote tool registries.
 *
 * Tools discovered via ToolProvider are registered with the ToolRegistry and become available
 * to the agent alongside built-in tools.
 */
export type ToolProvider = {
  readonly name: string;
  discover(): Promise<Array<ToolDefinition>>;
  execute(tool: string, params: Record<string, unknown>): Promise<ToolResult>;
};
```

Import `ToolDefinition` and `ToolResult` from `src/tool/types.ts`, and `IncomingMessage` in coordinator from `data-source.ts`.

**`src/extensions/index.ts`:** Barrel export all extension types.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors — all interfaces compile

**Commit:** `feat: add extension point interfaces (DataSource, Coordinator, Scheduler, ToolProvider)`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Entry point with REPL and wiring

**Verifies:** machine-spirit-core.AC6.1, machine-spirit-core.AC6.2, machine-spirit-core.AC6.3

**Files:**
- Modify: `src/index.ts` (replace placeholder from Phase 1)

**Implementation:**

The entry point is the composition root. It:

1. **Loads config** via `loadConfig()`

2. **Creates providers:**
   - `createPostgresProvider(config.database)` -> PersistenceProvider
   - `createModelProvider(config.model)` -> ModelProvider
   - `createEmbeddingProvider(config.embedding)` -> EmbeddingProvider

3. **Connects to database** and runs migrations

4. **Creates domain modules:**
   - `createPostgresMemoryStore(persistence)` -> MemoryStore
   - `createMemoryManager(store, embedding, 'spirit')` -> MemoryManager
   - `createToolRegistry()` -> ToolRegistry, register built-in tools from `createMemoryTools(memory)`
   - Register `execute_code` tool definition (handled specially in agent loop, but needs to be in the tool definitions sent to the model)
   - `createDenoExecutor(config.runtime & config.agent, registry)` -> CodeRuntime
   - `createAgent({ model, memory, registry, runtime, persistence, config: config.agent })` -> Agent

5. **REPL loop (AC6.1):**
   - Use Bun's `console.write()` / `process.stdin` or a readline interface for stdin/stdout interaction
   - Print a prompt (e.g., `> `)
   - Read a line from stdin
   - Before processing the message, check for pending mutations (AC6.2)
   - Send the message to `agent.processMessage(userMessage)`
   - Print the response to stdout
   - Loop

6. **Pending mutation flow (AC6.2):**
   - Before each message processing (or after each response), call `memory.getPendingMutations()`
   - If there are pending mutations, display them:
     ```
     [Pending mutation] Block: "core:persona"
     Proposed change: "I am a curious and creative machine spirit..."
     Reason: "Updating persona based on our conversations"
     Approve? (y/n/feedback):
     ```
   - Read user input: `y` -> `memory.approveMutation(id)`, `n` or text -> `memory.rejectMutation(id, feedback)`
   - Process all pending mutations before continuing to the next user message

7. **Graceful shutdown (AC6.3):**
   - Register handlers for `SIGINT` and `SIGTERM` via `process.on('SIGINT', ...)`
   - On signal: print "Shutting down...", close the readline interface, disconnect persistence (`persistence.disconnect()`), exit cleanly
   - The persistence provider's disconnect flushes the connection pool

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add entry point with REPL, mutation approval, and graceful shutdown`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Interaction loop tests

**Verifies:** machine-spirit-core.AC6.1, machine-spirit-core.AC6.2, machine-spirit-core.AC6.3

**Files:**
- Test: `src/index.test.ts` (unit — with mocked dependencies)

**Testing:**

These tests verify the wiring and interaction logic without starting a full daemon. Extract the REPL loop logic into a testable function (e.g., `createInteractionLoop(agent, memory, readline)`) that can be tested with mock readline input.

- **machine-spirit-core.AC6.1:** Verify that `createInteractionLoop` processes a line of input by calling `agent.processMessage()` and outputs the response.

- **machine-spirit-core.AC6.2:** Mock `memory.getPendingMutations()` to return a pending mutation. Verify the loop surfaces it before processing the next message. Mock readline to provide 'y' input, verify `memory.approveMutation()` is called. Similarly test rejection with feedback.

- **machine-spirit-core.AC6.3:** Verify that calling the shutdown handler invokes `persistence.disconnect()` and resolves cleanly.

**Verification:**
Run: `bun test src/index.test.ts`
Expected: All tests pass

**Commit:** `test: add interaction loop tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
