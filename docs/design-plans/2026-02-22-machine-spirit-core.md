# Machine Spirit Core Design

## Summary

Constellation's machine spirit core is a stateful AI agent daemon — a single conversational agent that persists across restarts, manages her own memory, and can extend her own capabilities by writing and executing code. Rather than a stateless request-response setup, the agent maintains a three-tier memory system (core identity, working context, and archival history), keeps conversation state in Postgres, and runs continuously as a long-lived Bun process. The goal of this slice is to establish the foundational plumbing: the agent loop, memory system, LLM provider abstraction, and sandboxed code execution runtime.

The architecture follows a ports-and-adapters pattern throughout — every major concern (model, memory, embedding, persistence, code execution) is defined as an interface first, with swappable implementations wired together at the entry point. This means the Anthropic adapter and an Ollama-backed local model are interchangeable at config time, and each subsystem is independently testable. The agent is deliberately given only four built-in tools; rather than hard-coding specialist capabilities, she writes TypeScript code that runs in a Deno subprocess with tightly scoped permissions — this is the primary mechanism for extending what she can do.

## Definition of Done

A stateful, self-evolving agent system ("machine spirit") running as a Bun daemon with MemGPT-style memory, multi-provider LLM support, and a Deno code execution runtime — designed as the core first slice of a larger constellation platform.

**Deliverables:**

1. **Stateful agent daemon** on Bun maintaining conversation state and three-tier memory (core/working/archival) persisted to a database
2. **Provider abstraction** supporting Anthropic (native client) and OpenAI-compatible endpoints (Kimi, Ollama, others) with a clean interface for adding providers
3. **Deno code execution runtime** with controlled permissions (network, file read/write) where the agent writes and executes code to extend her capabilities — including calling external APIs, building artifacts, and filesystem interaction
4. **Clean separation of concerns** — memory, agent loop, provider abstraction, code runtime, and persistence are independent modules with well-defined interfaces, each buildable and testable in isolation
5. **Extension point interfaces** (contracts only, no implementation) for: multi-agent coordination, data sources (Bluesky etc.), sleep time compute, and additional tool types
6. **Minimal interaction mechanism** — stdin/stdout loop for development-time conversation

**Out of scope for this slice:**
- Multi-agent coordination implementation (interface only)
- Bluesky/AT Protocol integration (interface only)
- Sleep time compute (interface only)
- CLI/TUI beyond basic stdin/stdout
- Web UI or API server

## Acceptance Criteria

### machine-spirit-core.AC1: Stateful agent daemon maintains conversation state and three-tier memory

- **machine-spirit-core.AC1.1 Success:** Agent receives a message via stdin, processes it through the model, and returns a response to stdout
- **machine-spirit-core.AC1.2 Success:** Conversation history persists to Postgres and survives daemon restart
- **machine-spirit-core.AC1.3 Success:** Core memory blocks are always present in the system prompt sent to the model
- **machine-spirit-core.AC1.4 Success:** Working memory blocks load into context and can be swapped in/out by the agent
- **machine-spirit-core.AC1.5 Success:** Archival memory blocks are retrievable via semantic search (pgvector)
- **machine-spirit-core.AC1.6 Success:** Memory writes generate embeddings and persist to Postgres
- **machine-spirit-core.AC1.7 Success:** Every memory mutation is recorded in the event log with old/new content
- **machine-spirit-core.AC1.8 Failure:** Writing to a ReadOnly block returns an error to the agent
- **machine-spirit-core.AC1.9 Success:** Writing to a Familiar block queues a pending mutation instead of applying immediately
- **machine-spirit-core.AC1.10 Success:** Approved Familiar mutations apply the change and notify the agent
- **machine-spirit-core.AC1.11 Success:** Rejected Familiar mutations notify the agent with the familiar's feedback
- **machine-spirit-core.AC1.12 Edge:** Context compression triggers when conversation history exceeds the configured budget, replacing old messages with summaries

