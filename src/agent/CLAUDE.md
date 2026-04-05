# Agent

Last verified: 2026-04-05

## Purpose
Implements the core agent loop: receives user messages, builds context from memory, calls the LLM, dispatches tool use, and manages conversation history. Delegates context compression to an optional `Compactor` dependency, injects relevant skills into the system prompt per turn via optional `SkillRegistry` dependency, optionally records operation traces for every tool dispatch via `TraceRecorder`, and optionally publishes lifecycle events to an `AgentEventBus` for TUI integration.

## Contracts
- **Exposes**: `Agent` type (`processMessage(msg) -> string`, `processEvent(event) -> string`, `getConversationHistory()`, `conversationId`), `ExternalEvent` type, `ContextProvider` type, `createAgent(deps, conversationId?)`, `createSchedulingContextProvider(scheduleDids, watchedDids)`, `assembleResponseFromStream()`, context utilities (`buildSystemPrompt`, `buildMessages`, `estimateTokens`, `shouldCompress`)
- **Guarantees**:
  - Each message round persists user input, assistant response (including `reasoning_content` for thinking-mode models), and tool results to the `messages` table; user and assistant messages include generated embeddings (null on provider absence/error)
  - Tool dispatch loop runs up to `max_tool_rounds` before stopping
  - `execute_code` tool calls route to the Deno runtime (with optional `ExecutionContext` for credential injection); `compact_context` routes to the `Compactor`; all other tools route through the registry
  - `processEvent` formats external events as structured user messages (with expanded reply metadata and source-specific `[Instructions:]` blocks) and delegates to `processMessage`
  - Context compression triggers automatically when estimated tokens exceed `context_budget * model_max_tokens` (requires `compactor` in deps)
  - The agent can also be triggered to compact via the `compact_context` tool call
  - Core memory blocks are always included in the system prompt
  - Working memory blocks are prepended to the message context
  - Optional `contextProviders` are called during system prompt construction, and their output (if non-empty) is appended to the prompt
  - Relevant skills are injected into the system prompt per turn (requires `skills` in deps; uses `max_skills_per_turn` and `skill_threshold` config)
  - If `traceRecorder` is present, every tool dispatch (including execute_code and compact_context) is traced fire-and-forget with timing, success/failure, and output summary
  - If `eventBus` is present, the agent publishes lifecycle events: `turn:start`, `turn:end`, `tool:start`, `tool:result`, `compaction:start`, `compaction:end`, `event:received`. When `eventBus` is present, LLM calls use `assembleResponseFromStream` (streaming) instead of `model.complete` (batch), publishing `stream:start`, `stream:chunk`, `stream:thinking`, and `stream:end` events for real-time display.
- **Expects**: All dependencies injected via `AgentDependencies` (optional `getExecutionContext` for credential injection into sandbox, optional `compactor` for compression, optional `contextProviders` for dynamic system prompt sections, optional `skills` for per-turn skill injection, optional `traceRecorder` for operation tracing, optional `embedding` for message embedding generation, optional `owner` for trace identity, optional `sourceInstructions` map for per-source context injection, optional `eventBus` for TUI event publishing). Database connected with migrations applied.

## Dependencies
- **Uses**: `src/model/` (LLM calls + streaming), `src/memory/` (context building), `src/tool/` (tool definitions, dispatch), `src/runtime/` (code execution), `src/persistence/` (message persistence), `src/embedding/` (optional, message embedding generation), `src/compaction/` (optional, via `Compactor` interface), `src/skill/` (optional, skill retrieval and formatting), `src/reflexion/` (optional, via `TraceRecorder` interface), `src/tui/` (optional, via `AgentEventBus` interface)
- **Used by**: `src/index.ts` (composition root)
- **Boundary**: The agent is the primary caller of `ModelProvider.complete` (or `ModelProvider.stream` when event bus is present). The compaction module also makes LLM calls for summarization via its own injected `ModelProvider`. The skill module provides semantic skill retrieval per turn.

## Key Decisions
- Conversation-per-agent: Each `createAgent` call gets (or resumes) a single conversation
- Compression delegated to Compactor: Agent no longer contains summarization logic; it delegates to an injected `Compactor` (or skips compression if absent)
- Token estimation heuristic (1 token ~ 4 chars): Good enough for budget checks without API calls
- Streaming when event bus present: When `eventBus` is injected, the agent uses `assembleResponseFromStream` to stream LLM responses while publishing events. Without it, uses batch `complete()` -- zero-cost abstraction for non-TUI mode

## Invariants
- `processMessage` always persists at least the user message and final assistant response (with `reasoning_content` when present)
- Tool dispatch never exceeds `max_tool_rounds`
- Compressed messages are archived to memory before deletion

## Key Files
- `types.ts` -- `Agent`, `AgentConfig` (includes `max_skills_per_turn`, `skill_threshold`), `AgentDependencies` (includes optional `compactor`, `getExecutionContext`, `traceRecorder`, `embedding`, `owner`, `contextProviders`, `skills`, `sourceInstructions`, `eventBus`), `ConversationMessage`, `ExternalEvent`, `ContextProvider`
- `agent.ts` -- Agent loop implementation (message processing, tool dispatch, compression, skill injection, trace recording, event publishing, external event formatting with per-source instructions)
- `stream-assembler.ts` -- `assembleResponseFromStream()`: converts `AsyncIterable<StreamEvent>` into `ModelResponse` while publishing stream events to event bus
- `context.ts` -- System prompt building, message conversion, token estimation, context provider integration
- `scheduling-context.ts` -- Scheduling context provider (DID authority injection into system prompt)
