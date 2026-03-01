# Compaction V2 Design

## Summary

Constellation's compaction pipeline handles the problem of LLM context windows filling up: when a conversation's token budget is exceeded, older messages are summarized and archived to make room for new ones. This design refactors two aspects of that pipeline. First, it replaces a fragile `{placeholder}` string-interpolation approach to building summarization prompts with structured conversation messages — giving the LLM proper role context (system identity, prior summaries, original conversation turns, and a closing directive) rather than a single interpolated blob of text. Second, it introduces heuristic importance scoring so that when messages must be compressed, the least important ones go first: low-weight messages (old, short, purely assistant-generated) are compressed before high-weight ones (recent, question-bearing, tool-call-containing).

Both changes are implemented against the existing port/adapter architecture. The `Message` type gains `role: 'system'` as a first-class value, with each LLM adapter (Anthropic, OpenAI-compatible) translating it into the format its provider expects. Scoring is a pure function with configurable weights exposed through the existing TOML config schema. Persona injection — previously threaded through the compaction pipeline as a callback — is removed entirely; the agent's voice in summaries now comes from the user's own system prompt in config, reducing coupling.

## Definition of Done

1. **Structured summarization prompts** — The compaction pipeline sends summarization requests as structured conversation messages (system prompt + previous summaries as system messages + messages to summarize + directive), replacing the current `{placeholder}` template interpolation. Config `prompt` field is just a system prompt string.

2. **Extended ModelRequest** — The `Message` type supports `role: 'system'` alongside 'user' and 'assistant', with both adapters (Anthropic, OpenAI-compat) handling system-role messages correctly.

3. **Importance-based message scoring** — A heuristic scoring strategy (role weight, recency, content length, keywords, tool calls) determines which messages to compress first, inspired by pattern/numina's `ImportanceScoringConfig`.

4. **Persona via custom prompt only** — No automatic persona injection; the agent's voice in summaries comes entirely from the user's custom system prompt in config.

## Acceptance Criteria

### compaction-v2.AC1: Structured Summarization Prompts
- **compaction-v2.AC1.1 Success:** Summarization LLM call uses `system` field for config prompt (or default) and passes messages as structured conversation
- **compaction-v2.AC1.2 Success:** Previous compaction summary is passed as a system-role message in the messages array
- **compaction-v2.AC1.3 Success:** Actual conversation messages preserve their original roles (user/assistant) in the summarization request
- **compaction-v2.AC1.4 Success:** Baked-in directive appears as final user message with preserve/condense/prioritize/remove instructions
- **compaction-v2.AC1.5 Edge:** No previous summary results in no system-role context message (not an empty one)
- **compaction-v2.AC1.6 Edge:** Re-summarization (`resummarizeBatches`) uses the same structured message approach

### compaction-v2.AC2: Extended ModelRequest
- **compaction-v2.AC2.1 Success:** `Message` type accepts `role: 'system'` alongside 'user' and 'assistant'
- **compaction-v2.AC2.2 Success:** Anthropic adapter extracts system-role messages from array and merges with `request.system` field
- **compaction-v2.AC2.3 Success:** OpenAI-compat adapter passes system-role messages through as `{ role: 'system' }` in OpenAI format
- **compaction-v2.AC2.4 Success:** Existing `request.system` field continues to work for backward compatibility
- **compaction-v2.AC2.5 Edge:** Multiple system-role messages in array are handled correctly (concatenated for Anthropic, sequential for OpenAI)

### compaction-v2.AC3: Importance-Based Scoring
- **compaction-v2.AC3.1 Success:** Messages scored by role weight (system > user > assistant by default)
- **compaction-v2.AC3.2 Success:** Newer messages score higher than older messages via recency decay
- **compaction-v2.AC3.3 Success:** Content signals (questions, tool calls, keywords) increase score
- **compaction-v2.AC3.4 Success:** `splitHistory()` returns `toCompress` sorted by importance ascending (lowest-scored first)
- **compaction-v2.AC3.5 Success:** Scoring config is customizable via `[summarization]` TOML section
- **compaction-v2.AC3.6 Edge:** Messages with identical scores maintain their original chronological order (stable sort)

