# Machine Spirit Core - Test Requirements

This document maps every acceptance criterion from the machine spirit core design to either an automated test or documented human verification. Each entry is rationalized against the implementation decisions made in phases 1-8.

---

## Automated Tests

### machine-spirit-core.AC1: Stateful agent daemon maintains conversation state and three-tier memory

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC1.1 | unit | `src/agent/agent.test.ts` | Send a message to `processMessage()` with a mock ModelProvider returning a text response. Verify the returned string matches the mock response text. Validates the message-in/response-out path through the agent loop. |
| AC1.1 | e2e | `src/integration/e2e.test.ts` | Wire all real dependencies (Postgres, embedding, Deno). Call `processMessage("Hello")` on a fully constructed agent. Verify a non-empty string response is returned. |
| AC1.2 | unit | `src/agent/agent.test.ts` | After `processMessage()`, verify messages were persisted via mock PersistenceProvider query calls. Verify both user message and assistant response stored with correct `conversation_id`. Create a new Agent with the same `conversationId`, verify `getConversationHistory()` returns previously stored messages. |
| AC1.2 | integration | `src/agent/agent.test.ts` | With real Postgres: send a message, verify messages exist in the database. Create a new Agent instance with the same `conversationId`, send another message, verify the agent has the full history including messages from the first instance. |
| AC1.2 | e2e | `src/integration/e2e.test.ts` | Send a message, note the `conversationId`. Create a new agent instance with the same ID. Call `getConversationHistory()`. Verify it contains the user message and assistant response from the first interaction. Validates persistence survives agent "restart". |
| AC1.3 | integration | `src/memory/manager.test.ts` | Create core memory blocks, call `buildSystemPrompt()`, verify all core blocks appear in the returned string with their labels and content. Validates that core blocks are always included in the system prompt sent to the model. |
| AC1.4 | integration | `src/memory/manager.test.ts` | Create working blocks, call `getWorkingBlocks()`, verify they are returned. Write a new working block, verify it appears. Delete/archive a working block, verify it is removed from the list. Validates working memory swapping. |
| AC1.5 | integration | `src/memory/manager.test.ts` | Create archival blocks with embeddings, call `read()` with a query, verify results are returned ordered by similarity. Verify core/working blocks are NOT returned when tier filter is set to archival. |
| AC1.5 | e2e | `src/integration/e2e.test.ts` | Use `memory.write()` to store several archival blocks with distinct content. Call `memory.read("query related to one block")`. Verify the most relevant block is returned first. Validates semantic search with real pgvector. |
| AC1.6 | integration | `src/memory/manager.test.ts` | Call `write()` with new content, verify the block is persisted with a non-null embedding. Verify the mock embedding provider was called with the content string. |
| AC1.6 | e2e | `src/integration/e2e.test.ts` | Verify all stored blocks have non-null embeddings after writes through the full stack with a real embedding provider. |
| AC1.7 | integration | `src/memory/manager.test.ts` | Call `write()` to create and then update a block. Query `getEvents()` for that block. Verify events include `create` and `update` entries with correct `old_content` and `new_content` fields. |
| AC1.8 | integration | `src/memory/manager.test.ts` | Create a block with `readonly` permission. Call `write()` targeting that label. Verify the result is `{ applied: false, error: ... }` containing "read-only". Verify the block content is unchanged in the database. |
| AC1.9 | integration | `src/memory/manager.test.ts` | Create a block with `familiar` permission. Call `write()` targeting that label. Verify the result is `{ applied: false, mutation: ... }`. Verify the block content is unchanged. Verify a pending mutation exists in the store. |
| AC1.9 | e2e | `src/integration/mutations.test.ts` | Write to the `core:persona` block (Familiar permission) via the full stack. Verify the result is `{ applied: false, mutation }`. Verify `core:persona` block content is UNCHANGED. Verify `pending_mutations` table has a new entry. |
| AC1.10 | integration | `src/memory/manager.test.ts` | After creating a pending mutation (AC1.9), call `approveMutation()`. Verify the block content is updated to the proposed content. Verify the mutation status is `approved`. |
| AC1.10 | e2e | `src/integration/mutations.test.ts` | After queuing a mutation, call `memory.approveMutation(mutationId)`. Verify `core:persona` block content is now updated. Verify mutation status is `approved`. Verify a `memory_event` was logged with `event_type: 'update'`. |
| AC1.11 | integration | `src/memory/manager.test.ts` | Create a `familiar` block, write to it (creating a pending mutation), then call `rejectMutation()` with feedback. Verify block content is unchanged. Verify mutation status is `rejected` with the feedback string. |
| AC1.11 | e2e | `src/integration/mutations.test.ts` | Queue a mutation to `core:familiar` block. Call `memory.rejectMutation(mutationId, "I prefer the current description")`. Verify block content is UNCHANGED. Verify mutation status is `rejected` with feedback. Verify NO update event logged after creation. |
| AC1.12 | unit | `src/agent/agent.test.ts` | Set a very low context budget (e.g., 0.1) and small model max tokens. Send enough messages to exceed the budget. Verify compression triggers: mock model receives a summarisation request, history is replaced with a summary message, and archived messages are written to archival memory. |

