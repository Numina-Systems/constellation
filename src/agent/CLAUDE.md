# Agent

Last verified: 2026-02-28

## Purpose
Implements the core agent loop: receives user messages, builds context from memory, calls the LLM, dispatches tool use, and manages conversation history with context compression.

## Contracts
- **Exposes**: `Agent` type (`processMessage(msg) -> string`, `processEvent(event) -> string`, `getConversationHistory()`, `conversationId`), `ExternalEvent` type, `createAgent(deps, conversationId?)`, context utilities (`buildSystemPrompt`, `buildMessages`, `estimateTokens`, `shouldCompress`)
- **Guarantees**:
  - Each message round persists user input, assistant response, and tool results to the `messages` table
  - Tool dispatch loop runs up to `max_tool_rounds` before stopping
  - `execute_code` tool calls route to the Deno runtime (with optional `ExecutionContext` for credential injection); all other tools route through the registry
  - `processEvent` formats external events as structured user messages (with expanded reply metadata and source-specific `[Instructions:]` blocks) and delegates to `processMessage`
  - Context compression triggers when estimated tokens exceed `context_budget * model_max_tokens`, summarizing old messages via the LLM and archiving to memory
  - Core memory blocks are always included in the system prompt
  - Working memory blocks are prepended to the message context
- **Expects**: All dependencies injected via `AgentDependencies` (optional `getExecutionContext` for credential injection into sandbox). Database connected with migrations applied.

## Dependencies
- **Uses**: `src/model/` (LLM calls), `src/memory/` (context building, archival), `src/tool/` (tool definitions, dispatch), `src/runtime/` (code execution), `src/persistence/` (message persistence)
- **Used by**: `src/index.ts` (composition root)
- **Boundary**: The agent is the only module that calls `ModelProvider.complete`. No other module should make LLM calls except through the agent.

## Key Decisions
- Conversation-per-agent: Each `createAgent` call gets (or resumes) a single conversation
- Compression over truncation: Old messages are LLM-summarized and archived to memory, preserving context
- Token estimation heuristic (1 token ~ 4 chars): Good enough for budget checks without API calls

## Invariants
- `processMessage` always persists at least the user message and final assistant response
- Tool dispatch never exceeds `max_tool_rounds`
- Compressed messages are archived to memory before deletion

## Key Files
- `types.ts` -- `Agent`, `AgentConfig`, `AgentDependencies`, `ConversationMessage`, `ExternalEvent`
- `agent.ts` -- Agent loop implementation (message processing, tool dispatch, compression)
- `context.ts` -- System prompt building, message conversion, token estimation
