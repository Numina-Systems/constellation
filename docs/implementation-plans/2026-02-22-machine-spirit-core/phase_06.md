# Machine Spirit Core Implementation Plan - Phase 6: Agent Loop

**Goal:** Core agent loop that receives messages, builds context from memory, calls the model, dispatches tool use and code execution, manages conversation history, and compresses context when it exceeds the budget.

**Architecture:** The `Agent` orchestrates all prior modules. It receives a user message, constructs a `ModelRequest` using context built from memory (core blocks in system prompt, working blocks and history in messages), streams the model response, dispatches tool calls or code execution, collects results, and loops until the model returns `end_turn` or max rounds are reached. Conversation messages are persisted to Postgres. When history exceeds the context budget, older messages are summarised and archived.

**Tech Stack:** Bun, TypeScript, all prior modules (ModelProvider, MemoryManager, ToolRegistry, CodeRuntime, PersistenceProvider)

**Scope:** 8 phases from original design (this is phase 6 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phases 1-5 provide all dependencies.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC1: Stateful agent daemon maintains conversation state and three-tier memory
- **machine-spirit-core.AC1.1 Success:** Agent receives a message via stdin, processes it through the model, and returns a response to stdout
- **machine-spirit-core.AC1.2 Success:** Conversation history persists to Postgres and survives daemon restart
- **machine-spirit-core.AC1.12 Edge:** Context compression triggers when conversation history exceeds the configured budget, replacing old messages with summaries

### machine-spirit-core.AC4: Clean separation of concerns
- **machine-spirit-core.AC4.2 Success:** The agent loop depends only on port interfaces, not adapter implementations

---

<!-- START_TASK_1 -->
### Task 1: Agent types

**Verifies:** None (types only)

**Files:**
- Create: `src/agent/types.ts`

**Implementation:**

Define the agent types:

- `AgentConfig`: `{ max_tool_rounds: number, context_budget: number }` — from AppConfig's agent section
- `ConversationMessage`: `{ id: string, conversation_id: string, role: 'user' | 'assistant' | 'system' | 'tool', content: string, tool_calls?: unknown, tool_call_id?: string, created_at: Date }` — persisted to Postgres `messages` table
- `AgentDependencies`: all the port interfaces the agent needs:
  ```typescript
  type AgentDependencies = {
    model: ModelProvider;
    memory: MemoryManager;
    registry: ToolRegistry;
    runtime: CodeRuntime;
    persistence: PersistenceProvider;
    config: AgentConfig;
  };
  ```
- `Agent` type:
  ```typescript
  type Agent = {
    processMessage(userMessage: string): Promise<string>;
    getConversationHistory(): Promise<Array<ConversationMessage>>;
    conversationId: string;
  };
  ```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add agent types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Context builder

**Verifies:** machine-spirit-core.AC1.3 (via MemoryManager), machine-spirit-core.AC4.2

**Files:**
- Create: `src/agent/context.ts`

**Implementation:**

Create context building functions:

**`buildSystemPrompt(memory: MemoryManager): Promise<string>`**
- Calls `memory.buildSystemPrompt()` to get all core memory blocks formatted as the system prompt
- This is the function that ensures AC1.3 (core blocks always in system prompt)

**`buildMessages(history: Array<ConversationMessage>, memory: MemoryManager): Promise<Array<Message>>`**
- Converts persisted `ConversationMessage` records to the `Message` type expected by `ModelProvider`
- Prepends working memory blocks as a system-level context message (or appends them to the system prompt)
- Maps roles and content appropriately

**`estimateTokens(text: string): number`**
- Simple token estimation: `Math.ceil(text.length / 4)` (rough heuristic — 1 token ~= 4 characters)
- Used for context budget tracking
- The design notes this is a configurable budget (default 80% of model window), so exact count isn't critical

**`shouldCompress(history: Array<ConversationMessage>, budget: number, modelMaxTokens: number): boolean`**
- Estimates total tokens across all messages
- Returns true if estimated tokens exceed `budget * modelMaxTokens`

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add context builder for agent loop`
<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Agent loop implementation

**Verifies:** machine-spirit-core.AC1.1, machine-spirit-core.AC1.2, machine-spirit-core.AC1.12, machine-spirit-core.AC4.2

**Files:**
- Create: `src/agent/agent.ts`

**Implementation:**

Create `createAgent(deps: AgentDependencies, conversationId?: string): Agent` factory function.

If `conversationId` is not provided, generate a new one (ULID or UUID). If provided, load existing conversation history from Postgres.

**`processMessage(userMessage: string): Promise<string>`**

The core loop:

1. **Persist user message** to `messages` table via `deps.persistence.query()`

2. **Load conversation history** from `messages` table for this `conversationId`

3. **Check context budget** — if `shouldCompress()` returns true:
   - Take the oldest N messages (beyond a keep-recent threshold)
   - Call `deps.model.complete()` with a summarisation prompt asking to condense those messages
   - Replace the old messages with a single summary message (role: 'system', content: summary)
   - Archive the original messages to archival memory via `deps.memory.write()`
   - Persist the summary message

4. **Build context:**
   - System prompt from `buildSystemPrompt(deps.memory)`
   - Messages from `buildMessages(history, deps.memory)`

5. **Call model** via `deps.model.complete()` (or `stream()`) with context + tool definitions from `deps.registry.toModelTools()`

6. **Handle response based on stop_reason:**

   - `end_turn` or `max_tokens`: Extract text content, persist assistant message, return text to caller.

   - `tool_use`: For each tool use block in the response:
     - If tool name is `execute_code`: Call `deps.runtime.execute(code, deps.registry.generateStubs())`, format result as tool result message
     - Otherwise: Call `deps.registry.dispatch(name, params)`, format result as tool result message
     - Persist the assistant message (with tool calls) and tool result messages
     - Append to history and loop back to step 5
     - Increment round counter. If rounds exceed `deps.config.max_tool_rounds`, stop the loop, persist an assistant message with the text `"[Warning: max tool rounds (${deps.config.max_tool_rounds}) reached. Stopping tool execution.]"`, and return that text to the caller.

7. **Return** the final assistant text response.

**`getConversationHistory(): Promise<Array<ConversationMessage>>`**
- Queries `messages` table for this `conversationId`, ordered by `created_at`

**Key design notes:**
- The agent loop depends ONLY on port interfaces (AC4.2) — `ModelProvider`, `MemoryManager`, `ToolRegistry`, `CodeRuntime`, `PersistenceProvider`
- Every message (user, assistant, tool) is persisted before the next step — "never lose confirmed state"
- The `execute_code` tool is special-cased in dispatch (it goes to `CodeRuntime`, not `ToolRegistry`)

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add agent loop with tool dispatch and context compression`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Agent loop tests

**Verifies:** machine-spirit-core.AC1.1, machine-spirit-core.AC1.2, machine-spirit-core.AC1.12, machine-spirit-core.AC4.2

**Files:**
- Test: `src/agent/agent.test.ts` (unit + integration)

**Testing:**

Create mock implementations of all dependencies (ModelProvider, MemoryManager, ToolRegistry, CodeRuntime, PersistenceProvider). The mock ModelProvider should return controllable responses — configure it per test to return text responses, tool_use responses, or sequences of both.

Tests for each AC:

- **machine-spirit-core.AC1.1:** Send a message to `processMessage()`, mock ModelProvider returns a text response. Verify the returned string matches the mock response text.

- **machine-spirit-core.AC1.2 (unit):** After `processMessage()`, verify messages were persisted via mock PersistenceProvider's query calls. Verify both the user message and assistant response were stored with correct conversation_id. Create a new Agent with the same conversationId, verify `getConversationHistory()` returns the previously stored messages.

- **machine-spirit-core.AC1.2 (integration):** With a real Postgres instance: send a message, verify messages are in the database. Create a new Agent instance with the same conversationId, send another message, verify the agent has the full history.

- **machine-spirit-core.AC1.12:** Set a very low context budget (e.g., 0.1) and a small model max tokens estimate. Send enough messages to exceed the budget. Verify that on the next `processMessage()` call, the compression logic triggers — the mock model should receive a summarisation request, and the history should be replaced with a summary.

- **machine-spirit-core.AC4.2:** This is structural — verify the agent imports and depends only on types from `*/types.ts` files, not on any adapter implementations. All tests use mock implementations, proving the agent is decoupled.

- **Multi-round tool calling:** Configure mock ModelProvider to return a tool_use response first, then an end_turn response on the second call. Verify the agent dispatches the tool call, collects the result, sends it back to the model, and returns the final text response.

- **Max tool rounds enforcement:** Configure mock ModelProvider to always return tool_use responses. Set max_tool_rounds to 3. Verify the agent stops after 3 rounds and returns a response containing `"max tool rounds (3) reached"`.

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass

**Commit:** `test: add agent loop tests`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