### machine-spirit-core.AC2: Provider abstraction supports Anthropic and OpenAI-compatible endpoints

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC2.1 | integration | `src/model/anthropic.test.ts` | Send a simple message via Anthropic adapter, verify response has text content block and valid usage stats. Send a message with tool definitions, verify response includes `tool_use` block with correct name and input. Requires `ANTHROPIC_API_KEY`; skips if unavailable. |
| AC2.2 | integration | `src/model/anthropic.test.ts` | Stream a response via Anthropic adapter, verify events arrive in order: `message_start` -> `content_block_start` -> `content_block_delta`(s) -> `message_stop`. Requires `ANTHROPIC_API_KEY`; skips if unavailable. |
| AC2.3 | integration | `src/model/openai-compat.test.ts` | Create adapter with a custom `baseURL`, send a message, verify normalised `ModelResponse` is returned with text content and usage stats. Requires an OpenAI-compatible endpoint; skips if unavailable. |
| AC2.4 | unit | `src/model/factory.test.ts` | Verify that changing `provider` in `ModelConfig` causes `createModelProvider()` to return different adapter types (Anthropic vs OpenAI-compat). Verify unknown provider throws a descriptive error. |
| AC2.4 | unit | `src/embedding/factory.test.ts` | Verify that changing `provider` in `EmbeddingConfig` causes `createEmbeddingProvider()` to return different adapter types (OpenAI vs Ollama). Verify unknown provider throws a descriptive error. |
| AC2.5 | integration | `src/model/anthropic.test.ts` | Create Anthropic adapter with an invalid API key, call `complete()`, verify a `ModelError` with `code: 'auth'` is thrown (not an unstructured crash). |
| AC2.5 | integration | `src/model/openai-compat.test.ts` | Create OpenAI-compat adapter with an invalid API key, call `complete()`, verify a `ModelError` with `code: 'auth'` is thrown. |
| AC2.6 | unit | `src/model/anthropic.test.ts` | Verify retry logic using a mock/spy: adapter retries on retryable errors with exponential backoff, stops after 3 attempts, and surfaces the final error as a `ModelError`. |
| AC2.6 | unit | `src/model/openai-compat.test.ts` | Same retry verification as Anthropic: mock client to return retryable errors, verify 3 retry attempts with exponential backoff. |

### machine-spirit-core.AC3: Deno code execution runtime with controlled permissions

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC3.1 | integration | `src/runtime/executor.test.ts` | Execute simple TypeScript code (`const x = 1 + 2; output(String(x))`), verify result is `{ success: true, output: '3' }`. Requires Deno installed. |
| AC3.1 | e2e | `src/integration/e2e.test.ts` | Configure agent to receive a message that triggers `execute_code` (with mock model returning a tool call). Verify the code runs and the result flows back through the agent loop. |
| AC3.2 | integration | `src/runtime/executor.test.ts` | Execute code that fetches from an allowed host (e.g., HEAD request). Verify it succeeds without permission errors. Network allowlist is verified via Deno's `--allow-net` flag. |
| AC3.3 | integration | `src/runtime/executor.test.ts` | Execute code that writes a file to the working directory, then reads it back. Verify the file exists and contains expected content. Clean up after test. Working dir scoping verified via Deno's `--allow-read`/`--allow-write` flags. |
| AC3.4 | integration | `src/runtime/executor.test.ts` | Execute code that calls a tool via `__callTool__` bridge (using a mock `echo_tool`). Verify the tool was dispatched on the host side and the result was returned to the Deno code. |
| AC3.4 | e2e | `src/integration/e2e.test.ts` | Execute code that calls `memory_list()` via the IPC bridge. Verify the tool call is dispatched to the host, the result is returned to the Deno code, and final output includes memory list data. |
| AC3.5 | integration | `src/runtime/executor.test.ts` | Execute code that attempts `new Deno.Command("ls").spawn()`. Verify the execution result contains a permission denied error. Enforced by Deno's `--deny-run` flag. |
| AC3.6 | integration | `src/runtime/executor.test.ts` | Execute code that attempts `Deno.env.get("PATH")`. Verify the result contains a permission denied error. Enforced by Deno's `--deny-env` flag. |
| AC3.7 | integration | `src/runtime/executor.test.ts` | Execute code with an infinite loop (`while (true) {}`). Configure a short timeout (e.g., 2 seconds). Verify the process is killed and result has `success: false` with timeout error message. |
| AC3.8 | integration | `src/runtime/executor.test.ts` | Pass code longer than `max_code_size` (50KB). Verify the executor rejects it immediately without spawning a subprocess. Result has `success: false` with size error. No Deno process spawned. |
| AC3.9 | integration | `src/runtime/executor.test.ts` | Execute code that attempts to fetch a host NOT on the allowlist. Verify the result contains a permission denied / network error. Enforced by Deno's `--allow-net=<allowlist>` flag. |

