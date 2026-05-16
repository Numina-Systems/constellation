# Agent

Last verified: 2026-05-16

## Purpose
Implements the core agent loop: receives user messages, builds context from memory, calls the LLM, dispatches tool use, and manages conversation history. Delegates context compression to an optional `Compactor` dependency, injects relevant skills into the system prompt per turn via optional `SkillRegistry` dependency, and optionally records operation traces for every tool dispatch via `TraceRecorder`.

## Contracts
- **Exposes**: `Agent` type (`processMessage(msg) -> string`, `processEvent(event) -> string`, `getConversationHistory()`, `conversationId`), `ExternalEvent` type, `ContextProvider` type, `ProviderClassification` type (`'stable' | 'dynamic'`), `ClassifiedProvider` type, `SnapshotMode` type (`'full' | 'delta' | 'noop'`), `SnapshotResult` type, `SnapshotState` type, `CacheDiagnostics` type, `CacheDimension` type, `CacheBustEvent` type, `SuppressionFlags` type, `CheckForCacheBustOptions` type, `SessionCheckpoint` type, `CheckpointAgentState` type, `CheckpointTrigger` type, `SessionCheckpointSchema` (Zod), `restoreFromCheckpoint(checkpoint, deps)`, `createAgent(deps, conversationId?)`, `createSnapshotState()`, `createCacheDiagnostics()`, `buildUserMessage(text, snapshot)`, `createSchedulingContextProvider(scheduleDids, watchedDids)`, context utilities (`buildSystemPrompt`, `buildMessages`, `estimateTokens`, `estimateOverheadTokens`, `shouldCompress`, `truncateOldest`). AgentConfig includes optional `recall_enabled`, `recall_token_budget`, and `cache_diagnostics` fields. AgentDependencies includes optional `recallContextState`, `searchStore`, `summarizationModel`, `summarizationModelName`, and `classifiedProviders` fields.
- **Guarantees**:
  - Each message round persists user input, assistant response (including `reasoning_content` for thinking-mode models), and tool results to the `messages` table; user and assistant messages include generated embeddings (null on provider absence/error)
  - Tool dispatch loop runs up to `max_tool_rounds` before stopping
  - `execute_code` tool calls route to the Deno runtime (with optional `ExecutionContext` for credential injection); `compact_context` routes to the `Compactor`; all other tools route through the registry
  - `processEvent` formats external events as structured user messages (with expanded reply metadata and source-specific `[Instructions:]` blocks) and delegates to `processMessage`
  - Context compression triggers automatically when estimated tokens (including overhead from system prompt, tools, and output reservation) exceed `context_budget * model_max_tokens` (requires `compactor` in deps)
  - Pre-flight guard: after context building, if estimated total request tokens exceed the model's context window, `truncateOldest` drops oldest droppable messages while preserving leading system messages and the most recent user message
  - The agent can also be triggered to compact via the `compact_context` tool call
  - Core memory blocks are always included in the system prompt
  - Working memory blocks are prepended to the message context
  - System prompt is stable when tools and persona haven't changed (no dynamic context providers appended)
  - Dynamic context providers are routed through snapshot state in user message attachments (Phase 4)
  - Relevant skills are injected into the system prompt per turn (requires `skills` in deps; uses `max_skills_per_turn` and `skill_threshold` config)
  - If `traceRecorder` is present, every tool dispatch (including execute_code and compact_context) is traced fire-and-forget with timing, success/failure, and output summary
  - When `cache_diagnostics` config is true (default), cache-bust detection runs before every `model.complete()` call, comparing content hashes across four dimensions (system_prompt, tool_definitions, message_prefix, beta_headers); unexpected changes emit console warnings and record traces; expected changes (compaction, tool mutation, first turn) are suppressed
