# Agent

Last verified: 2026-02-28

## Purpose
Implements the core agent loop: receives user messages, builds context from memory, calls the LLM, dispatches tool use, and manages conversation history. Delegates context compression to an optional `Compactor` dependency.

## Contracts
- **Exposes**: `Agent` type (`processMessage(msg) -> string`, `getConversationHistory()`, `conversationId`), `createAgent(deps, conversationId?)`, context utilities (`buildSystemPrompt`, `buildMessages`, `estimateTokens`, `shouldCompress`)
- **Guarantees**:
  - Each message round persists user input, assistant response, and tool results to the `messages` table
  - Tool dispatch loop runs up to `max_tool_rounds` before stopping
  - `execute_code` tool calls route to the Deno runtime; `compact_context` routes to the `Compactor`; all other tools route through the registry
  - Context compression triggers automatically when estimated tokens exceed `context_budget * model_max_tokens` (requires `compactor` in deps)
  - The agent can also be triggered to compact via the `compact_context` tool call
  - Core memory blocks are always included in the system prompt
  - Working memory blocks are prepended to the message context
- **Expects**: All dependencies injected via `AgentDependencies`. `compactor` is optional; without it, compression is skipped. Database connected with migrations applied.

## Dependencies
- **Uses**: `src/model/` (LLM calls), `src/memory/` (context building), `src/tool/` (tool definitions, dispatch), `src/runtime/` (code execution), `src/persistence/` (message persistence), `src/compaction/` (optional, via `Compactor` interface)
- **Used by**: `src/index.ts` (composition root)
- **Boundary**: The agent is the primary caller of `ModelProvider.complete`. The compaction module also makes LLM calls for summarization via its own injected `ModelProvider`.

## Key Decisions
- Conversation-per-agent: Each `createAgent` call gets (or resumes) a single conversation
- Compression delegated to Compactor: Agent no longer contains summarization logic; it delegates to an injected `Compactor` (or skips compression if absent)
- Token estimation heuristic (1 token ~ 4 chars): Good enough for budget checks without API calls

## Invariants
- `processMessage` always persists at least the user message and final assistant response
- Tool dispatch never exceeds `max_tool_rounds`
- Compressed messages are archived to memory before deletion

## Key Files
- `types.ts` -- `Agent`, `AgentConfig`, `AgentDependencies` (includes optional `compactor`), `ConversationMessage`
- `agent.ts` -- Agent loop implementation (message processing, tool dispatch)
- `context.ts` -- System prompt building, message conversion, token estimation