### machine-spirit-core.AC4: Clean separation of concerns

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC4.1 | unit | `src/tool/registry.test.ts` | Verify `ToolRegistry` works with tool definitions following the `Tool` port from `types.ts`. Register tools, verify `getDefinitions()` returns schemas from the port types. The existence of `types.ts` files in each module (memory, model, embedding, runtime, tool, persistence) is a structural guarantee verified by the TypeScript compiler (`bun run build`). |
| AC4.2 | unit | `src/tool/builtin/memory.test.ts` | Verify memory tools depend only on the `MemoryManager` type, not on any concrete implementation. All tests use mock `MemoryManager`. |
| AC4.2 | unit | `src/agent/agent.test.ts` | Agent loop depends only on port interfaces (`ModelProvider`, `MemoryManager`, `ToolRegistry`, `CodeRuntime`, `PersistenceProvider`). All tests use mock implementations of every dependency. Structural AC: no adapter imports in `agent.ts`. |
| AC4.3 | unit | `src/tool/registry.test.ts` | ToolRegistry is independently testable with mock tools. No real MemoryManager, no real providers, no database. All tests pass with pure mock implementations. |
| AC4.3 | unit | `src/tool/builtin/memory.test.ts` | Built-in memory tools are independently testable with a mock MemoryManager. No database, no embedding provider. |
| AC4.3 | unit | `src/agent/agent.test.ts` | Agent is independently testable with mocks of all dependencies. No real model API calls, no database, no Deno process. |

### machine-spirit-core.AC5: Extension point interfaces

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC5.1 | unit | (compiler) | `DataSource`, `Coordinator`, `Scheduler`, and `ToolProvider` interfaces compile and are exported from `src/extensions/index.ts`. Verified by `bun run build` succeeding. No runtime test needed since these are type-only contracts with no implementation in this slice. |

### machine-spirit-core.AC6: Minimal interaction mechanism

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC6.1 | unit | `src/index.test.ts` | Verify that `createInteractionLoop` processes a line of input by calling `agent.processMessage()` and outputs the response. Uses mock readline input and mock agent. |
| AC6.2 | unit | `src/index.test.ts` | Mock `memory.getPendingMutations()` to return a pending mutation. Verify the loop surfaces it before processing the next message. Mock readline to provide 'y' input, verify `memory.approveMutation()` is called. Test rejection with feedback text, verify `memory.rejectMutation()` is called with the feedback. |
| AC6.3 | unit | `src/index.test.ts` | Verify that calling the shutdown handler invokes `persistence.disconnect()` and resolves cleanly. Validates that SIGINT/SIGTERM triggers the shutdown path. |
| AC6.4 | e2e | `src/integration/e2e.test.ts` | Start with an empty database. Run the seeding logic. Verify `memory_blocks` table contains `core:system` (ReadOnly), `core:persona` (Familiar), and `core:familiar` (Familiar) blocks with correct tiers, permissions, and non-empty content. |

---

## Supplementary Tests

These tests are not directly mapped to acceptance criteria but are documented in the implementation plans and provide important coverage.

