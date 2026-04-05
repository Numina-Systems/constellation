# TUI Implementation Plan — Phase 2: Agent Integration

**Goal:** Agent loop publishes events to the bus and uses streaming when a bus is present.

**Architecture:** The agent accepts an optional `eventBus` in `AgentDependencies`. When present, the agent publishes structured events at each decision point and switches from `model.complete()` to `model.stream()`, assembling a `ModelResponse` from the stream while publishing chunk events. When absent, behaviour is identical to current implementation.

**Tech Stack:** TypeScript, Bun

**Scope:** Phase 2 of 6 from original design

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC2: Agent publishes events during processing
- **tui.AC2.1 Success:** Agent publishes stream:start, stream:chunk(s), stream:end for a text response
- **tui.AC2.2 Success:** Agent publishes tool:start and tool:result for each tool call
- **tui.AC2.3 Success:** Agent publishes turn:start and turn:end bracketing each turn
- **tui.AC2.4 Success:** Agent publishes stream:thinking when model returns reasoning content
- **tui.AC2.5 Success:** Agent without event bus behaves identically to current implementation (existing tests pass)
- **tui.AC2.6 Success:** Streaming produces the same final response as complete() for equivalent input

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add eventBus to AgentDependencies

**Verifies:** None (type-only)

**Files:**
- Modify: `src/agent/types.ts:49-64`
- Modify: `src/agent/index.ts:7`

**Implementation:**

Add `eventBus?: AgentEventBus` as an optional field to the `AgentDependencies` type at `src/agent/types.ts:49-64`. Import `AgentEventBus` from `@/tui/types.ts`.

Add `AgentEventBus` to the type re-exports in `src/agent/index.ts:7` if needed for external consumption, or keep the import internal to the agent module.

Follow the established pattern of optional dependencies — `eventBus` sits alongside `compactor?`, `traceRecorder?`, `skills?`, etc.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All existing tests pass (adding an optional field is non-breaking)

**Commit:** `feat(tui): add eventBus to AgentDependencies`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add stream-to-response assembly function

**Verifies:** tui.AC2.6

**Files:**
- Create: `src/agent/stream-assembler.ts`

**Implementation:**

Create `src/agent/stream-assembler.ts` with `// pattern: Functional Core` annotation.

Implement `assembleResponseFromStream(stream: AsyncIterable<StreamEvent>, eventBus: AgentEventBus, turnIndex: number, modelName: string): Promise<ModelResponse>`.

This function:
1. Publishes `stream:start` with model name and turn index
2. Iterates the `AsyncIterable<StreamEvent>` from the model adapter
3. For each `StreamEvent`:
   - `message_start`: Captures initial usage stats
   - `content_block_start`: Tracks current block type (text, tool_use, thinking). If `type === 'thinking'`, note for later. If `type === 'tool_use'`, capture `id` and `name`.
   - `content_block_delta`: Based on current block type:
     - Text: accumulate text, publish `stream:chunk` with the delta text
     - Tool use: accumulate `input` JSON string
     - Thinking: accumulate thinking text, publish `stream:thinking` with delta
   - `message_stop`: Capture `stop_reason`
4. Publishes `stream:end` with accumulated usage and stop reason
5. Assembles and returns a `ModelResponse` with:
   - `content`: Array of `ContentBlock` (TextBlock, ToolUseBlock) built from accumulated data
   - `stop_reason`: from `message_stop`
   - `usage`: from `message_start` exclusively (this is the only `StreamEvent` variant that carries `UsageStats` — `message_stop` only has `stop_reason`)
   - `reasoning_content`: accumulated thinking text if any

Import types: `StreamEvent`, `ModelResponse`, `ContentBlock`, `TextBlock`, `ToolUseBlock`, `UsageStats`, `StopReason` from `@/model/types.ts`. Import `AgentEventBus` from `@/tui/types.ts`.