### compaction-v2.AC4: Persona Via Custom Prompt Only
- **compaction-v2.AC4.1 Success:** No code path in compaction module injects persona content
- **compaction-v2.AC4.2 Success:** `getPersona` callback is fully removed from `CreateCompactorOptions`
- **compaction-v2.AC4.3 Success:** Custom `prompt` in config is used as-is for the system prompt (no transformation)
- **compaction-v2.AC4.4 Success:** Absent custom prompt falls back to default generic system prompt

## Glossary

- **Compaction**: The process of compressing older conversation history when the LLM context window approaches its token limit. Messages are summarized, archived to long-term memory, and replaced with a compact representation.
- **Context window**: The maximum number of tokens an LLM can process in a single request, spanning both the input prompt and generated response.
- **Token budget**: The configured threshold below which the running conversation history must be kept. Compaction triggers when this is exceeded.
- **Clip-archive**: A special system message inserted into the active conversation history after compaction, recording that a compression event occurred and what was summarized.
- **`splitHistory()`**: The function that divides the full message history into two parts: a recent tail that is always preserved verbatim, and an older portion eligible for compression.
- **`chunkMessages()`**: Takes the compressible portion of history and groups messages into batches, which are then each summarized independently.
- **Re-summarization (`resummarizeBatches`)**: A second-pass summarization that collapses multiple batch summaries into a single cohesive one, applied when there are too many summaries to keep.
- **Importance scoring**: A heuristic numeric score assigned to each compressible message. Higher-scored messages survive compression longer; lower-scored ones are compressed first.
- **Recency decay**: A scoring factor that gives newer messages higher importance scores using exponential decay by position in the history.
- **Directive message**: A baked-in final user message appended to every summarization request, instructing the LLM on what to preserve, condense, prioritize, or discard.
- **Structured summarization**: The replacement approach for building summarization LLM requests — using discrete, typed messages with proper roles rather than string interpolation into a prompt template.
- **Port/adapter boundary**: An architectural pattern used throughout the codebase. The "port" is a shared interface or type (e.g., `Message`); "adapters" are provider-specific implementations (e.g., `anthropic.ts`, `openai-compat.ts`) that translate the shared contract into what each external service expects.
- **Functional Core / Imperative Shell**: An architectural pattern separating pure functions with no side effects (Functional Core — scoring, splitting, chunking) from code that performs I/O or orchestration (Imperative Shell — the `compress()` pipeline, LLM calls).
- **Zod**: A TypeScript-first schema validation library used for validating and typing config values loaded from TOML.
- **`pattern/numina`**: A reference codebase whose `ImportanceScoringConfig` design inspired the scoring approach in this document.
- **`getPersona`**: A callback previously threaded through `CreateCompactorOptions` that injected agent personality text into summarization prompts. This design removes it.
- **Composition root**: The application entry point (`src/index.ts`) where all dependencies are wired together. Changes to factory function signatures (e.g., removing `getPersona`) surface here.
- **TOML**: The config file format used by Constellation (`config.toml`). Parsed and validated against Zod schemas at startup.

## Architecture

Two changes to the compaction pipeline: restructured summarization LLM calls and importance-based message scoring.

### Structured Summarization Calls

The current `{placeholder}` template interpolation system (`interpolatePrompt`, `DEFAULT_SUMMARIZATION_PROMPT` in `src/compaction/prompt.ts`) is replaced with structured conversation messages sent to the LLM. The summarization request becomes:

- **`system` field**: The config `prompt` value (or a generic default). This is the summarizer's identity — lasa's custom prompt lives here.
- **System-role message**: Previous compaction summary (if any), passed as `{ role: 'system', content: 'Previous summary of conversation:\n...' }` in the messages array.
- **Conversation messages**: The actual messages to summarize, passed with their original roles preserved (user/assistant).
- **Directive message**: A baked-in final user message with preserve/condense/prioritize/remove instructions, inspired by pattern/numina's approach.

The config `prompt` field in `[summarization]` becomes a plain system prompt string with no placeholders. The `getPersona` dependency is removed from `CreateCompactorOptions` — persona injection comes entirely from the user's custom prompt.