| Test | Type | Test File | Description |
|------|------|-----------|-------------|
| Embedding failure graceful degradation | integration | `src/memory/manager.test.ts` | Create a MemoryManager with a mock EmbeddingProvider that throws on `embed()`. Call `write()`. Verify the block is created with `null` embedding. Verify the block is NOT returned by `read()` (semantic search skips null-embedding blocks). |
| FFI denied | integration | `src/runtime/executor.test.ts` | Execute code attempting `Deno.dlopen()`. Verify result contains a permission denied error. Enforced by `--deny-ffi` flag. |
| Output size limit | integration | `src/runtime/executor.test.ts` | Execute code generating output exceeding `max_output_size` (configure a small limit like 1KB). Verify process is killed and result has `success: false` with output size error. |
| Tool call limit | integration | `src/runtime/executor.test.ts` | Execute code that calls tools in a loop exceeding `max_tool_calls_per_exec`. Verify the process is killed and result reports the tool call limit exceeded. |
| ToolRegistry duplicate registration | unit | `src/tool/registry.test.ts` | Register a tool, then register another with the same name. Verify it throws an error. |
| ToolRegistry unknown tool dispatch | unit | `src/tool/registry.test.ts` | Dispatch to an unregistered tool name. Verify error `ToolResult` is returned. |
| ToolRegistry missing required param | unit | `src/tool/registry.test.ts` | Register tool with required params, dispatch without them. Verify error `ToolResult` without calling handler. |
| ToolRegistry handler error | unit | `src/tool/registry.test.ts` | Register tool whose handler throws. Verify error is caught and wrapped in `ToolResult`. |
| Stub generation | unit | `src/tool/registry.test.ts` | Register tools, call `generateStubs()`. Verify output contains function declarations for each tool with correct parameter signatures. |
| toModelTools JSON Schema | unit | `src/tool/registry.test.ts` | Register tools, call `toModelTools()`. Verify output is valid JSON Schema format with properties, required arrays, and descriptions. |
| Max tool rounds | unit | `src/agent/agent.test.ts` | Configure mock ModelProvider to always return `tool_use` responses. Set `max_tool_rounds` to 3. Verify agent stops after 3 rounds and returns a warning message. |
| Multi-round tool calling | unit | `src/agent/agent.test.ts` | Configure mock ModelProvider to return `tool_use` first, then `end_turn`. Verify the agent dispatches the tool, collects the result, loops back to the model, and returns the final text. |
| OpenAI embedding dimensions | integration | `src/embedding/openai.test.ts` | Send a single text, verify returned vector has correct dimensions. Send a batch, verify array lengths match. Requires `OPENAI_API_KEY`; skips if unavailable. |
| Ollama embedding dimensions | integration | `src/embedding/ollama.test.ts` | Send a single text, verify returned vector has correct dimensions. Send a batch, verify array lengths match. Requires running Ollama instance; skips if unavailable. |

---

## Human Verification

| Criterion | Justification | Verification Approach |
|-----------|---------------|----------------------|
| AC1.1 (interactive) | The stdin/stdout interaction path requires a running daemon with a real terminal session to verify the full user experience -- reading from stdin, processing, and printing to stdout. Automated tests cover the `processMessage()` path but not the actual terminal I/O wiring. | Start the daemon with `bun run src/index.ts` and a valid `ANTHROPIC_API_KEY`. Type a message. Verify the response appears on stdout. Verify the prompt re-appears for the next message. |
| AC1.2 (restart) | While integration tests verify persistence and re-loading history, the actual "survives daemon restart" behaviour requires stopping and restarting the real process to confirm the full lifecycle. | Start daemon, send a message. SIGINT to stop. Start daemon again (same database). Send a follow-up message that references the prior conversation. Verify the agent's response demonstrates awareness of the prior exchange (e.g., references something from the first message). |
| AC2.3 (Kimi/Ollama) | Testing with real third-party endpoints (Kimi at `api.moonshot.ai/v1`, Ollama at `localhost:11434/v1`) requires those services to be available and configured, which is environment-specific and cannot be reliably automated in CI. | Configure `config.toml` with `provider = "openai-compat"` and `base_url` set to Kimi or Ollama endpoint. Start the daemon. Send a message. Verify a response is returned. Repeat with the other endpoint. |
| AC5.2 | Documentation quality is inherently subjective. The criterion requires extension interfaces to be "documented with their intended purpose" -- this means JSDoc comments should be clear, accurate, and useful to a future implementer. | Review JSDoc comments on `DataSource`, `Coordinator`, `Scheduler`, and `ToolProvider` types in `src/extensions/`. Verify each type and its methods have doc comments explaining purpose, use cases, and examples. Verify the barrel export in `index.ts` re-exports all types. |
| AC6.1 (daemon startup) | The full daemon startup path (`bun run src/index.ts`) involves process lifecycle, config loading from disk, database connection, migration execution, and terminal I/O setup. While individual pieces are tested, the end-to-end startup sequence is best verified manually. | Run `docker compose up -d`, then `bun run src/index.ts`. Verify: startup logs appear (database connected, migrations run, seeding if first run), prompt appears, input is accepted. |
| AC6.2 (interactive approval) | The pending mutation approval flow involves interactive terminal I/O: displaying the mutation, reading `y`/`n`/feedback from stdin, and routing the response. Unit tests cover the logic with mock readline, but the actual terminal UX requires human verification. | Trigger a Familiar mutation (e.g., ask the agent to update her persona). Verify the mutation prompt appears with block name, proposed content, and reason. Type `y` and verify approval. Repeat, type `n` or feedback text, verify rejection with feedback. |
| AC6.3 (graceful shutdown) | While the shutdown handler is unit-tested, verifying that SIGINT/SIGTERM actually triggers graceful shutdown (no orphaned Deno processes, DB connections closed, no data loss) requires process-level observation. | Start the daemon, send a message that triggers code execution (to have an active Deno subprocess). Press Ctrl+C (SIGINT). Verify: "Shutting down..." message appears, process exits cleanly (exit code 0), no orphaned `deno` processes (`ps aux \| grep deno`), database connections are closed (`SELECT * FROM pg_stat_activity`). |
| AC6.4 (first-run persona) | While the e2e test verifies database records exist after seeding, the human verification confirms the agent's first-run experience is coherent: that she loads and uses the persona in her responses. | Delete the `memory_blocks` table contents (or use a fresh database). Start the daemon. Verify "Core memory seeded" log message. Send "Who are you?" as first message. Verify the agent's response reflects the persona from `persona.md`. |

