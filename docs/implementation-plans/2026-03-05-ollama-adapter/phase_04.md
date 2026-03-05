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
- **ollama-adapter.AC2.2 Success:** `stream()` yields `StreamEvent` sequence: `MessageStart` → content events → `MessageStop`
- **ollama-adapter.AC2.3 Success:** `stream()` handles NDJSON lines correctly (parses valid JSON, skips empty lines)
- **ollama-adapter.AC2.4 Failure:** Malformed NDJSON line during streaming throws error

### ollama-adapter.AC4: Thinking/reasoning
- **ollama-adapter.AC4.3 Success:** During streaming, thinking chunks emit before content chunks with correct state transition

---

## Phase 4: NDJSON Streaming and `stream()`

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: NDJSON line parser

**Files:**
- Modify: `src/model/ollama.ts` (add NDJSON line parsing utility)

**Implementation:**

Implement an async generator that reads a `ReadableStream<Uint8Array>` (from `fetch` response body) and yields parsed JSON objects line-by-line. Ollama's streaming format is NDJSON — each line is a complete JSON object terminated by `\n`.

```typescript
async function* parseNDJSON(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<OllamaStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new ModelError(
            "api_error",
            false,
            `malformed NDJSON line: ${trimmed}`
          );
        }

        const chunk = parsed as OllamaStreamChunk;

        if ((chunk as Record<string, unknown>).error) {
          throw new ModelError(
            "api_error",
            false,
            `ollama streaming error: ${(chunk as Record<string, unknown>).error}`
          );
        }

        yield chunk;
      }
    }

    // Process remaining buffer
    const trimmed = buffer.trim();
    if (trimmed) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new ModelError(
          "api_error",
          false,
          `malformed NDJSON line: ${trimmed}`
        );
      }

      const remaining = parsed as OllamaStreamChunk;

      if ((remaining as Record<string, unknown>).error) {
        throw new ModelError(
          "api_error",
          false,
          `ollama streaming error: ${(remaining as Record<string, unknown>).error}`
        );
      }

      yield remaining;
    }
  } finally {
    reader.releaseLock();
  }
}
```

Add the streaming chunk type (internal):

```typescript
type OllamaStreamChunk = {
  model: string;
  message: {
    role: "assistant";
    content?: string;
    thinking?: string;
    tool_calls?: Array<OllamaToolCall>;
  };
  done: boolean;
  done_reason?: "stop" | "length";
  prompt_eval_count?: number;
  eval_count?: number;
};
```

Export `parseNDJSON` for testing.

**Testing:**

Tests for NDJSON parsing:
- ollama-adapter.AC2.3: Valid NDJSON lines parse correctly; empty lines between valid lines are skipped
- ollama-adapter.AC2.4: Malformed JSON line throws `ModelError` with `code: "api_error"` and `retryable: false`
- Mid-stream error object (`{ error: "..." }`) throws `ModelError`
- Remaining buffer after stream ends is processed

To test, create a helper that builds a `ReadableStream<Uint8Array>` from a string:

```typescript
function stringToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
```

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

**Commit:** `feat: add NDJSON line parser for ollama streaming`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `stream()` method with StreamEvent emission

**Verifies:** ollama-adapter.AC2.2, ollama-adapter.AC4.3

**Files:**
- Modify: `src/model/ollama.ts` (replace stream stub with full implementation)

**Implementation:**

Replace the `stream()` stub in `createOllamaAdapter` with the full async generator implementation.

**Testability seam:** Extract the stream event mapping logic into a standalone exported async generator function `mapChunksToStreamEvents` that takes an `AsyncIterable<OllamaStreamChunk>` and yields `StreamEvent`. This separates the HTTP I/O (in `stream()`) from the pure state machine logic (in `mapChunksToStreamEvents`), enabling unit testing without mocking `fetch`.

The state machine tracks:
- `thinkingStarted`: whether a thinking content block has been started
- `contentStarted`: whether a text content block has been started
- `blockIndex`: current content block index (increments for each new block)