### Importance-Based Message Scoring

A pure scoring function assigns numeric importance to each message in the compressible range. Scoring factors (all configurable with defaults):

- **Role weight**: system (10.0), user (5.0), assistant (3.0)
- **Recency**: Exponential decay by position — newer messages score higher
- **Content signals**: Question marks (+2.0), tool calls (+4.0), important keywords (+1.5 per match), content length (+1.0 per 100 chars, capped at 3.0)

The existing `splitHistory()` is modified: it still unconditionally keeps the last `keepRecent` messages, but the older messages are sorted by score ascending (lowest importance = compressed first). Chunking then processes lowest-scored messages first, so the most important older messages survive longest.

### ModelRequest Extension

The `Message` type in `src/model/types.ts` gains `'system'` as a valid role. Adapter changes:

- **Anthropic** (`src/model/anthropic.ts`): Extracts system-role messages from the array and concatenates them with the `request.system` field (joined by `\n\n`), since the Anthropic SDK takes system as a separate parameter.
- **OpenAI-compat** (`src/model/openai-compat.ts`): Maps system-role messages through directly as `{ role: "system", content: string }` in the OpenAI format. The existing `request.system` prepend stays for backward compatibility.

### Data Flow

```
Agent loop detects token budget exceeded
  → compactor.compress(history, conversationId)
    → splitHistory: keep recent, score older messages, sort by importance
    → chunkMessages: chunk lowest-importance messages first
    → for each chunk:
        → build structured ModelRequest (system prompt + prev summary + messages + directive)
        → model.complete(request) → summary text
        → archive batch to memory
    → check re-summarization threshold
    → delete compressed messages from DB
    → insert clip-archive system message
    → return compressed history
```

## Existing Patterns

The design follows established patterns in the codebase:

- **Port/adapter boundary**: The `Message` type in `src/model/types.ts` is the port interface. Adapters in `src/model/anthropic.ts` and `src/model/openai-compat.ts` normalize to provider-specific formats. The system-role extension follows this pattern — the port defines the contract, adapters handle provider differences.
- **Functional Core / Imperative Shell**: Scoring functions, `splitHistory`, `chunkMessages`, `buildClipArchive` remain pure (Functional Core). The `compress` pipeline and LLM calls remain Imperative Shell.
- **Factory functions**: `createCompactor()` returns a `Compactor` interface, consistent with `createAgent()`, `createModelProvider()`, etc.
- **Zod config schemas**: Scoring config fields are added to `SummarizationConfigSchema` with `.default()` values, following the existing pattern in `src/config/schema.ts`.
- **Context builder convention**: `buildMessages()` in `src/agent/context.ts` continues converting `role: 'system'` to `role: 'user'` for the agent loop. The system-role in messages is used specifically by the compaction pipeline for its summarization calls, not by the main agent context builder.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Extend ModelRequest Message Type
**Goal:** Add `'system'` as a valid role in the `Message` type and update both adapters to handle it.

**Components:**
- `src/model/types.ts` — Add `'system'` to `Message.role` union type
- `src/model/anthropic.ts` — Extract system-role messages from array, merge with `request.system` field
- `src/model/openai-compat.ts` — Pass system-role messages through directly in OpenAI format
- `src/model/anthropic.test.ts` — Tests for system-role message handling
- `src/model/openai-compat.test.ts` — Tests for system-role message handling

**Dependencies:** None

**Done when:** Both adapters correctly handle system-role messages in the messages array. Existing tests still pass (backward compatibility with `request.system` field). Covers compaction-v2.AC2.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Refactor Summarization Prompt System
**Goal:** Replace `{placeholder}` interpolation with structured conversation messages for summarization LLM calls.

**Components:**
- `src/compaction/prompt.ts` — Replace `interpolatePrompt()` and `DEFAULT_SUMMARIZATION_PROMPT` with `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_DIRECTIVE`, and a `buildSummarizationRequest()` function that constructs structured messages
- `src/compaction/compactor.ts` — Update `summarizeChunk()` to use `buildSummarizationRequest()` instead of `interpolatePrompt()`. Update `resummarizeBatches()` similarly. Remove `persona` and `template` parameters from `ResummarizeBatchesOptions`.
- `src/compaction/types.ts` — Update `CompactionConfig.prompt` to clarify it's a system prompt string (no functional change, just documentation)
- `src/compaction/prompt.test.ts` — Replace interpolation tests with structured message builder tests
- `src/compaction/compactor.test.ts` — Update tests for new call structure

