# Ollama Model Provider Adapter Implementation Plan

**Goal:** Make Ollama a first-class model provider in Constellation, sitting alongside Anthropic and OpenAI-compat behind the `ModelProvider` port.

**Architecture:** Single-file adapter at `src/model/ollama.ts` using raw `fetch()` against Ollama's native `/api/chat` endpoint. Follows the port/adapter pattern established by `src/model/anthropic.ts` and `src/model/openai-compat.ts`. Functional Core / Imperative Shell with file-level annotations.

**Tech Stack:** Bun (TypeScript, ESM), Zod for config validation, raw `fetch()` for HTTP (no SDK dependency)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ollama-adapter.AC2: ModelProvider contract
- **ollama-adapter.AC2.1 Success:** `complete()` returns `ModelResponse` with non-empty `content` array

### ollama-adapter.AC3: Tool use
- **ollama-adapter.AC3.2 Success:** Ollama `tool_calls` response maps to `ToolUseBlock` array with generated UUIDs for `id` field
- **ollama-adapter.AC3.3 Success:** `stop_reason` is `"tool_use"` when response contains `tool_calls` (regardless of `done_reason` value)
- **ollama-adapter.AC3.5 Success:** Multiple parallel tool calls in single response all translate to `ToolUseBlock` entries

### ollama-adapter.AC4: Thinking/reasoning
- **ollama-adapter.AC4.2 Success:** Ollama `message.thinking` maps to `reasoning_content` on `ModelResponse`

### ollama-adapter.AC5: Error handling and retry
- **ollama-adapter.AC5.1 Success:** HTTP 429 classifies as `ModelError("rate_limit", retryable: true)`
- **ollama-adapter.AC5.2 Success:** HTTP 500/502 classifies as `ModelError("api_error", retryable: true)`
- **ollama-adapter.AC5.3 Failure:** HTTP 400/404 classifies as `ModelError("api_error", retryable: false)`
- **ollama-adapter.AC5.4 Failure:** Network errors (ECONNREFUSED, fetch failure) classify as retryable
- **ollama-adapter.AC5.5 Success:** Retryable errors are retried via `callWithRetry` with adapter-specific predicate

---

## Phase 3: Response Normalization and `complete()`

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Response normalization functions and error classification

**Verifies:** ollama-adapter.AC3.2, ollama-adapter.AC3.3, ollama-adapter.AC3.5, ollama-adapter.AC4.2, ollama-adapter.AC5.1, ollama-adapter.AC5.2, ollama-adapter.AC5.3, ollama-adapter.AC5.4

**Files:**
- Modify: `src/model/ollama.ts` (add response types, normalization functions, error classification)

**Implementation:**

Add the Ollama response type (internal to adapter, not exported):

```typescript
type OllamaChatResponse = {
  model: string;
  message: OllamaMessage & { thinking?: string };
  done: boolean;
  done_reason?: "stop" | "length";
  prompt_eval_count?: number;
  eval_count?: number;
};
```

Note: The `OllamaMessage` type from Phase 2 already includes `tool_calls`. The response extends it with `thinking`.

Implement `normalizeResponse` — converts Ollama's response to Constellation's `ModelResponse`:

```typescript
function normalizeResponse(response: OllamaChatResponse): ModelResponse {
  const content: Array<ContentBlock> = [];

  if (response.message.content) {
    content.push({
      type: "text",
      text: response.message.content,
    });
  }

  if (response.message.tool_calls) {
    for (const toolCall of response.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: crypto.randomUUID(),
        name: toolCall.function.name,
        input: toolCall.function.arguments,
      });
    }
  }

  // Ensure content is non-empty per ModelResponse invariant
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    content,
    stop_reason: normalizeStopReason(response),
    usage: {
      input_tokens: response.prompt_eval_count ?? 0,
      output_tokens: response.eval_count ?? 0,
    },
    reasoning_content: response.message.thinking ?? null,
  };
}
```

Key design decisions:
- UUIDs generated via `crypto.randomUUID()` (globally available in Bun)
- Tool call `arguments` from Ollama are already parsed objects (unlike OpenAI which sends JSON strings), so they map directly to `ToolUseBlock.input`
- Empty content gets a fallback `TextBlock` to satisfy the `ModelResponse` invariant

Implement `normalizeStopReason` — handles the unreliable `done_reason` by checking `tool_calls` first:

```typescript
function normalizeStopReason(response: OllamaChatResponse): StopReason {
  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    return "tool_use";
  }
  if (response.done_reason === "length") {
    return "max_tokens";
  }
  return "end_turn";
}
```

This addresses the documented Ollama quirk where `done_reason` is `"stop"` even when tool calls are present.

Implement error classification:

```typescript
function classifyHttpError(status: number, body: string): ModelError {
  if (status === 429) {
    return new ModelError("rate_limit", true, `rate limit exceeded: ${body}`);
  }
  if (status === 500 || status === 502) {
    return new ModelError("api_error", true, `server error (${status}): ${body}`);
  }
  return new ModelError("api_error", false, `request failed (${status}): ${body}`);
}

function isRetryableOllamaError(error: unknown): boolean {
  if (error instanceof ModelError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("econnrefused") ||
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("timeout")
    ) {
      return true;
    }
  }
  return false;
}
```

Export `normalizeResponse`, `normalizeStopReason`, `classifyHttpError`, and `isRetryableOllamaError` for testing.

**Testing:**

Tests to add in `src/model/ollama.test.ts`:

**`ollama-adapter.AC3.2`: Tool calls map to ToolUseBlock with UUIDs**
- Response with single tool call produces `ToolUseBlock` with valid UUID `id`, correct `name`, and correct `input`
- UUID is a valid v4 UUID format

**`ollama-adapter.AC3.3`: Stop reason is "tool_use" when tool_calls present**
- Response with `tool_calls` present and `done_reason: "stop"` produces `stop_reason: "tool_use"`
- Response with no tool_calls and `done_reason: "stop"` produces `stop_reason: "end_turn"`
- Response with no tool_calls and `done_reason: "length"` produces `stop_reason: "max_tokens"`

**`ollama-adapter.AC3.5`: Multiple parallel tool calls**
- Response with 3 tool calls in `tool_calls` array produces 3 `ToolUseBlock` entries, each with unique UUIDs

**`ollama-adapter.AC4.2`: Thinking maps to reasoning_content**
- Response with `message.thinking` populated maps to `reasoning_content` on `ModelResponse`
- Response without `message.thinking` produces `reasoning_content: null`

**`ollama-adapter.AC5.1`: HTTP 429 → rate_limit, retryable**
- `classifyHttpError(429, ...)` produces `ModelError` with `code: "rate_limit"` and `retryable: true`

**`ollama-adapter.AC5.2`: HTTP 500/502 → api_error, retryable**
- `classifyHttpError(500, ...)` and `classifyHttpError(502, ...)` produce `ModelError` with `code: "api_error"` and `retryable: true`

**`ollama-adapter.AC5.3`: HTTP 400/404 → api_error, not retryable**
- `classifyHttpError(400, ...)` and `classifyHttpError(404, ...)` produce `ModelError` with `code: "api_error"` and `retryable: false`

**`ollama-adapter.AC5.4`: Network errors are retryable**
- `isRetryableOllamaError(new Error("fetch failed"))` returns `true`
- `isRetryableOllamaError(new Error("ECONNREFUSED"))` returns `true`
- `isRetryableOllamaError(new ModelError("api_error", false))` returns `false`

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

**Commit:** `feat: add ollama response normalization and error classification`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `complete()` method with retry

**Verifies:** ollama-adapter.AC2.1, ollama-adapter.AC5.5

**Files:**
- Modify: `src/model/ollama.ts` (implement `complete()` in `createOllamaAdapter`)

**Implementation:**

Replace the stub `createOllamaAdapter` with the full adapter returning a `ModelProvider`. The `complete()` method uses `fetch()` against `${baseUrl}/api/chat` with `stream: false`.

Default base URL follows the existing Ollama embedding adapter pattern (`src/embedding/ollama.ts:6`):

```typescript
const DEFAULT_BASE_URL = "http://localhost:11434";

export function createOllamaAdapter(config: ModelConfig): ModelProvider {
  const baseUrl = config.base_url ?? DEFAULT_BASE_URL;

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return callWithRetry(
        async () => {
          const ollamaRequest = buildOllamaRequest(request, false);

          const response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ollamaRequest),
          });

          if (!response.ok) {
            const body = await response.text();
            throw classifyHttpError(response.status, body);
          }

          const data = (await response.json()) as OllamaChatResponse;
          return normalizeResponse(data);
        },
        isRetryableOllamaError
      );
    },

    async *stream(_request: ModelRequest): AsyncIterable<StreamEvent> {
      throw new Error("Ollama streaming not yet implemented");
    },
  };
}
```

The `complete()` method:
1. Builds the Ollama request with `stream: false` via `buildOllamaRequest`
2. Sends HTTP POST to `${baseUrl}/api/chat`
3. Classifies HTTP errors via `classifyHttpError`
4. Parses JSON response and normalizes to `ModelResponse`
5. Wraps in `callWithRetry` with `isRetryableOllamaError` predicate

Network errors (ECONNREFUSED, fetch failure) bubble up as plain `Error` objects and are caught by `isRetryableOllamaError` for retry.

**Testing:**

Since `complete()` performs I/O (HTTP fetch), it cannot be unit-tested without mocking. The codebase pattern for model adapter tests is to skip integration tests when no API key/endpoint is available (see `src/model/anthropic.test.ts`).

Tests must verify:
- ollama-adapter.AC2.1: `complete()` returns `ModelResponse` with non-empty `content` array (integration test, skipped when Ollama unavailable)
- ollama-adapter.AC5.5: Retryable errors trigger retry via `callWithRetry` — verified structurally by the `callWithRetry` wrapping (the retry wrapper itself is tested in `src/model/retry.ts`)

Add an integration test that skips when Ollama is not available:

```typescript
describe("createOllamaAdapter", () => {
  describe("complete method", () => {
    it("should return ModelResponse with non-empty content", async () => {
      const endpoint = process.env["OLLAMA_ENDPOINT"];
      if (!endpoint) return; // Skip when Ollama unavailable

      const adapter = createOllamaAdapter({
        provider: "ollama",
        name: "llama3.2:1b",
        base_url: endpoint,
      });

      const response = await adapter.complete({
        messages: [{ role: "user", content: "Say hello" }],
        model: "llama3.2:1b",
        max_tokens: 50,
      });

      expect(response.content.length).toBeGreaterThan(0);
      expect(response.stop_reason).toBeDefined();
    });
  });
});
```

Test file: `src/model/ollama.test.ts` (unit + optional integration)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass (integration tests skip when OLLAMA_ENDPOINT not set)

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: implement ollama complete() method with retry and error classification`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