Note: Tool use input arrives as incremental JSON string deltas. Accumulate the full string and `JSON.parse()` it when the block ends (on next `content_block_start` or `message_stop`).

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): implement stream-to-response assembler`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Integrate event publishing into agent loop

**Verifies:** tui.AC2.1, tui.AC2.2, tui.AC2.3, tui.AC2.4, tui.AC2.5

**Files:**
- Modify: `src/agent/agent.ts` (the `processMessage` function, ~lines 99-291 at time of writing)

**Implementation:**

Modify `processMessage` in `src/agent/agent.ts` to publish events when `deps.eventBus` is present.

Changes to the agent loop (all changes are conditional on `deps.eventBus` existing). Use the descriptive anchors below to locate each insertion point — do not rely on line numbers as they shift between phases:

1. **Turn start** (in `processMessage`, after the initial `persistMessage` call for the user message, before the `while (roundCount < maxRounds)` loop): If eventBus exists, publish `turn:start` with `source: 'user'`.

2. **Model call** (the `const response = await deps.model.complete(modelRequest)` call inside the while loop): Replace with a conditional:
   - If `deps.eventBus`: Call `assembleResponseFromStream(deps.model.stream(modelRequest), deps.eventBus, roundCount, deps.config.model_name)` — this handles `stream:start`, `stream:chunk`, `stream:thinking`, and `stream:end` events internally.
   - If no eventBus: Keep existing `deps.model.complete(modelRequest)` call unchanged.

3. **Tool dispatch** (the `for (const toolUse of toolUseBlocks)` loop inside the `stop_reason === 'tool_use'` branch): Before each tool dispatch, publish `tool:start` with `toolName`, `toolId` (from `toolUse.id`), and `input`. After dispatch completes (or errors), publish `tool:result` with `toolId`, `result` string, and `isError` boolean.

4. **Turn end** (before each `return` statement in `processMessage` — the `end_turn`/`max_tokens` return, the unknown stop reason return, and the max rounds exceeded return): If eventBus exists, publish `turn:end` with `messageCount` equal to the current history length.

5. **Compaction events** (the `if (deps.compactor && shouldCompress(...))` block before the while loop): Before calling `compactor.compress()`, publish `compaction:start`. After completion, publish `compaction:end` with `removedTokens` calculated from the compaction result's `tokensEstimateBefore - tokensEstimateAfter`.

6. **Tool-triggered compaction** (the `else if (toolUse.name === 'compact_context')` branch inside the tool dispatch loop): Same compaction events for the `compact_context` tool case.

Import `assembleResponseFromStream` from `./stream-assembler.ts`.

Also modify `processEvent` method to publish `turn:start` with `source: 'event'` instead of `source: 'user'` when processing external events (it delegates to `processMessage` internally, so the turn:start for events should be published before that delegation).

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All existing tests pass unchanged (eventBus is not provided in test deps)

**Commit:** `feat(tui): integrate event publishing into agent loop`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Agent event publishing tests

**Verifies:** tui.AC2.1, tui.AC2.2, tui.AC2.3, tui.AC2.4, tui.AC2.5, tui.AC2.6

**Files:**
- Create: `src/agent/agent-events.test.ts`

**Testing:**

Tests must verify each AC:

- **tui.AC2.1:** Create agent with a mock model provider (returning text response) and an event bus. Call `processMessage`. Verify the bus received events in order: `turn:start` → `stream:start` → one or more `stream:chunk` → `stream:end` → `turn:end`.

- **tui.AC2.2:** Create agent with a mock model provider (returning tool_use stop reason on first call, end_turn on second). Call `processMessage`. Verify the bus received `tool:start` and `tool:result` events with correct tool name and ID between stream events.

- **tui.AC2.3:** Verify `turn:start` is the first event and `turn:end` is the last event in every processMessage call.

- **tui.AC2.4:** Create agent with a mock model provider whose stream yields thinking content blocks. Verify `stream:thinking` events are published with the thinking text.

- **tui.AC2.5:** Create agent WITHOUT eventBus (same as existing tests). Verify it still works identically — this is covered by running existing e2e tests unchanged.

- **tui.AC2.6:** Create agent with eventBus and a mock model provider that returns known content via streaming. Compare the final response string to what `complete()` would produce with equivalent content. They should match.

Use the existing mock model provider pattern from `src/integration/e2e.test.ts` as reference, but create a streaming-capable version that yields `StreamEvent` items from the `stream()` method.

Create a helper function `createStreamingMockModelProvider` that accepts configuration similar to `createMockModelProvider` but implements `stream()` by yielding appropriate `StreamEvent` sequence: `message_start` → `content_block_start` → `content_block_delta`(s) → `message_stop`.

These tests verify event publishing order, not database behaviour. Use mock model provider, mock persistence, mock memory, and mock tool registry — no real database needed. Reference the mock patterns from `src/integration/test-helpers.ts` (e.g., `createMockEmbeddingProvider`) and `src/integration/e2e.test.ts` (e.g., `createMockModelProvider`), but keep all mocks in-memory. Place test in `src/agent/` since it's testing agent behaviour.

**Verification:**
Run: `bun test src/agent/agent-events.test.ts`
Expected: All tests pass

**Commit:** `test(tui): add agent event publishing tests`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add export of `assembleResponseFromStream` from `./stream-assembler.ts` to the agent module's barrel export. This function may be useful for testing in later phases.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All tests pass

**Commit:** `feat(tui): export stream assembler from agent module`
<!-- END_TASK_5 -->
