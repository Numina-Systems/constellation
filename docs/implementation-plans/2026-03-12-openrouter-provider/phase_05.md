# OpenRouter Provider Implementation Plan — Phase 5

**Goal:** Implement the OpenRouter adapter's `stream()` method with mid-stream error detection, cost logging from initial response headers, and rate limit sync.

**Architecture:** Replace the placeholder `stream()` in `openrouter.ts` with a full streaming implementation that follows the existing `openai-compat.ts` streaming pattern but adds OpenRouter-specific mid-stream error detection (`finish_reason: "error"`).

**Tech Stack:** TypeScript, Bun, OpenAI SDK (streaming), SSE

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-provider.AC2: Adapter implements ModelProvider (streaming)
- **openrouter-provider.AC2.4 Success:** `stream()` emits correct `StreamEvent` sequence (message_start → content_block_start → deltas → message_stop)
- **openrouter-provider.AC2.5 Success:** `stream()` assembles tool calls across multiple chunks

### openrouter-provider.AC3: Cost logging (streaming)
- **openrouter-provider.AC3.2 Success:** After `stream()` completes, cost from initial response headers is logged in the same format

### openrouter-provider.AC7: Mid-stream error handling
- **openrouter-provider.AC7.1 Success:** SSE chunk with `finish_reason: "error"` throws `ModelError("api_error", true)`
- **openrouter-provider.AC7.2 Success:** Retry wrapper catches mid-stream error and retries the full request
- **openrouter-provider.AC7.3 Edge:** SSE keepalive comments (`: OPENROUTER PROCESSING`) are ignored without error

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Implement `stream()` in `openrouter.ts`

**Verifies:** openrouter-provider.AC2.4, openrouter-provider.AC2.5, openrouter-provider.AC3.2, openrouter-provider.AC7.1, openrouter-provider.AC7.3

**Files:**
- Modify: `src/model/openrouter.ts` (replace placeholder `stream()` with full implementation)

**Implementation:**

Replace the placeholder `stream()` method with a full streaming implementation. The structure follows `openai-compat.ts` lines 259-403 with these additions:

1. **Request setup:** Same as `complete()` — build messages, add provider routing params, wrap in `callWithRetry`

2. **Stream iteration:** Follow the existing `openai-compat.ts` pattern exactly:
   - Extract message ID from first chunk, emit `message_start`
   - Handle text content deltas with `content_block_start` + `content_block_delta`
   - Handle tool call assembly across chunks via `toolCallMap`
   - Emit `message_stop` on finish

3. **Mid-stream error detection (AC7.1):** Before processing each chunk, check for `finish_reason: "error"`:
   ```typescript
   if (choice.finish_reason === "error") {
     throw new ModelError("api_error", true, "openrouter upstream provider error during streaming");
   }
   ```
   The `retryable: true` flag signals to the caller (agent loop) that it should retry the full request. See note on retry semantics below.

4. **Keepalive handling (AC7.3):** SSE keepalive comments (`: OPENROUTER PROCESSING`) are handled by the OpenAI SDK's SSE parser — they're ignored automatically per the SSE spec. No explicit handling needed in the adapter code.

5. **Cost/rate limit logging (AC3.2):** The custom fetch wrapper (from Phase 4) captures headers from the initial HTTP response. After the stream is created but before iterating chunks, call `extractAndLogHeaders()`:
   ```typescript
   const stream = await callWithRetry(async () => {
     // ... build request ...
     return await client.chat.completions.create({
       // ... params ...,
       stream: true,
     });
   }, isRetryableError);

   // Log cost from initial response headers (captured by custom fetch)
   extractAndLogHeaders(request.model, { input_tokens: 0, output_tokens: 0 });

   // Iterate stream events
   for await (const event of stream) {
     // ... existing streaming logic + error detection ...
   }
   ```
   Note: For streaming, token counts in the log are 0/0 since actual usage isn't known until the stream completes. Cost is OpenRouter's estimate at request acceptance time.

6. **Retry semantics:** `callWithRetry` wraps only the stream creation (`client.chat.completions.create()`), NOT the iteration. This matches the `openai-compat.ts` pattern. Mid-stream errors from `finish_reason: "error"` propagate to the caller as `ModelError("api_error", true)`. The agent loop sees `retryable: true` and retries the full request (AC7.2).

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add stream() to openrouter adapter`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Streaming tests for OpenRouter adapter

**Verifies:** openrouter-provider.AC2.4, openrouter-provider.AC2.5, openrouter-provider.AC7.1, openrouter-provider.AC7.2, openrouter-provider.AC7.3

**Files:**
- Modify: `src/model/openrouter.test.ts` (add streaming test describe block)

**Implementation:**

Add a new `describe("stream method")` block to the existing test file.

Tests must verify:
- openrouter-provider.AC2.4: Mock a streaming response, collect all emitted `StreamEvent`s, verify the sequence contains `message_start`, at least one `content_block_start`, at least one `content_block_delta`, and `message_stop` in order
- openrouter-provider.AC2.5: Mock a streaming response with tool call chunks split across multiple events (partial function name, partial arguments), verify the adapter emits correct `content_block_start` (with tool use type and id) and `content_block_delta` events with `input_json_delta` type
- openrouter-provider.AC7.1: Mock a streaming response where one chunk has `finish_reason: "error"`, verify the adapter throws `ModelError` with code `"api_error"` and `retryable: true`
- openrouter-provider.AC7.2: Verify that the thrown `ModelError` from AC7.1 has `retryable: true`, confirming the retry wrapper can catch and retry
- openrouter-provider.AC7.3: This is implicitly tested — SSE keepalive comments are handled by the OpenAI SDK's SSE parser and never surface as stream chunks. A test can verify that a normal stream completes successfully even when the underlying response includes keepalive data (if mockable at the fetch level)

The testing approach depends on what was established in Phase 4's test file. If Phase 4 uses a mock HTTP server or mock fetch, extend that pattern here for streaming responses. Streaming mocks need to return a `ReadableStream` or async iterable that yields SSE chunks.

**Verification:**

Run: `bun test src/model/openrouter.test.ts`
Expected: All tests pass (Phase 4 + Phase 5 tests)

**Commit:** `test: add openrouter stream() tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