---

## Test Infrastructure Requirements

| Requirement | Notes |
|-------------|-------|
| Docker Compose (pgvector/pgvector:pg17) | Required for all integration and e2e tests touching Postgres. Tests should use a separate database or schema to avoid polluting development data. |
| Deno 2.x | Required for all AC3 integration tests and e2e code execution tests. Must be installed on the test runner. |
| `ANTHROPIC_API_KEY` | Required for AC2.1, AC2.2, AC2.5 (Anthropic) integration tests and e2e tests using real model. Tests skip gracefully if unavailable. |
| `OPENAI_API_KEY` | Required for OpenAI embedding integration tests. Tests skip if unavailable. |
| Running Ollama instance | Required for Ollama embedding integration tests. Tests skip if unavailable. |
| Mock implementations | Unit tests for agent, memory tools, and registry require mock implementations of `ModelProvider`, `MemoryManager`, `ToolRegistry`, `CodeRuntime`, `PersistenceProvider`, and `EmbeddingProvider`. These mocks should be created as shared test utilities. |

## Test File Summary

| Test File | Type | Phase | ACs Covered |
|-----------|------|-------|-------------|
| `src/model/anthropic.test.ts` | integration | 2 | AC2.1, AC2.2, AC2.5, AC2.6 |
| `src/model/openai-compat.test.ts` | integration | 2 | AC2.3, AC2.5, AC2.6 |
| `src/model/factory.test.ts` | unit | 2 | AC2.4 |
| `src/embedding/factory.test.ts` | unit | 2 | AC2.4 |
| `src/embedding/openai.test.ts` | integration | 2 | (supplementary) |
| `src/embedding/ollama.test.ts` | integration | 2 | (supplementary) |
| `src/memory/manager.test.ts` | integration | 3 | AC1.3, AC1.4, AC1.5, AC1.6, AC1.7, AC1.8, AC1.9, AC1.10, AC1.11 |
| `src/tool/registry.test.ts` | unit | 4 | AC4.1, AC4.3 |
| `src/tool/builtin/memory.test.ts` | unit | 4 | AC4.2, AC4.3 |
| `src/runtime/executor.test.ts` | integration | 5 | AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7, AC3.8, AC3.9 |
| `src/agent/agent.test.ts` | unit + integration | 6 | AC1.1, AC1.2, AC1.12, AC4.2 |
| `src/index.test.ts` | unit | 7 | AC6.1, AC6.2, AC6.3 |
| `src/integration/e2e.test.ts` | e2e | 8 | AC1.1, AC1.2, AC1.5, AC1.6, AC3.1, AC3.4, AC6.4 |
| `src/integration/mutations.test.ts` | e2e | 8 | AC1.9, AC1.10, AC1.11 |
