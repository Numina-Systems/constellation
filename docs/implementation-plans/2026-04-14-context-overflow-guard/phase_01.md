# Context Overflow Guard Implementation Plan — Phase 1

**Goal:** Add optional `timeout` field to `ModelRequest` and wire it through all four model adapters.

**Architecture:** Each adapter passes the timeout through its SDK's native mechanism — Anthropic and OpenAI SDKs accept `{ timeout }` as a second argument to their API methods, while Ollama uses `AbortSignal.timeout()` on its raw `fetch()` call. Timeout expiry produces a `ModelError` with `code: 'timeout'` and `retryable: true`.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk@0.39.0`, `openai@4.80.0`, `fetch()` with `AbortSignal`

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-overflow-guard.AC4: ModelRequest timeout support
- **context-overflow-guard.AC4.1 Success:** All four adapters (OpenRouter, OpenAI-compat, Anthropic, Ollama) respect `timeout` when provided
- **context-overflow-guard.AC4.2 Success:** Omitting `timeout` uses adapter/SDK defaults (no behaviour change)
- **context-overflow-guard.AC4.3 Failure:** Timeout expiry produces a `ModelError` with `code: 'timeout'` and `retryable: true`

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `timeout` field to `ModelRequest`

**Verifies:** None (type-only change, compiler verifies)

**Files:**
- Modify: `src/model/types.ts:41-48`

**Implementation:**

Add `timeout?: number` to the `ModelRequest` type at `src/model/types.ts:41-48`. The field goes after `temperature`:

```typescript
export type ModelRequest = {
  messages: ReadonlyArray<Message>;
  system?: string;
  tools?: ReadonlyArray<ToolDefinition>;
  model: string;
  max_tokens: number;
  temperature?: number;
  timeout?: number;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors.

**Commit:** `feat(model): add optional timeout field to ModelRequest`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire timeout through Anthropic adapter

**Verifies:** context-overflow-guard.AC4.1 (Anthropic), context-overflow-guard.AC4.2 (Anthropic), context-overflow-guard.AC4.3

**Files:**
- Modify: `src/model/anthropic.ts:177-184` (complete path) and the stream call site
- Test: `src/model/anthropic.test.ts` (unit)

**Implementation:**

In `src/model/anthropic.ts`, the `client.messages.stream()` call at line 177 currently passes only the request body. Add a second argument that conditionally includes `timeout`:

```typescript
const stream = client.messages.stream(
  {
    model: request.model,
    max_tokens: request.max_tokens,
    system: systemParam,
    tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
    temperature: request.temperature,
    messages: nonSystemMessages.map(normalizeMessage) as Array<Anthropic.Messages.MessageParam>,
  },
  ...(request.timeout != null ? [{ timeout: request.timeout }] : []),
);
```

Apply the same pattern to the stream method's `client.messages.stream()` call (find it similarly within the `stream()` generator function).

In the `isRetryableError` function at line 19-27, add a check for `Anthropic.APIConnectionTimeoutError`. Note: the existing `error.message.includes("timeout")` check already catches timeout errors generically. The explicit `APIConnectionTimeoutError` check is intentionally redundant — it documents the specific SDK error type and takes priority by appearing first in the if-chain:

```typescript
function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) {
    return true;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return true;
  }
  if (error instanceof Error && error.message.includes("timeout")) {
    return true;
  }
  return false;
}
```

In the catch block that classifies errors (around line 186), add a case before the generic timeout check that catches `Anthropic.APIConnectionTimeoutError` and throws `ModelError("timeout", true, ...)`:

```typescript
if (error instanceof Anthropic.APIConnectionTimeoutError) {
  throw new ModelError("timeout", true, error.message || "request timed out");
}
```

**Testing:**

Tests must verify each AC listed above:
- context-overflow-guard.AC4.1 (Anthropic): Test that when `timeout` is provided in the request, it is passed through to the SDK call. Use a pure function test approach — extract the options-building logic or test via mock server that the adapter doesn't reject the timeout field.
- context-overflow-guard.AC4.2 (Anthropic): Test that when `timeout` is omitted from the request, no timeout option is passed to the SDK (existing behaviour unchanged).
- context-overflow-guard.AC4.3: Test that when a timeout error occurs, the adapter throws `ModelError` with `code: 'timeout'` and `retryable: true`.

Follow project testing patterns: use `Bun.serve()` mock server for request validation, `describe`/`it` blocks from `bun:test`.

**Verification:**

Run: `bun test src/model/anthropic.test.ts`
Expected: All tests pass.

**Commit:** `feat(model): wire timeout through Anthropic adapter`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Wire timeout through OpenAI-compat adapter

**Verifies:** context-overflow-guard.AC4.1 (OpenAI-compat), context-overflow-guard.AC4.2 (OpenAI-compat)

**Files:**
- Modify: `src/model/openai-compat.ts:60-66` (complete call site) and `src/model/openai-compat.ts:127-134` (stream call site)
- Test: `src/model/openai-compat.test.ts` (unit)

**Implementation:**

In `src/model/openai-compat.ts`, the `complete` method calls `client.chat.completions.create()` at line 60 with a single body argument. Add a second argument for timeout:

```typescript
return await client.chat.completions.create(
  {
    model: request.model,
    max_tokens: request.max_tokens,
    tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
    temperature: request.temperature,
    messages,
  },
  ...(request.timeout != null ? [{ timeout: request.timeout }] : []),
);
```

Apply the same pattern to the `stream` method's call at line 127.

Add timeout error classification in the catch block — the OpenAI SDK throws `OpenAI.APIConnectionTimeoutError` on timeout:

```typescript
if (error instanceof OpenAI.APIConnectionTimeoutError) {
  throw new ModelError("timeout", true, error.message || "request timed out");
}
```

**Testing:**

Tests must verify:
- context-overflow-guard.AC4.1 (OpenAI-compat): When `timeout` is set, it reaches the SDK call.
- context-overflow-guard.AC4.2 (OpenAI-compat): When `timeout` is omitted, SDK defaults apply.

Follow project patterns in `src/model/openai-compat.test.ts`.

**Verification:**

Run: `bun test src/model/openai-compat.test.ts`
Expected: All tests pass.

**Commit:** `feat(model): wire timeout through OpenAI-compat adapter`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Wire timeout through OpenRouter adapter

**Verifies:** context-overflow-guard.AC4.1 (OpenRouter), context-overflow-guard.AC4.2 (OpenRouter)

**Files:**
- Modify: `src/model/openrouter.ts:195-197` (complete call site) and `src/model/openrouter.ts:249-251` (stream call site)
- Test: `src/model/openrouter.test.ts` (unit)

**Implementation:**

Same pattern as OpenAI-compat. In `src/model/openrouter.ts`, add timeout as second argument to both `client.chat.completions.create()` calls:

For `complete` at line 195:
```typescript
return await client.chat.completions.create(
  body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ...(request.timeout != null ? [{ timeout: request.timeout }] : []),
);
```

For `stream` at line 249:
```typescript
return await client.chat.completions.create(
  body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  ...(request.timeout != null ? [{ timeout: request.timeout }] : []),
);
```

Add the same `OpenAI.APIConnectionTimeoutError` classification in the `classifyError` function.

**Testing:**

Tests must verify:
- context-overflow-guard.AC4.1 (OpenRouter): When `timeout` is set, it reaches the SDK call.
- context-overflow-guard.AC4.2 (OpenRouter): When `timeout` is omitted, SDK defaults apply.

The existing `openrouter.test.ts` uses `Bun.serve()` mock server — follow the same pattern.

**Verification:**

Run: `bun test src/model/openrouter.test.ts`
Expected: All tests pass.

**Commit:** `feat(model): wire timeout through OpenRouter adapter`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Wire timeout through Ollama adapter

**Verifies:** context-overflow-guard.AC4.1 (Ollama), context-overflow-guard.AC4.2 (Ollama), context-overflow-guard.AC4.3

**Files:**
- Modify: `src/model/ollama.ts:462-466` (complete fetch call) and `src/model/ollama.ts:485-489` (stream fetch call)
- Test: `src/model/ollama.test.ts` (unit)

**Implementation:**

Unlike the SDK-based adapters, Ollama uses raw `fetch()`. Use `AbortSignal.timeout()` to implement timeout support.

In `src/model/ollama.ts`, modify the `complete` method's `fetch()` call at line 462:

```typescript
const response = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(ollamaRequest),
  ...(request.timeout != null ? { signal: AbortSignal.timeout(request.timeout) } : {}),
});
```

Apply the same pattern to the `stream` method's `fetch()` call at line 485.

Add timeout error detection in the error classification. When `AbortSignal.timeout()` fires, the error has `name === "TimeoutError"`. Add this classification either in `classifyHttpError` or in the catch blocks:

```typescript
if (error instanceof DOMException && error.name === "TimeoutError") {
  throw new ModelError("timeout", true, "request timed out");
}
```

Also add this to `isRetryableOllamaError`:

```typescript
if (error instanceof DOMException && error.name === "TimeoutError") {
  return true;
}
```

**Testing:**

Tests must verify:
- context-overflow-guard.AC4.1 (Ollama): When `timeout` is set, `fetch()` receives `signal` with `AbortSignal.timeout()`.
- context-overflow-guard.AC4.2 (Ollama): When `timeout` is omitted, no signal is passed (existing behaviour).
- context-overflow-guard.AC4.3: When the timeout fires, error is `ModelError` with `code: 'timeout'` and `retryable: true`.

Use `Bun.serve()` mock server that delays response to trigger timeout. Follow existing patterns in `src/model/ollama.test.ts`.

**Verification:**

Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass.

**Commit:** `feat(model): wire timeout through Ollama adapter with AbortSignal`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Run full test suite

**Verifies:** context-overflow-guard.AC4.2 (all adapters — no regression)

**Files:** None (verification only)

**Verification:**

Run: `bun test`
Expected: All non-DB tests pass. No regressions from timeout changes. DB-dependent tests (17 expected failures due to no PostgreSQL) remain unchanged.

Run: `bun run build`
Expected: Type-check passes.

**Commit:** No commit needed — this is a verification step.

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->