```typescript
export async function* mapChunksToStreamEvents(
  chunks: AsyncIterable<OllamaStreamChunk>
): AsyncGenerator<StreamEvent> {
  let thinkingStarted = false;
  let contentStarted = false;
  let blockIndex = 0;
  let lastChunk: OllamaStreamChunk | null = null;

  // Emit MessageStart
  yield {
    type: "message_start",
    message: {
      id: crypto.randomUUID(),
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };

  for await (const chunk of chunks) {
    lastChunk = chunk;

    // Handle thinking content
    if (chunk.message.thinking) {
      if (!thinkingStarted) {
        yield {
          type: "content_block_start",
          content_block: { type: "thinking", index: blockIndex },
        };
        thinkingStarted = true;
      }
      yield {
        type: "content_block_delta",
        delta: {
          type: "thinking_delta",
          text: chunk.message.thinking,
          index: blockIndex,
        },
      };
    }

    // Handle text content
    if (chunk.message.content) {
      if (thinkingStarted && !contentStarted) {
        // Transition from thinking to content — start new block
        blockIndex++;
      }
      if (!contentStarted) {
        yield {
          type: "content_block_start",
          content_block: { type: "text", index: blockIndex },
        };
        contentStarted = true;
      }
      yield {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: chunk.message.content,
          index: blockIndex,
        },
      };
    }

    // Handle tool calls (arrive in final chunk with done: true)
    if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
      for (const toolCall of chunk.message.tool_calls) {
        blockIndex++;
        const toolId = crypto.randomUUID();

        yield {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            index: blockIndex,
            id: toolId,
            name: toolCall.function.name,
          },
        };

        yield {
          type: "content_block_delta",
          delta: {
            type: "input_json_delta",
            input: JSON.stringify(toolCall.function.arguments),
            index: blockIndex,
          },
        };
      }
    }
  }

  // Emit MessageStop with stop reason from final chunk
  const stopReason: StopReason = lastChunk
    ? normalizeStopReason({
        message: lastChunk.message as OllamaChatResponse["message"],
        done: lastChunk.done,
        done_reason: lastChunk.done_reason,
        model: lastChunk.model,
      } as OllamaChatResponse)
    : "end_turn";

  yield {
    type: "message_stop",
    message: { stop_reason: stopReason },
  };
}
```

The `stream()` method in `createOllamaAdapter` then composes the two:

```typescript
async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
  const ollamaRequest = buildOllamaRequest(request, true);

  const response = await callWithRetry(
    async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaRequest),
      });

      if (!res.ok) {
        const body = await res.text();
        throw classifyHttpError(res.status, body);
      }

      return res;
    },
    isRetryableOllamaError
  );

  if (!response.body) {
    throw new ModelError("api_error", false, "no response body for streaming");
  }

  yield* mapChunksToStreamEvents(parseNDJSON(response.body));
}
```

Design decisions:
- `mapChunksToStreamEvents` is a pure async generator (no I/O) — fully unit-testable with synthetic chunk sequences
- `stream()` is a thin I/O shell: fetch + retry + pipe to `mapChunksToStreamEvents`
- `MessageStart` emitted immediately before streaming begins (with synthetic UUID, consistent with OpenAI-compat adapter pattern at `src/model/openai-compat.ts:314-323`)
- Thinking content blocks emitted before text content blocks, with `blockIndex` increment on transition
- Tool calls emit as `content_block_start` + `content_block_delta` with `input_json_delta` type (matching OpenAI-compat pattern at `src/model/openai-compat.ts:360-388`)
- Tool call arguments JSON-stringified in the delta since `ToolUseBlock.input` is built from JSON in the consumer
- `MessageStop` emitted with stop reason from the final chunk

**Testing:**

Tests for `mapChunksToStreamEvents` (pure, no I/O):

**`ollama-adapter.AC2.2`: StreamEvent sequence**
- Text-only chunk sequence produces: `message_start` → `content_block_start(text)` → `content_block_delta(text_delta)` → `message_stop`
- Chunk sequence with tool calls produces: `message_start` → ... → `content_block_start(tool_use)` → `content_block_delta(input_json_delta)` → `message_stop`

**`ollama-adapter.AC4.3`: Thinking before content**
- Chunk sequence with thinking then content produces: `content_block_start(thinking)` → `content_block_delta(thinking_delta)` → `content_block_start(text)` → `content_block_delta(text_delta)`
- Thinking block index is 0, text block index is 1

To test, create an `async function*` helper that yields `OllamaStreamChunk` objects, then pass it to `mapChunksToStreamEvents` and collect the emitted `StreamEvent` array. No HTTP mocking needed.

