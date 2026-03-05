# Ollama Model Provider Adapter Implementation Plan

**Goal:** Make Ollama a first-class model provider in Constellation, sitting alongside Anthropic and OpenAI-compat behind the `ModelProvider` port.

**Architecture:** Single-file adapter at `src/model/ollama.ts` using raw `fetch()` against Ollama's native `/api/chat` endpoint. Follows the port/adapter pattern established by `src/model/anthropic.ts` and `src/model/openai-compat.ts`. Functional Core / Imperative Shell with file-level annotations.

**Tech Stack:** Bun (TypeScript, ESM), Zod for config validation, raw `fetch()` for HTTP (no SDK dependency)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ollama-adapter.AC3: Tool use
- **ollama-adapter.AC3.1 Success:** `ToolDefinition { name, description, input_schema }` translates to Ollama `{ type: "function", function: { name, description, parameters } }` in request
- **ollama-adapter.AC3.4 Success:** `ToolResultBlock` in assistant message context maps to Ollama `role: "tool"` message

### ollama-adapter.AC4: Thinking/reasoning
- **ollama-adapter.AC4.1 Success:** Request includes `think: true` parameter

---

## Phase 2: Request Normalization

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Ollama request types and tool definition translation

**Verifies:** ollama-adapter.AC3.1

**Files:**
- Modify: `src/model/ollama.ts` (replace stub with request normalization)

**Implementation:**

Replace the stub in `src/model/ollama.ts` with Ollama-specific types and request normalization functions. The adapter stays as Imperative Shell since it will eventually perform HTTP I/O, but the normalization functions within it are pure.

Define local types for the Ollama API contract (not exported — internal to the adapter):

```typescript
type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<OllamaToolCall>;
};

type OllamaToolCall = {
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaChatRequest = {
  model: string;
  messages: Array<OllamaMessage>;
  stream: boolean;
  tools?: Array<OllamaTool>;
  think?: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
};
```

Implement `normalizeToolDefinitions` — translates Constellation's `ToolDefinition` array to Ollama's tool format:

```typescript
function normalizeToolDefinitions(
  tools: ReadonlyArray<ToolDefinition>
): Array<OllamaTool> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}
```

This follows the same pattern as `src/model/openai-compat.ts:34-45`.

Keep the `createOllamaAdapter` function as a stub that throws for now — `complete()` and `stream()` implementations come in Phases 3 and 4.

**Testing:**

Tests must verify:
- ollama-adapter.AC3.1: `ToolDefinition { name, description, input_schema }` translates to Ollama `{ type: "function", function: { name, description, parameters: input_schema } }`
- Multiple tool definitions translate correctly
- Empty tools array results in empty output array

Test file: `src/model/ollama.test.ts` (unit). Export `normalizeToolDefinitions` for testing (or test via the public interface if possible).

These pure functions are exported and tested directly in Task 3.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add ollama request types and tool definition translation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Message normalization (all roles)

**Verifies:** ollama-adapter.AC3.4, ollama-adapter.AC4.1

**Files:**
- Modify: `src/model/ollama.ts` (add message normalization function)

**Implementation:**

Implement `normalizeMessages` — converts Constellation's `Message` array to Ollama's message format. Key mappings:

| Constellation | Ollama |
|---|---|
| `role: "system"`, content string | `role: "system"`, content string |
| `role: "user"`, content string | `role: "user"`, content string |
| `role: "user"` with `TextBlock` array | `role: "user"`, joined text |
| `role: "user"` with `ToolResultBlock` array | One `role: "tool"` message per result |
| `role: "assistant"`, content string | `role: "assistant"`, content string |
| `role: "assistant"` with `ToolUseBlock` array | `role: "assistant"` with `tool_calls` |