- **Expects**: All dependencies injected via `AgentDependencies` (optional `getExecutionContext` for credential injection into sandbox, optional `compactor` for compression, optional `contextProviders` for backward compat (deprecated), optional `classifiedProviders` for phase 4 snapshot routing, optional `skills` for per-turn skill injection, optional `traceRecorder` for operation tracing, optional `embedding` for message embedding generation, optional `owner` for trace identity, optional `sourceInstructions` map for per-source context injection, optional `recallContextState` and `searchStore` for reflexive recall, optional `summarizationModel` and `summarizationModelName` for recall summarization). Database connected with migrations applied.
  - **Recall guarantee**: The recall step fires once per turn (cached across tool rounds) when `recall_enabled` config is true AND `recallContextState` dependency is provided. Requires `searchStore` to be present; returns gracefully if missing. The result is cached across tool rounds so the user message is only searched once per turn, and the system prompt is rebuilt with recalled context injected.

## Dependencies
- **Uses**: `src/model/` (LLM calls), `src/memory/` (context building), `src/tool/` (tool definitions, dispatch), `src/runtime/` (code execution), `src/persistence/` (message persistence), `src/embedding/` (optional, message embedding generation), `src/compaction/` (optional, via `Compactor` interface), `src/skill/` (optional, skill retrieval and formatting), `src/reflexion/` (optional, via `TraceRecorder` interface), `src/recall/` (optional, reflexive recall pipeline and context provider)
- **Used by**: `src/index.ts` (composition root)
- **Boundary**: The agent is the primary caller of `ModelProvider.complete`. The compaction module also makes LLM calls for summarization via its own injected `ModelProvider`. The skill module provides semantic skill retrieval per turn.

## Key Decisions
- Conversation-per-agent: Each `createAgent` call gets (or resumes) a single conversation
- Compression delegated to Compactor: Agent no longer contains summarization logic; it delegates to an injected `Compactor` (or skips compression if absent)
- Token estimation heuristic (1 token ~ 4 chars): Good enough for budget checks without API calls
- Pre-flight truncation as safety net: Even after compaction, the request may still exceed the model's context window (e.g., large tool definitions, long system prompt). `truncateOldest` provides a hard guard that never sends an over-budget request
- Cache diagnostics as observability, not enforcement: Detects unexpected cache busts via content hashing but only warns/traces -- never blocks the request. Suppression flags prevent false positives from known-good mutations (compaction, tool changes, first turn)

## Invariants
- `processMessage` always persists at least the user message and final assistant response (with `reasoning_content` when present)
- Tool dispatch never exceeds `max_tool_rounds`
- Compressed messages are archived to memory before deletion

## Key Files
- `types.ts` -- `Agent`, `AgentConfig` (includes `max_skills_per_turn`, `skill_threshold`, optional `recall_enabled`, `recall_token_budget`, `cache_diagnostics`), `AgentDependencies` (includes optional `compactor`, `getExecutionContext`, `traceRecorder`, `embedding`, `owner`, `contextProviders`, `classifiedProviders`, `skills`, `sourceInstructions`, `recallContextState`, `searchStore`, `summarizationModel`, `summarizationModelName`), `ConversationMessage`, `ExternalEvent`, `ContextProvider`, `ProviderClassification`, `ClassifiedProvider`
- `agent.ts` -- Agent loop implementation (message processing, tool dispatch, compression, skill injection, trace recording, external event formatting with per-source instructions)
- `context.ts` -- System prompt building (memory only, no dynamic providers), message conversion, token estimation, overhead estimation, pre-flight truncation (`truncateOldest`)
- `snapshot.ts` -- Batch-anchored snapshot state (`createSnapshotState`): per-provider content hashing via `Bun.hash()`, snapshot mode detection (full/delta/noop), tracks hash changes across calls
- `messages.ts` -- User message composition (`buildUserMessage`): builds Anthropic-compatible user messages with optional dynamic context attachment blocks from snapshot results
- `cache-diagnostics.ts` -- Cache-bust detection (Functional Core): per-dimension content hashing via `Bun.hash()`, suppression logic for expected changes, `createCacheDiagnostics()` factory
- `scheduling-context.ts` -- Scheduling context provider (DID authority injection into system prompt)
- `checkpoint-types.ts` -- `SessionCheckpoint`, `CheckpointAgentState`, `CheckpointTrigger`, Zod schema for checkpoint validation
- `checkpoint-restore.ts` -- `restoreFromCheckpoint(checkpoint, deps)`: atomic three-tier restoration (pre-flight validation, message integrity check, subsystem replay)