```typescript
async function* chunksFrom(
  chunks: Array<OllamaStreamChunk>
): AsyncGenerator<OllamaStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Usage in tests:
const events: Array<StreamEvent> = [];
for await (const event of mapChunksToStreamEvents(chunksFrom(testChunks))) {
  events.push(event);
}
```

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: implement ollama stream() method with NDJSON parsing and StreamEvent emission`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Streaming tests

**Verifies:** ollama-adapter.AC2.2, ollama-adapter.AC2.3, ollama-adapter.AC2.4, ollama-adapter.AC4.3

**Files:**
- Modify: `src/model/ollama.test.ts` (add streaming tests)

**Implementation:**

Add comprehensive streaming tests at three levels:

1. **NDJSON parser tests** (pure, no I/O) — test `parseNDJSON` directly with `stringToStream` helper
2. **Stream event mapping tests** (pure, no I/O) — test `mapChunksToStreamEvents` with synthetic chunk sequences via `chunksFrom` helper
3. **Integration tests** (skipped when Ollama unavailable) — test full `stream()` method

**NDJSON parser tests:**

```typescript
describe("parseNDJSON", () => {
  it("should parse valid NDJSON lines", async () => {
    const ndjson = '{"message":{"role":"assistant","content":"hello"},"done":false}\n{"message":{"role":"assistant","content":" world"},"done":true}\n';
    const chunks: Array<unknown> = [];
    for await (const chunk of parseNDJSON(stringToStream(ndjson))) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
  });

  it("should skip empty lines", async () => {
    const ndjson = '{"message":{"role":"assistant","content":"hi"},"done":false}\n\n\n{"message":{"role":"assistant","content":""},"done":true}\n';
    const chunks: Array<unknown> = [];
    for await (const chunk of parseNDJSON(stringToStream(ndjson))) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
  });

  it("should throw on malformed JSON", async () => {
    const ndjson = 'not valid json\n';
    const chunks: Array<unknown> = [];
    try {
      for await (const chunk of parseNDJSON(stringToStream(ndjson))) {
        chunks.push(chunk);
      }
      expect(true).toBe(false); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).code).toBe("api_error");
      expect((error as ModelError).retryable).toBe(false);
    }
  });

  it("should throw on mid-stream error object", async () => {
    const ndjson = '{"error":"model not found"}\n';
    try {
      const chunks: Array<unknown> = [];
      for await (const chunk of parseNDJSON(stringToStream(ndjson))) {
        chunks.push(chunk);
      }
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
    }
  });
});
```

**Stream event mapping tests (using `mapChunksToStreamEvents`):**

```typescript
describe("mapChunksToStreamEvents", () => {
  describe("ollama-adapter.AC2.2: StreamEvent sequence", () => {
    it("should emit message_start, content events, message_stop for text-only response", async () => {
      const chunks: Array<OllamaStreamChunk> = [
        { model: "m", message: { role: "assistant", content: "hello" }, done: false },
        { model: "m", message: { role: "assistant", content: " world" }, done: true, done_reason: "stop" },
      ];
      const events: Array<StreamEvent> = [];
      for await (const event of mapChunksToStreamEvents(chunksFrom(chunks))) {
        events.push(event);
      }
      expect(events[0]?.type).toBe("message_start");
      expect(events[1]?.type).toBe("content_block_start");
      expect(events[events.length - 1]?.type).toBe("message_stop");
    });

    it("should emit tool_use events for tool call response", async () => {
      const chunks: Array<OllamaStreamChunk> = [
        {
          model: "m",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              type: "function",
              function: { name: "get_weather", arguments: { city: "Paris" } },
            }],
          },
          done: true,
          done_reason: "stop",
        },
      ];
      const events: Array<StreamEvent> = [];
      for await (const event of mapChunksToStreamEvents(chunksFrom(chunks))) {
        events.push(event);
      }
      const toolStart = events.find(
        (e) => e.type === "content_block_start" && e.content_block.type === "tool_use"
      );
      expect(toolStart).toBeDefined();
      const stopEvent = events[events.length - 1];
      expect(stopEvent?.type).toBe("message_stop");
      if (stopEvent?.type === "message_stop") {
        expect(stopEvent.message.stop_reason).toBe("tool_use");
      }
    });
  });

  describe("ollama-adapter.AC4.3: Thinking before content", () => {
    it("should emit thinking block before text block with correct indices", async () => {
      const chunks: Array<OllamaStreamChunk> = [
        { model: "m", message: { role: "assistant", thinking: "Let me think..." }, done: false },
        { model: "m", message: { role: "assistant", content: "The answer is 42" }, done: true, done_reason: "stop" },
      ];
      const events: Array<StreamEvent> = [];
      for await (const event of mapChunksToStreamEvents(chunksFrom(chunks))) {
        events.push(event);
      }
      const blockStarts = events.filter((e) => e.type === "content_block_start");
      expect(blockStarts).toHaveLength(2);
      expect(blockStarts[0]?.type === "content_block_start" && blockStarts[0].content_block.type).toBe("thinking");
      expect(blockStarts[0]?.type === "content_block_start" && blockStarts[0].content_block.index).toBe(0);
      expect(blockStarts[1]?.type === "content_block_start" && blockStarts[1].content_block.type).toBe("text");
      expect(blockStarts[1]?.type === "content_block_start" && blockStarts[1].content_block.index).toBe(1);
    });
  });
});
```

**Integration streaming test (optional, skipped when Ollama unavailable):**

```typescript
describe("stream method (integration)", () => {
  it("should yield correct StreamEvent sequence", async () => {
    const endpoint = process.env["OLLAMA_ENDPOINT"];
    if (!endpoint) return;

    const adapter = createOllamaAdapter({
      provider: "ollama",
      name: "llama3.2:1b",
      base_url: endpoint,
    });

    const events: Array<StreamEvent> = [];
    for await (const event of adapter.stream({
      messages: [{ role: "user", content: "Say hi" }],
      model: "llama3.2:1b",
      max_tokens: 20,
    })) {
      events.push(event);
    }

    expect(events[0]?.type).toBe("message_start");
    expect(events[events.length - 1]?.type).toBe("message_stop");
  });
});
```

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass (integration tests skip when OLLAMA_ENDPOINT not set)

**Commit:** `test: add ollama streaming and NDJSON parser tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