### machine-spirit-core.AC2: Provider abstraction supports Anthropic and OpenAI-compatible endpoints

- **machine-spirit-core.AC2.1 Success:** Anthropic adapter sends messages and receives normalised ModelResponse with text and tool use blocks
- **machine-spirit-core.AC2.2 Success:** Anthropic adapter streams responses as AsyncIterable of StreamEvents
- **machine-spirit-core.AC2.3 Success:** OpenAI-compatible adapter works with configurable baseURL (Kimi, Ollama)
- **machine-spirit-core.AC2.4 Success:** Switching provider via config.toml changes the model without code changes
- **machine-spirit-core.AC2.5 Failure:** Invalid API key returns a structured error, not a crash
- **machine-spirit-core.AC2.6 Failure:** Model API timeout triggers retry with exponential backoff (3 attempts)

### machine-spirit-core.AC3: Deno code execution runtime with controlled permissions

- **machine-spirit-core.AC3.1 Success:** Agent can write TypeScript code and execute it in a Deno subprocess
- **machine-spirit-core.AC3.2 Success:** Code can make network requests to hosts on the allowlist
- **machine-spirit-core.AC3.3 Success:** Code can read and write files within the scoped working directory
- **machine-spirit-core.AC3.4 Success:** Code can call host-side tools (memory, etc.) via the IPC bridge and receive results
- **machine-spirit-core.AC3.5 Failure:** Code attempting to spawn subprocesses is denied by Deno permissions
- **machine-spirit-core.AC3.6 Failure:** Code attempting to access environment variables is denied
- **machine-spirit-core.AC3.7 Failure:** Code exceeding the timeout is killed and returns an error to the agent
- **machine-spirit-core.AC3.8 Failure:** Code exceeding max size (50KB) is rejected before execution
- **machine-spirit-core.AC3.9 Edge:** Network requests to hosts not on the allowlist are denied

### machine-spirit-core.AC4: Clean separation of concerns

- **machine-spirit-core.AC4.1 Success:** Each module (memory, model, embedding, runtime, tool, persistence) has a types.ts defining its port interface
- **machine-spirit-core.AC4.2 Success:** The agent loop depends only on port interfaces, not adapter implementations
- **machine-spirit-core.AC4.3 Success:** Each module is independently testable with mock implementations of its dependencies

### machine-spirit-core.AC5: Extension point interfaces

- **machine-spirit-core.AC5.1 Success:** DataSource, Coordinator, Scheduler, and ToolProvider interfaces compile and are exported
- **machine-spirit-core.AC5.2 Success:** Extension interfaces are documented with their intended purpose

### machine-spirit-core.AC6: Minimal interaction mechanism

- **machine-spirit-core.AC6.1 Success:** Running `bun run src/index.ts` starts the daemon and accepts input via stdin
- **machine-spirit-core.AC6.2 Success:** Pending Familiar mutations surface in the interaction loop for approval/rejection
- **machine-spirit-core.AC6.3 Success:** SIGINT/SIGTERM triggers graceful shutdown (flush pending writes, close DB, kill Deno subprocesses)
- **machine-spirit-core.AC6.4 Success:** First run with empty database seeds core memory blocks from persona configuration

## Glossary