**Dependencies:** Phase 1 (system-role messages in ModelRequest)

**Done when:** Summarization calls use structured messages. No `{placeholder}` interpolation remains. Config `prompt` field works as a plain system prompt. Covers compaction-v2.AC1 and compaction-v2.AC4.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Remove Persona Injection
**Goal:** Remove automatic persona injection from the compaction pipeline.

**Components:**
- `src/compaction/compactor.ts` — Remove `getPersona` from `CreateCompactorOptions`, remove `persona` parameter threading through `summarizeChunk()` and `resummarizeBatches()`
- `src/index.ts` — Remove `getPersona` from `createCompactor()` call in composition root
- `src/compaction/compactor.test.ts` — Update tests to not provide `getPersona`

**Dependencies:** Phase 2 (new prompt structure doesn't need persona)

**Done when:** No code path injects persona into summarization. The `getPersona` callback is fully removed from the compaction module. Covers compaction-v2.AC4.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Importance Scoring
**Goal:** Add heuristic importance scoring for messages and integrate with `splitHistory()`.

**Components:**
- `src/compaction/scoring.ts` (new) — Pure scoring function: `scoreMessage(msg, index, total, config) → number`. Configurable weights for role, recency decay, content signals.
- `src/compaction/types.ts` — Add `ImportanceScoringConfig` type with role weights, recency decay mode, bonus values
- `src/compaction/compactor.ts` — Update `splitHistory()` to score older messages and sort by importance before returning `toCompress`
- `src/compaction/scoring.test.ts` (new) — Tests for scoring function: role weights, recency decay, content signals
- `src/compaction/compactor.test.ts` — Update split tests for importance-ordered output

**Dependencies:** None (can be done in parallel with Phases 1-3, but sequenced for simplicity)

**Done when:** Messages are scored by configurable heuristics. `splitHistory()` returns `toCompress` sorted by importance (lowest first). Covers compaction-v2.AC3.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Config Schema Update
**Goal:** Add importance scoring fields to the `[summarization]` config section.

**Components:**
- `src/config/schema.ts` — Add scoring fields to `SummarizationConfigSchema` (all optional with defaults): `role_weight_system`, `role_weight_user`, `role_weight_assistant`, `recency_decay`, `question_bonus`, `tool_call_bonus`, `keyword_bonus`, `important_keywords`, `content_length_weight`
- `src/config/config.ts` — Update type re-exports if new types are added
- `src/index.ts` — Wire scoring config from `config.summarization` into `createCompactor()` call
- `config.toml.example` — Add commented scoring config examples

**Dependencies:** Phase 4 (scoring types exist)

**Done when:** Scoring fields are configurable via TOML. Defaults match the values from Phase 4. Zod validates the config. Covers compaction-v2.AC3.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Integration Test
**Goal:** End-to-end verification that the refactored compaction pipeline works with structured prompts and importance scoring.

**Components:**
- `src/integration/e2e.test.ts` or `src/compaction/compactor.test.ts` — Integration test exercising the full pipeline: build history with varied message types, trigger compaction, verify structured LLM call shape, verify importance ordering, verify clip-archive output

**Dependencies:** Phases 1-5

**Done when:** Full pipeline test passes with structured messages, importance scoring, and no persona injection. Covers all ACs end-to-end.
<!-- END_PHASE_6 -->

## Additional Considerations

**Backward compatibility:** The `request.system` field on `ModelRequest` remains optional and functional. Existing code that uses it (the agent loop's `buildSystemPrompt()`) is unaffected. The system-role extension is additive.

**Re-summarization:** `resummarizeBatches()` gets the same structured prompt treatment as `summarizeChunk()`. The `ResummarizeBatchesOptions` type drops `persona` and `template`, gaining `systemPrompt: string | null` instead.
