# Machine Spirit Core Implementation Plan - Phase 2: Provider Abstraction

**Goal:** LLM and embedding provider ports and adapters, able to send messages and generate embeddings with normalised response types.

**Architecture:** Ports-and-adapters. `ModelProvider` and `EmbeddingProvider` ports defined as TypeScript types. Two LLM adapters (Anthropic native SDK, OpenAI-compatible) and two embedding adapters (OpenAI, Ollama) normalize responses to common types.

**Tech Stack:** @anthropic-ai/sdk, openai npm package, Ollama REST API, Bun test runner

**Scope:** 8 phases from original design (this is phase 2 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phase 1 (scaffolding) provides package.json with dependencies, tsconfig.json, config loading, and persistence layer. No source code exists yet — all files in this phase are new.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC2: Provider abstraction supports Anthropic and OpenAI-compatible endpoints
- **machine-spirit-core.AC2.1 Success:** Anthropic adapter sends messages and receives normalised ModelResponse with text and tool use blocks
- **machine-spirit-core.AC2.2 Success:** Anthropic adapter streams responses as AsyncIterable of StreamEvents
- **machine-spirit-core.AC2.3 Success:** OpenAI-compatible adapter works with configurable baseURL (Kimi, Ollama)
- **machine-spirit-core.AC2.4 Success:** Switching provider via config.toml changes the model without code changes
- **machine-spirit-core.AC2.5 Failure:** Invalid API key returns a structured error, not a crash
- **machine-spirit-core.AC2.6 Failure:** Model API timeout triggers retry with exponential backoff (3 attempts)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: ModelProvider port and shared types

**Verifies:** None (types only — TypeScript compiler verifies these)

**Files:**
- Create: `src/model/types.ts`

**Implementation:**

Define the core types that both LLM adapters normalise to. The `ModelProvider` port is the interface the agent loop depends on — never the adapters directly.

Key types:
- `Message`: role + content (string or array of content blocks)
- `ContentBlock`: discriminated union of `TextBlock | ToolUseBlock | ToolResultBlock`
- `ToolDefinition`: name, description, input_schema (JSON Schema object)
- `ModelRequest`: messages, system prompt, tools, model name, max_tokens, temperature
- `ModelResponse`: content blocks array, stop_reason, usage stats
- `StreamEvent`: discriminated union for streaming (message_start, content_block_start, content_block_delta, message_stop)
- `ModelProvider`: the port with `complete(request) -> ModelResponse` and `stream(request) -> AsyncIterable<StreamEvent>`
- `ModelError`: structured error type with `code: 'auth' | 'rate_limit' | 'timeout' | 'api_error'`, message, retryable flag

The stop_reason should be a string literal union: `'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'`.

Usage stats type: `{ input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }`.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add ModelProvider port and shared model types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Anthropic adapter

**Verifies:** machine-spirit-core.AC2.1, machine-spirit-core.AC2.2, machine-spirit-core.AC2.5, machine-spirit-core.AC2.6

**Files:**
- Create: `src/model/anthropic.ts`
- Test: `src/model/anthropic.test.ts` (integration)

**Implementation:**

Create `createAnthropicAdapter(config: ModelConfig): ModelProvider` factory function that wraps `@anthropic-ai/sdk`.

The `complete` method:
- Calls `client.messages.create()` with normalised parameters
- Maps Anthropic's response content blocks (text, tool_use) to the shared `ContentBlock` type
- Maps `stop_reason` to the shared literal union
- Maps `usage` to the shared usage stats type (including cache tokens if present)
- Catches `Anthropic.AuthenticationError` and wraps it as `ModelError` with `code: 'auth'`
- Catches `Anthropic.RateLimitError` and wraps it as `ModelError` with `code: 'rate_limit'`, `retryable: true`
- Implements retry with exponential backoff (3 attempts) for retryable errors and timeouts

The `stream` method:
- Calls `client.messages.stream()`
- Yields `StreamEvent` objects from the Anthropic stream events
- Maps event types: `message_start`, `content_block_start` (with block type), `content_block_delta` (text delta or tool input delta), `message_stop`

Tool definitions passed to Anthropic use `name`, `description`, `input_schema` directly (Anthropic's format matches our type).

**Testing:**

Tests for this adapter are integration tests requiring a valid `ANTHROPIC_API_KEY` environment variable. They should be skippable when the key is not available.

- machine-spirit-core.AC2.1: Send a simple message, verify response has text content block and valid usage stats
- machine-spirit-core.AC2.1: Send a message with tool definitions, verify response includes tool_use block with correct name and input
- machine-spirit-core.AC2.2: Stream a response, verify events arrive in order (message_start -> content_block_start -> content_block_delta(s) -> message_stop)
- machine-spirit-core.AC2.5: Create adapter with invalid API key, call complete, verify ModelError with code 'auth' is thrown (not an unstructured crash)
- machine-spirit-core.AC2.6: Verify retry logic by testing with a mock/spy that the adapter retries on retryable errors (this can be a unit test with a mock client)

**Verification:**
Run: `ANTHROPIC_API_KEY=test-key bun test src/model/anthropic.test.ts`
Expected: All tests pass (integration tests skip if no valid key)

**Commit:** `feat: add Anthropic model adapter with streaming and retry`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: OpenAI-compatible adapter

**Verifies:** machine-spirit-core.AC2.3, machine-spirit-core.AC2.4, machine-spirit-core.AC2.5, machine-spirit-core.AC2.6

**Files:**
- Create: `src/model/openai-compat.ts`
- Test: `src/model/openai-compat.test.ts` (integration)

**Implementation:**

Create `createOpenAICompatAdapter(config: ModelConfig): ModelProvider` factory function that wraps the `openai` npm package.

The `complete` method:
- Creates an `OpenAI` client with `apiKey` from config and `baseURL` from config's `base_url` field
- Calls `client.chat.completions.create()` with normalised parameters
- Maps OpenAI's response format to shared types:
  - `choices[0].message.content` -> `TextBlock`
  - `choices[0].message.tool_calls` -> array of `ToolUseBlock` (parsing `function.arguments` JSON string)
  - `choices[0].finish_reason` -> stop_reason mapping: `'stop' -> 'end_turn'`, `'tool_calls' -> 'tool_use'`, `'length' -> 'max_tokens'`
  - `usage.prompt_tokens` / `usage.completion_tokens` -> shared usage stats
- Tool definitions are wrapped in OpenAI format: `{ type: 'function', function: { name, description, parameters: input_schema } }`
- Same error handling and retry logic as Anthropic adapter (ModelError, exponential backoff, 3 attempts)

The `stream` method:
- Calls `client.chat.completions.create({ stream: true })`
- Iterates over chunks, mapping to `StreamEvent` objects
- Aggregates tool call deltas (OpenAI streams tool calls as incremental JSON string chunks)

The `baseURL` configuration allows this adapter to work with any OpenAI-compatible endpoint:
- Kimi: `https://api.moonshot.ai/v1`
- Ollama: `http://localhost:11434/v1`
- Any other OpenAI-compatible server

**Testing:**

Integration tests requiring an OpenAI-compatible endpoint. Should skip gracefully when unavailable.

- machine-spirit-core.AC2.3: Create adapter with a custom baseURL, send a message, verify normalised response
- machine-spirit-core.AC2.4: Verify the adapter reads provider and base_url from ModelConfig (test that different configs create different client instances)
- machine-spirit-core.AC2.5: Create adapter with invalid API key, verify ModelError with code 'auth'
- machine-spirit-core.AC2.6: Verify retry logic (unit test with mock)

**Verification:**
Run: `bun test src/model/openai-compat.test.ts`
Expected: All tests pass (integration tests skip if no valid endpoint)

**Commit:** `feat: add OpenAI-compatible model adapter with configurable baseURL`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: EmbeddingProvider port

**Verifies:** None (types only)

**Files:**
- Create: `src/embedding/types.ts`

**Implementation:**

Define the embedding provider port:
- `EmbeddingProvider` type with:
  - `embed(text: string): Promise<Array<number>>` — single text to vector
  - `embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>>` — batch texts to vectors
  - `dimensions: number` — vector dimensions (used to configure pgvector column)

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add EmbeddingProvider port interface`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: OpenAI embeddings adapter

**Verifies:** None directly (embedding adapters are verified via integration in Phase 3 memory system)

**Files:**
- Create: `src/embedding/openai.ts`
- Test: `src/embedding/openai.test.ts` (integration)

**Implementation:**

Create `createOpenAIEmbeddingAdapter(config: EmbeddingConfig): EmbeddingProvider` factory function.

- Uses the `openai` npm package's `client.embeddings.create()` API
- `embed`: calls with `model` from config and single `input` string, returns `response.data[0].embedding`
- `embedBatch`: calls with array of inputs, returns array of embeddings mapped from `response.data`
- `dimensions`: from config
- Handles errors similarly to the model adapters (wraps in structured error)

**Testing:**

Integration tests requiring `OPENAI_API_KEY` or equivalent. Skip if unavailable.

- Send a single text, verify returned vector has correct dimensions
- Send a batch of texts, verify returned array length matches input length and each vector has correct dimensions

**Verification:**
Run: `bun test src/embedding/openai.test.ts`
Expected: All tests pass (skip if no API key)

**Commit:** `feat: add OpenAI embeddings adapter`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Ollama embeddings adapter

**Verifies:** None directly (embedding adapters are verified via integration in Phase 3 memory system)

**Files:**
- Create: `src/embedding/ollama.ts`
- Test: `src/embedding/ollama.test.ts` (integration)

**Implementation:**

Create `createOllamaEmbeddingAdapter(config: EmbeddingConfig): EmbeddingProvider` factory function.

- Uses `fetch()` to call the Ollama REST API directly at `${config.endpoint}/api/embed`
- `embed`: POSTs `{ model: config.model, input: text }`, returns `response.embeddings[0]`
- `embedBatch`: POSTs `{ model: config.model, input: texts }`, returns `response.embeddings`
- `dimensions`: from config
- Handles connection errors (Ollama not running) with structured error

The endpoint defaults to `http://localhost:11434` if not configured.

**Testing:**

Integration tests requiring a running Ollama instance. Skip if unavailable.

- Send a single text, verify returned vector has correct dimensions
- Send a batch, verify array length and dimensions

**Verification:**
Run: `bun test src/embedding/ollama.test.ts`
Expected: All tests pass (skip if Ollama unavailable)

**Commit:** `feat: add Ollama embeddings adapter`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: Provider factory and config-driven wiring

**Verifies:** machine-spirit-core.AC2.4

**Files:**
- Create: `src/model/factory.ts`
- Create: `src/embedding/factory.ts`
- Test: `src/model/factory.test.ts` (unit)
- Test: `src/embedding/factory.test.ts` (unit)

**Implementation:**

Create factory functions that read the config and return the appropriate adapter:

`src/model/factory.ts`:
- `createModelProvider(config: ModelConfig): ModelProvider`
- Switches on `config.provider`:
  - `'anthropic'` -> `createAnthropicAdapter(config)`
  - `'openai-compat'` -> `createOpenAICompatAdapter(config)`
  - default -> throw with descriptive error listing valid providers

`src/embedding/factory.ts`:
- `createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider`
- Switches on `config.provider`:
  - `'openai'` -> `createOpenAIEmbeddingAdapter(config)`
  - `'ollama'` -> `createOllamaEmbeddingAdapter(config)`
  - default -> throw with descriptive error listing valid providers

**Testing:**

Unit tests (no external services needed):

- machine-spirit-core.AC2.4: Verify that changing `provider` in config returns different adapter types
- Verify unknown provider throws descriptive error

**Verification:**
Run: `bun test src/model/factory.test.ts src/embedding/factory.test.ts`
Expected: All tests pass

**Commit:** `feat: add config-driven provider factories`
<!-- END_TASK_7 -->