- **Machine spirit**: The name for the stateful agent instance in this system — a long-lived conversational AI with persistent memory and self-extending capabilities.
- **Daemon**: A long-running background process. Here, a Bun process that stays alive between conversations rather than starting fresh per request.
- **MemGPT**: A research paper and system architecture that introduced tiered memory for LLMs, allowing agents to manage what fits in the context window and offload the rest. The memory model here is directly inspired by it.
- **Three-tier memory (Core / Working / Archival)**: Core is always in the system prompt (identity, persona). Working is in the active context window and can be swapped. Archival lives in the database and is retrieved via semantic search when needed.
- **Context window**: The finite amount of text an LLM can process in a single call. Memory management in this system exists primarily to stay within this limit.
- **Familiar**: The human counterpart in the agent's relationship model. Certain memory blocks require the familiar's approval to modify (e.g., the agent's own persona).
- **Permission model (ReadOnly / Familiar / Append / ReadWrite)**: A per-block access control system governing who can modify a given memory block and under what conditions.
- **Pending mutation**: A deferred memory write that requires human (familiar) approval before being applied. Queued in the database, surfaced in the interaction loop.
- **Event sourcing**: Recording every state change as an immutable log entry rather than overwriting. Used here so the agent (and the familiar) can inspect the full history of memory evolution.
- **Semantic search**: Retrieving records by meaning rather than exact match, using vector embeddings and distance calculations. Used for archival memory retrieval.
- **pgvector**: A PostgreSQL extension that adds vector storage and similarity search. Used here to store and query memory embeddings.
- **Embedding**: A numerical vector representation of a piece of text that captures its semantic meaning, enabling similarity comparisons.
- **Ports and adapters (hexagonal architecture)**: A design pattern where each subsystem exposes an abstract interface (port) and concrete implementations (adapters) are swapped in at the composition root. The agent loop only imports ports, never adapters.
- **Bun**: A JavaScript/TypeScript runtime (like Node.js) that serves as the host process for the daemon.
- **Deno**: A separate JavaScript/TypeScript runtime used as the sandboxed code execution environment. Chosen for its fine-grained permission system.
- **IPC (Inter-Process Communication)**: The mechanism for the Bun host and Deno subprocess to exchange messages. Implemented here as JSON lines over stdin/stdout.
- **Sandbox**: An isolated execution environment with restricted permissions. Here, Deno runs agent-written code with explicit allowlists for network, filesystem, and denied access to subprocesses and environment variables.
- **Prompt caching**: An Anthropic API feature that caches portions of the prompt (e.g., system instructions) to reduce latency and cost on repeated calls.
- **OpenAI-compatible endpoint**: Any API server implementing the OpenAI chat completions specification. Allows non-OpenAI models (Kimi, Ollama) to be used via the same adapter.
- **Kimi**: A model/API from Moonshot AI, accessible via an OpenAI-compatible endpoint (`api.moonshot.ai/v1`).
- **Ollama**: A local model serving tool that runs open-weight models on-device and exposes an OpenAI-compatible API.
- **AsyncIterable**: A TypeScript/JavaScript construct for consuming streams of values asynchronously. Used here for streaming LLM responses.
- **Zod**: A TypeScript schema validation library. Used to validate and type-narrow configuration loaded from `config.toml`.
- **Extension point**: An interface defined now but not implemented in this slice — a contract for future features (multi-agent coordination, Bluesky integration, scheduling).
- **Sleep time compute**: A planned capability for the agent to perform background work between conversations (deferred to a future slice).
- **REPL (Read-Eval-Print Loop)**: An interactive input loop. Here, the stdin/stdout interaction mechanism used during development.
- **Context compression**: When conversation history exceeds the context budget, older messages are summarised and moved to archival memory, keeping the active context within the model's window.
- **Persona**: The agent's self-description and identity, stored as a Core memory block with Familiar permission (changes require human approval).

## Architecture

Layered services with ports & adapters. Each domain concern is a module with a well-defined interface (port). Implementations (adapters) are swappable. The agent loop imports ports, not adapters. Wiring happens at the entry point.

### Module Structure

```
constellation/
├── src/
│   ├── index.ts              # Entry point, wiring, daemon lifecycle
│   ├── agent/                # Agent loop & conversation management
│   │   ├── agent.ts          # Core agent loop (message → context → model → tool dispatch → iterate)
│   │   ├── context.ts        # System prompt construction from memory blocks
│   │   └── types.ts          # AgentConfig, AgentState
│   ├── memory/               # MemGPT-style three-tier memory
│   │   ├── types.ts          # MemoryBlock, MemoryTier, MemoryPermission
│   │   ├── manager.ts        # MemoryManager (orchestrates tiers, context window, pending mutations)
│   │   └── store.ts          # MemoryStore port (interface for persistence)
│   ├── model/                # LLM provider abstraction
│   │   ├── types.ts          # ModelProvider port, Message, ToolDefinition, ModelResponse
│   │   ├── anthropic.ts      # Anthropic adapter (native SDK, streaming, prompt caching)
│   │   └── openai-compat.ts  # OpenAI-compatible adapter (Kimi, Ollama, etc.)
│   ├── embedding/            # Embedding provider abstraction
│   │   ├── types.ts          # EmbeddingProvider port
│   │   ├── openai.ts         # OpenAI embeddings adapter
│   │   └── ollama.ts         # Ollama embeddings adapter
│   ├── runtime/              # Code execution sandbox
│   │   ├── types.ts          # CodeRuntime port, ExecutionResult
│   │   ├── executor.ts       # DenoExecutor (subprocess management, IPC)
│   │   └── deno/             # Files deployed into the Deno sandbox
│   │       └── runtime.ts    # Deno-side IPC bridge, tool stubs
│   ├── tool/                 # Tool registry & built-in tools
│   │   ├── types.ts          # Tool port, ToolParameter, ToolResult
│   │   ├── registry.ts       # ToolRegistry (registration, dispatch)
│   │   └── builtin/          # Built-in tool definitions
│   ├── persistence/          # Database abstraction
│   │   ├── types.ts          # PersistenceProvider port
│   │   ├── postgres.ts       # PostgreSQL + pgvector adapter
│   │   └── migrations/       # Schema migrations (plain SQL files)
│   ├── config/               # Configuration loading
│   │   └── config.ts         # TOML/env config, typed AppConfig
│   └── extensions/           # Extension point interfaces (contracts only)
│       ├── data-source.ts    # DataSource port (Bluesky, etc.)
│       ├── coordinator.ts    # CoordinationPattern port (multi-agent)
│       └── scheduler.ts      # Scheduler port (sleep time)
├── package.json
├── tsconfig.json
├── bunfig.toml
└── config.toml
```

### Memory Architecture

Three-tier memory inspired by MemGPT, updated with the insight that memory tools should feel native to the model rather than forcing artificial wrappers.

**Memory Tiers:**

| Tier | Purpose | Visibility | Lifecycle |
|---|---|---|---|
| Core | Identity, persona, stable knowledge about self and key relationships | Always in system prompt | Rarely modified, permission-gated |
| Working | Current conversation context, recent observations, active tasks | In context window, managed by the agent | Swapped in/out as context fills |
| Archival | Past conversations, learned facts, patterns, user profiles | Retrieved via semantic search | Grows indefinitely, never auto-deleted |

**Memory Block:**

Each memory is a discrete record with metadata: `id`, `owner` (which agent), `tier` (core/working/archival), `label` (human-readable name like "persona" or "user:alice"), `content` (the text), `embedding` (pgvector), `permission`, `pinned` (stays in context during compression), and timestamps.

**Permission Model:**

| Permission | Who Can Modify | Use Case |
|---|---|---|
| ReadOnly | Nobody (set at config time) | System instructions, architectural constraints |
| Familiar | Requires human approval | Persona, facts about the familiar, relationship notes |
| Append | Agent can add, not rewrite | Observation logs, interaction history |
| ReadWrite | Agent freely modifies | Working memory, learned facts, user profiles |

Core memory block permissions: `core:system` is ReadOnly (she can't change how she works). `core:persona` is Familiar (she can propose identity changes, but the familiar confirms — identity is negotiated, not dictated). `core:familiar` is Familiar (she can't silently revise her understanding of her familiar).

**Pending Mutations:** When a tool call modifies a Familiar-permissioned block, the change is queued in a `pending_mutations` table rather than applied immediately. The mutation surfaces to the familiar via the interaction interface. On approval it applies; on rejection the agent receives feedback.

**Context Window Management:** The MemoryManager builds system prompts from Core blocks, loads Working blocks into context, and tracks token usage. When history exceeds the context budget (configurable, default 80% of model window), older messages are summarised and moved to archival memory — searchable via `memory_read` but no longer in the active context.

**Event Sourcing:** Every memory mutation appends to a `memory_events` table (event_type, block_id, old_content, new_content, timestamp). The agent can query her own history to reason about how her understanding has evolved.

### Provider Abstraction

**LLM Providers (`ModelProvider` port):**

```typescript
interface ModelProvider {
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<StreamEvent>;
}
```

Two adapters:
- `AnthropicAdapter` — wraps `@anthropic-ai/sdk`. Native tool use, streaming, prompt caching via cache control headers.
- `OpenAICompatAdapter` — wraps `openai` npm package with configurable `baseURL`. Covers Kimi (`api.moonshot.ai/v1`), Ollama (`localhost:11434/v1`), and anything else implementing the OpenAI chat completions spec.

Adapters normalise responses to a common `ModelResponse` type: text blocks, tool use blocks, stop reason, usage stats.

**Embedding Providers (`EmbeddingProvider` port):**

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

Two adapters: `OpenAIEmbeddingAdapter` (text-embedding-3-small/large) and `OllamaEmbeddingAdapter` (nomic-embed-text, qwen3, etc. via network Ollama instance). The `dimensions` property configures the pgvector column size.

### Code Execution Runtime

The agent writes and executes TypeScript in a Deno sandbox with controlled permissions. This is the primary mechanism for extending her capabilities beyond the built-in tools.

**Sandbox permissions:**

| Permission | Setting | Rationale |
|---|---|---|
| `--allow-net` | Configurable allowlist | Call APIs, fetch pages, talk to services. Allowlist prevents exfiltration. |
| `--allow-read` | Scoped to working dir + deno runtime | Read files she's working with |
| `--allow-write` | Scoped to working dir | Create files, build artifacts |
| `--deny-run` | Always denied | No subprocess spawning |
| `--deny-env` | Always denied | No host environment variable access |
| `--deny-ffi` | Always denied | No native code execution |

**IPC Protocol:** JSON lines over stdin/stdout between Bun host and Deno subprocess. Messages from Deno: `__tool_call__` (invoke host-side tool), `__output__` (return data to agent), `__debug__` (logging). Messages from Host: `__tool_result__`, `__tool_error__`.

**Capabilities:** One-off scripts, external API calls (including calling Claude to build things), file operations in working directory, complex memory operations via tool bridge, artifact generation. Each execution is a fresh subprocess — no state leaks between executions.

**Limits:** Max code size (50KB), execution timeout (60s), max tool calls per execution (25), max output size (1MB). All configurable.

### Agent Loop

The core orchestrator receives messages, builds context, calls the model, dispatches tools and code execution, and manages conversation state.

**Flow:** Message arrives → MemoryManager builds context (Core blocks → system prompt, Working blocks → context, conversation history → messages) → ModelProvider.stream(request) → handle response. On `end_turn`: extract text, persist to history, return. On `tool_use`: dispatch to ToolRegistry or DenoExecutor, collect results, append to messages, loop back to model. Max tool rounds enforced (default 20).

**Tools exposed to the model:**

| Tool | Purpose |
|---|---|
| `memory_read(query)` | Semantic search across memory tiers |
| `memory_write(label, content, tier?)` | Store or update a memory block |
| `memory_list(tier?)` | List loaded/available memory blocks |
| `execute_code(code)` | Run TypeScript in the Deno sandbox |

Four tools. The code runtime handles everything else — if she needs a capability that doesn't exist as a built-in, she writes code for it.

**Conversation compression:** When history exceeds context budget, older messages are summarised by the model and replaced with a summary block. Full messages move to archival memory, searchable via `memory_read`.

### Extension Point Interfaces

Contracts only — no implementation in this slice.

```typescript
interface DataSource {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => void): void;
  send?(message: OutgoingMessage): Promise<void>;
}

interface Coordinator {
  pattern: CoordinationPattern;
  route(message: IncomingMessage, agents: Agent[]): Promise<Agent>;
  onAgentResponse?(agent: Agent, response: AgentResponse): Promise<void>;
}

interface Scheduler {
  schedule(task: ScheduledTask): Promise<void>;
  cancel(taskId: string): Promise<void>;
  onDue(handler: (task: ScheduledTask) => void): void;
}

interface ToolProvider {
  name: string;
  discover(): Promise<ToolDefinition[]>;
  execute(tool: string, params: Record<string, unknown>): Promise<ToolResult>;
}
```

`DataSource` — anything producing/consuming messages (Bluesky, Discord, etc.). `Coordinator` — multi-agent routing (Supervisor, RoundRobin, Pipeline, etc.). `Scheduler` — sleep time, periodic tasks, deferred messages. `ToolProvider` — external tool sources (MCP servers, dynamic tools).

### Configuration & Deployment

Single `config.toml` with environment variable overrides for secrets.

```toml
[agent]
max_tool_rounds = 20
max_code_size = 51200
code_timeout = 60000
max_tool_calls_per_exec = 25
context_budget = 0.8

[model]
provider = "anthropic"
name = "claude-sonnet-4-5-20250514"

[embedding]
provider = "ollama"
model = "nomic-embed-text"
endpoint = "http://192.168.1.x:11434"

[database]
url = "postgresql://localhost:5432/constellation"

[runtime]
working_dir = "./workspace"
allowed_hosts = ["api.anthropic.com", "api.moonshot.ai"]
```

Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_API_KEY`, `DATABASE_URL`.

Docker deployment: Bun daemon + pgvector/pgvector:pg17. Workspace volume-mounted. stdin_open + tty for interactive mode.

### Error Handling & Resilience

| Failure | Recovery |
|---|---|
| Model API error | Exponential backoff, 3 retries. Surface error on persistent failure. Conversation state preserved. |
| Deno subprocess crash/timeout | Kill subprocess, return structured error as tool result. Agent can retry or adapt. |
| Database connection lost | Retry with backoff. Queue writes in memory, flush on reconnect. |
| Embedding provider down | Store memory without embedding (null). Background re-embedding on recovery. Semantic search degrades to keyword/recency. |
| Agent infinite loop | Max tool rounds enforced. Force end turn with warning. |
| Host process crash | Conversation history and memory already in Postgres. On restart, agent resumes with full context. |

Principles: never lose confirmed state (persist before acknowledging), degrade don't crash, agent sees errors as tool results she can reason about, no silent failures.

## Existing Patterns

This is a new TypeScript project. Architecture draws from two existing systems:

**From Pattern (Rust, `/Users/scarndp/dev/numina/`):**
- Three-tier memory model (Core/Working/Archival) with permission-gated access
- Multi-agent coordination patterns (Supervisor, Dynamic, Sleeptime, Pipeline, RoundRobin, Voting) — interfaces only in first slice
- Event-sourced memory history
- MemGPT-style context window management with compression strategies
- Persona/Familiar relationship model

**From Sirona (Python, `/Users/scarndp/dev/numina-systems/scdm-chat/`):**
- Deno sandbox code execution with IPC bridge (JSON lines over stdin/stdout)
- Decorator-style tool registration with runtime stub generation
- Provider abstraction (AgentClient ABC with Anthropic + OpenAI-compatible adapters)
- Single `execute_code` tool exposing a code runtime to the model

**New patterns in Constellation:**
- Bun as host runtime (instead of Python or Rust)
- PostgreSQL + pgvector for persistence and semantic search (instead of SurrealDB or DuckDB)
- Familiar permission level for negotiated identity evolution
- Broader Deno sandbox permissions (network + file write) enabling real-world action
- Configurable embedding provider abstraction

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Project Scaffolding
**Goal:** Bun project initialised with TypeScript, dependencies, build, and database schema.

**Components:**
- `package.json` with dependencies: `@anthropic-ai/sdk`, `openai`, `pg`, `pgvector`, `@iarna/toml`, `zod`
- `tsconfig.json` with strict mode
- `bunfig.toml`
- `config.toml` with example configuration
- `src/index.ts` entry point (placeholder)
- `src/config/config.ts` — TOML + env loading, typed `AppConfig` with Zod validation
- `src/persistence/migrations/` — initial SQL schema (memory_blocks, memory_events, messages, pending_mutations tables with pgvector extension)
- `docker-compose.yml` — pgvector/pgvector:pg17 service
- `src/persistence/types.ts` — PersistenceProvider port
- `src/persistence/postgres.ts` — PostgreSQL adapter with migration runner

**Dependencies:** None (first phase)

**Done when:** `bun install` succeeds, `bun run build` succeeds, `docker compose up` starts Postgres, migrations run and create tables with pgvector extension enabled
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Provider Abstraction
**Goal:** LLM and embedding provider ports and adapters, able to send messages and generate embeddings.

**Components:**
- `src/model/types.ts` — ModelProvider port, Message, ToolDefinition, ModelResponse, StreamEvent types
- `src/model/anthropic.ts` — AnthropicAdapter wrapping `@anthropic-ai/sdk` with streaming and tool use
- `src/model/openai-compat.ts` — OpenAICompatAdapter wrapping `openai` package with configurable baseURL
- `src/embedding/types.ts` — EmbeddingProvider port
- `src/embedding/openai.ts` — OpenAI embeddings adapter
- `src/embedding/ollama.ts` — Ollama embeddings adapter

**Dependencies:** Phase 1 (config, project setup)

**Done when:** Tests verify both LLM adapters can send a message and receive a normalised response. Tests verify both embedding adapters can generate vectors of correct dimensions.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Memory System
**Goal:** Three-tier memory with permissions, persistence, semantic search, event sourcing, and pending mutations for Familiar-permissioned blocks.

**Components:**
- `src/memory/types.ts` — MemoryBlock, MemoryTier, MemoryPermission, MemoryEvent types
- `src/memory/store.ts` — MemoryStore port (CRUD + semantic search + event log + pending mutations)
- `src/memory/manager.ts` — MemoryManager orchestrating tiers, context window budgets, embedding generation on write, permission enforcement, mutation queuing

**Dependencies:** Phase 1 (persistence), Phase 2 (embedding provider)

**Done when:** Tests verify CRUD on all three tiers. Tests verify semantic search returns relevant blocks. Tests verify Familiar permission blocks queue pending mutations instead of writing directly. Tests verify event log records all mutations. Tests verify context budget enforcement swaps working blocks when exceeded.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Tool System
**Goal:** Tool registry with built-in memory tools and TypeScript stub generation for the Deno runtime.

**Components:**
- `src/tool/types.ts` — Tool port, ToolParameter, ToolResult types
- `src/tool/registry.ts` — ToolRegistry (registration, parameter validation, dispatch, stub generation)
- `src/tool/builtin/memory.ts` — memory_read, memory_write, memory_list tool definitions

**Dependencies:** Phase 3 (memory manager)

**Done when:** Tests verify tool registration, parameter validation, and dispatch. Tests verify memory tools correctly invoke MemoryManager operations. Tests verify TypeScript stub generation produces valid tool bridge code.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Code Execution Runtime
**Goal:** Deno sandbox executor with IPC bridge, configurable permissions, and tool bridge.

**Components:**
- `src/runtime/types.ts` — CodeRuntime port, ExecutionResult, IPC message types
- `src/runtime/executor.ts` — DenoExecutor (subprocess lifecycle, IPC dispatch loop, permission flags, timeout/limits enforcement)
- `src/runtime/deno/runtime.ts` — Deno-side IPC bridge (readLine, callTool, output, debug functions)

**Dependencies:** Phase 4 (tool registry for stub generation)

**Done when:** Tests verify Deno subprocess spawns with correct permission flags. Tests verify IPC round-trip (code calls tool via bridge, receives result). Tests verify timeout enforcement kills subprocess. Tests verify network allowlist is respected. Tests verify code size and tool call limits are enforced.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Agent Loop
**Goal:** Core agent loop that receives messages, builds context from memory, calls the model, dispatches tool use and code execution, and manages conversation history with compression.

**Components:**
- `src/agent/context.ts` — System prompt construction from Core memory blocks, Working block loading, conversation history assembly
- `src/agent/types.ts` — AgentConfig, AgentState types
- `src/agent/agent.ts` — Agent class: message processing loop, tool call dispatch, code execution dispatch, max rounds enforcement, conversation persistence, history compression via summarisation

**Dependencies:** Phase 2 (model provider), Phase 3 (memory manager), Phase 5 (code executor)

**Done when:** Tests verify full agent loop: message in → context built → model called → tool results collected → response returned. Tests verify multi-round tool calling loops correctly. Tests verify max tool rounds enforcement. Tests verify conversation persistence to database. Tests verify context compression triggers when history exceeds budget.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Extension Point Interfaces & Interaction Loop
**Goal:** Extension point contracts defined and a minimal stdin/stdout interaction loop for development.

**Components:**
- `src/extensions/data-source.ts` — DataSource port interface
- `src/extensions/coordinator.ts` — Coordinator port interface
- `src/extensions/scheduler.ts` — Scheduler port interface
- `src/extensions/tool-provider.ts` — ToolProvider port interface (for future MCP, dynamic tools)
- `src/index.ts` — Full wiring: config → providers → memory → tools → executor → agent → stdin/stdout REPL loop with pending mutation approval flow

**Dependencies:** Phase 6 (agent)

**Done when:** Extension interfaces compile and are exported. Running `bun run src/index.ts` starts the daemon, accepts input via stdin, returns agent responses to stdout. Pending Familiar mutations surface in the interaction loop for approval/rejection. Graceful shutdown on SIGINT/SIGTERM.
<!-- END_PHASE_7 -->

<!-- START_PHASE_8 -->
### Phase 8: First-Run Seeding & Integration Testing
**Goal:** First-run experience (seed core memory from persona config) and end-to-end integration tests proving the full system works.

**Components:**
- Seeding logic in `src/index.ts` — detect empty database, load initial Core memory blocks from config/persona file
- `persona.md` — default persona template
- Integration tests covering the full path: message → memory context → model → tool use → code execution → memory persistence → response

**Dependencies:** Phase 7 (full wiring)

**Done when:** Starting with an empty database seeds core memory blocks (system, persona, familiar). Integration test sends a message, agent responds using memory context. Integration test triggers code execution and verifies result flows back. Integration test verifies memory_write persists and memory_read retrieves. Familiar mutation approval flow works end-to-end.
<!-- END_PHASE_8 -->

## Additional Considerations

**Conversation history as first-class data:** Messages are stored in Postgres with timestamps, not just kept in memory. On restart, the agent picks up where she left off. This is essential for a daemon that runs for months.

**Persona evolution tracking:** Because `core:persona` is Familiar-permissioned and event-sourced, there's a complete history of how her identity has evolved over time — every proposed change, whether it was approved or rejected, and when.

**Code runtime as the escape hatch:** The four built-in tools are deliberately minimal. Rather than building dozens of specialized tools, the code runtime lets her write whatever she needs. This keeps the core small and pushes complexity to the edges where it belongs.