Critical differences from OpenAI-compat adapter:
- Ollama accepts `role: "system"` natively in the messages array (like OpenAI-compat, unlike Anthropic which extracts to a separate param)
- Ollama tool call `arguments` are a **parsed object** (`Record<string, unknown>`), NOT a JSON string (unlike OpenAI where arguments are `JSON.stringify()`'d)
- Tool result messages use `role: "tool"` with string `content` (same as OpenAI-compat pattern at `src/model/openai-compat.ts:155-165`)

```typescript
function normalizeMessages(
  msgs: ReadonlyArray<Message>
): Array<OllamaMessage> {
  const result: Array<OllamaMessage> = [];

  for (const msg of msgs) {
    if (typeof msg.content === "string") {
      result.push({
        role: msg.role === "system" ? "system" : msg.role,
        content: msg.content,
      });
      continue;
    }

    const textBlocks = msg.content.filter(
      (b): b is TextBlock => b.type === "text"
    );
    const toolUseBlocks = msg.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );
    const toolResultBlocks = msg.content.filter(
      (b): b is ToolResultBlock => b.type === "tool_result"
    );

    if (msg.role === "assistant") {
      const textContent = textBlocks.map((b) => b.text).join("");
      const ollamaMsg: OllamaMessage = {
        role: "assistant",
        content: textContent,
      };

      if (toolUseBlocks.length > 0) {
        ollamaMsg.tool_calls = toolUseBlocks.map((b) => ({
          type: "function",
          function: {
            name: b.name,
            arguments: b.input,
          },
        }));
      }

      result.push(ollamaMsg);
    } else if (msg.role === "user" && toolResultBlocks.length > 0) {
      for (const block of toolResultBlocks) {
        const content =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
        result.push({
          role: "tool",
          content,
        });
      }
    } else {
      const text = textBlocks.map((b) => b.text).join("\n");
      result.push({
        role: msg.role === "system" ? "system" : "user",
        content: text || "",
      });
    }
  }

  return result;
}
```

Also implement `buildOllamaRequest` — assembles the full `OllamaChatRequest` from a `ModelRequest`:

```typescript
function buildOllamaRequest(
  request: ModelRequest,
  stream: boolean
): OllamaChatRequest {
  const messages: Array<OllamaMessage> = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  messages.push(...normalizeMessages(request.messages));

  const ollamaRequest: OllamaChatRequest = {
    model: request.model,
    messages,
    stream,
    think: true,
  };

  if (request.tools && request.tools.length > 0) {
    ollamaRequest.tools = normalizeToolDefinitions(request.tools);
  }

  const options: OllamaChatRequest["options"] = {};
  if (request.max_tokens) {
    options.num_predict = request.max_tokens;
  }
  if (request.temperature !== undefined) {
    options.temperature = request.temperature;
  }
  if (Object.keys(options).length > 0) {
    ollamaRequest.options = options;
  }

  return ollamaRequest;
}
```

**Testing:**

Tests must verify:
- ollama-adapter.AC3.4: User message with `ToolResultBlock` maps to Ollama `role: "tool"` message
- ollama-adapter.AC4.1: Built request includes `think: true` parameter
- System messages pass through with `role: "system"`
- String content messages normalize correctly for all roles
- Assistant messages with `ToolUseBlock` produce `tool_calls` with object arguments (not JSON strings)
- `max_tokens` maps to `options.num_predict`
- `temperature` maps to `options.temperature`
- `system` string from `ModelRequest` becomes leading system message

These pure functions are exported and tested directly in Task 3.

Test file: `src/model/ollama.test.ts` (unit)

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: add ollama message normalization and request building`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Request normalization unit tests

**Verifies:** ollama-adapter.AC3.1, ollama-adapter.AC3.4, ollama-adapter.AC4.1

**Files:**
- Create: `src/model/ollama.test.ts`
- Modify: `src/model/ollama.ts` (export normalization functions for testability)

**Implementation:**

The normalization functions (`normalizeToolDefinitions`, `normalizeMessages`, `buildOllamaRequest`) are pure and should be tested directly. Export them from `src/model/ollama.ts` for testing:

```typescript
export { normalizeToolDefinitions, normalizeMessages, buildOllamaRequest };
```

This follows the pattern used in `src/model/openai-compat.ts` which exports `normalizeMessages` (line 106).

Create `src/model/ollama.test.ts`:

```typescript
// pattern: Functional Core

import { describe, it, expect } from "bun:test";
import { normalizeToolDefinitions, normalizeMessages, buildOllamaRequest } from "./ollama.js";
```

**Testing:**

Tests to write (one `describe` block per AC):

**`ollama-adapter.AC3.1`: Tool definition translation**
- Single `ToolDefinition` with `name`, `description`, `input_schema` produces `{ type: "function", function: { name, description, parameters: input_schema } }`
- Multiple tool definitions all translate correctly
- Empty input produces empty output

**`ollama-adapter.AC3.4`: ToolResultBlock to tool role message**
- User message with single `ToolResultBlock` (string content) maps to `role: "tool"` with that content
- User message with `ToolResultBlock` (array content) maps to `role: "tool"` with JSON.stringify'd content
- Multiple `ToolResultBlock`s in one message produce multiple `role: "tool"` messages

**`ollama-adapter.AC4.1`: Think parameter in request**
- `buildOllamaRequest` always sets `think: true`

**Additional normalization tests:**
- System string from `ModelRequest` becomes leading system message
- System role messages in array pass through as `role: "system"`
- User string content normalizes to `role: "user"`
- Assistant string content normalizes to `role: "assistant"`
- Assistant with `ToolUseBlock` produces `tool_calls` with `arguments` as object (not JSON string)
- `max_tokens` maps to `options.num_predict`
- `temperature` maps to `options.temperature`
- Omitted `temperature` results in no `temperature` in options
- `stream` parameter is passed through correctly

**Verification:**
Run: `bun test src/model/ollama.test.ts`
Expected: All tests pass

**Commit:** `test: add ollama request normalization tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
