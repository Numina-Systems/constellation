# Compaction V2 Implementation Plan — Phase 1: Extend ModelRequest Message Type

**Goal:** Add `'system'` as a valid role in the `Message` type and update both LLM adapters to handle system-role messages in the messages array.

**Architecture:** The `Message` type in `src/model/types.ts` is the port interface. Anthropic's API does not support `role: 'system'` in the messages array (only via a top-level `system` parameter), so the Anthropic adapter must extract system-role messages and merge their content into the `system` field. OpenAI's API natively supports `role: 'system'` in the messages array, so the OpenAI-compat adapter passes them through directly.

**Tech Stack:** TypeScript, Bun, Anthropic SDK, OpenAI SDK

**Scope:** 1 of 6 phases from original design (phase 1)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-v2.AC2: Extended ModelRequest
- **compaction-v2.AC2.1 Success:** `Message` type accepts `role: 'system'` alongside 'user' and 'assistant'
- **compaction-v2.AC2.2 Success:** Anthropic adapter extracts system-role messages from array and merges with `request.system` field
- **compaction-v2.AC2.3 Success:** OpenAI-compat adapter passes system-role messages through as `{ role: 'system' }` in OpenAI format
- **compaction-v2.AC2.4 Success:** Existing `request.system` field continues to work for backward compatibility
- **compaction-v2.AC2.5 Edge:** Multiple system-role messages in array are handled correctly (concatenated for Anthropic, sequential for OpenAI)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Extend Message type to include system role

**Verifies:** compaction-v2.AC2.1

**Files:**
- Modify: `src/model/types.ts:35-38`

**Implementation:**

Update the `Message` type's `role` field to include `'system'`:

```typescript
export type Message = {
  role: "user" | "assistant" | "system";
  content: string | Array<ContentBlock>;
};
```

This is the only change. The `ModelRequest` type already has `system?: string` and remains unchanged for backward compatibility.

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(model): add system role to Message type`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update Anthropic adapter to handle system-role messages

**Verifies:** compaction-v2.AC2.2, compaction-v2.AC2.4, compaction-v2.AC2.5

**Files:**
- Modify: `src/model/anthropic.ts` — `normalizeMessage` function (~line 84), `complete` method (~line 138), `stream` method (~line 183)

**Implementation:**

The Anthropic API rejects `role: 'system'` in the messages array with a 400 error. System-role messages must be extracted and their content merged into the top-level `system` parameter.

Add a helper function to extract system messages and build the merged system string:

```typescript
function buildAnthropicSystemParam(
  requestSystem: string | undefined,
  messages: ReadonlyArray<Message>,
): string | undefined {
  const systemContents: Array<string> = [];

  if (requestSystem) {
    systemContents.push(requestSystem);
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
      if (text) {
        systemContents.push(text);
      }
    }
  }

  return systemContents.length > 0 ? systemContents.join("\n\n") : undefined;
}
```

Import `TextBlock` in the imports at top of file (add to existing import from `./types.js`).

Update `normalizeMessage` to skip system-role messages (they are handled separately):

```typescript
function normalizeMessage(msg: Message): Anthropic.Messages.MessageParam {
  if (msg.role === "system") {
    throw new Error("system-role messages must be extracted before normalizeMessage");
  }
  // ... rest unchanged
}
```

Update the `complete` method to use `buildAnthropicSystemParam` and filter system messages:

```typescript
async complete(request: ModelRequest): Promise<ModelResponse> {
  const response = await callWithRetry(async () => {
    try {
      const systemParam = buildAnthropicSystemParam(request.system, request.messages);
      const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

      return await client.messages.create({
        model: request.model,
        max_tokens: request.max_tokens,
        system: systemParam,
        tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
        temperature: request.temperature,
        messages: nonSystemMessages.map(normalizeMessage) as Array<Anthropic.Messages.MessageParam>,
      });
    } catch (error) {
      // ... error handling unchanged
    }
  }, isRetryableError);
  // ... response handling unchanged
}
```

Apply the same pattern to the `stream` method — extract system messages and filter before passing to `client.messages.stream`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/model/anthropic.test.ts`
Expected: All existing tests still pass

**Commit:** `feat(model): anthropic adapter extracts system-role messages into system param`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Anthropic adapter system-role tests

**Verifies:** compaction-v2.AC2.2, compaction-v2.AC2.4, compaction-v2.AC2.5

**Files:**
- Modify: `src/model/anthropic.test.ts`

**Testing:**

Add a new `describe("system-role message handling", ...)` block. These are unit tests that verify the adapter's message transformation logic. They do NOT require an API key — they test the exported `createAnthropicAdapter` by verifying it constructs the correct Anthropic SDK call shape.

Since the existing tests are integration tests that skip without an API key, and the adapter's `normalizeMessage` and `buildAnthropicSystemParam` are private functions, the most practical approach is to add tests that verify observable behavior via the adapter's public `complete` method with a mock. However, the current codebase doesn't mock the Anthropic client.

Instead, add unit-testable exports: export `buildAnthropicSystemParam` so it can be tested directly as a pure function.

Tests must verify each AC listed above:
- compaction-v2.AC2.2: System-role messages extracted from array, content merged into system param. Test `buildAnthropicSystemParam` with messages containing `role: 'system'`.
- compaction-v2.AC2.4: When no system-role messages exist in array, `request.system` is passed through unchanged. Test `buildAnthropicSystemParam` with only `requestSystem` string, no system messages.
- compaction-v2.AC2.5: Multiple system-role messages concatenated with `\n\n`. Test `buildAnthropicSystemParam` with multiple system messages + `request.system`.

Follow project testing patterns: `describe`/`it` blocks, `bun:test` imports, factory helpers for test data.

**Verification:**

Run: `bun test src/model/anthropic.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(model): add system-role message handling tests for anthropic adapter`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Update OpenAI-compat adapter to handle system-role messages

**Verifies:** compaction-v2.AC2.3, compaction-v2.AC2.4, compaction-v2.AC2.5

**Files:**
- Modify: `src/model/openai-compat.ts` — `normalizeMessage` function (~line 103), `complete` method (~line 151), `stream` method (~line 216)

**Implementation:**

The OpenAI API natively supports `role: 'system'` in the messages array. Update `normalizeMessage` to handle system-role messages by returning an OpenAI system message:

```typescript
function normalizeMessage(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
  if (msg.role === "system") {
    const text = typeof msg.content === "string"
      ? msg.content
      : msg.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");
    return {
      role: "system",
      content: text,
    };
  }

  // ... rest of function unchanged (existing user/assistant handling)
}
```

The `complete` and `stream` methods already prepend `request.system` as a system message, then push all messages through `normalizeMessage`. With the updated `normalizeMessage`, system-role messages in the array will naturally pass through. The existing `request.system` handling remains for backward compatibility (compaction-v2.AC2.4).

No changes needed to the `complete` or `stream` methods — the `normalizeMessage` update handles everything. System messages from the array appear after the `request.system` message, which gives correct ordering (request.system first, then inline system messages, then conversation).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/model/openai-compat.test.ts`
Expected: All existing tests still pass

**Commit:** `feat(model): openai-compat adapter passes system-role messages through`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: OpenAI-compat adapter system-role tests

**Verifies:** compaction-v2.AC2.3, compaction-v2.AC2.4, compaction-v2.AC2.5

**Files:**
- Modify: `src/model/openai-compat.test.ts`

**Testing:**

Add a new `describe("system-role message handling", ...)` block. Similar to the Anthropic tests, test the observable behavior.

For OpenAI-compat, `normalizeMessage` is a private function. To test system-role handling without mocking the OpenAI client, export `normalizeMessage` as a named export (it's a pure function — Functional Core).

Alternatively, since the function is simple and the existing tests are integration-only, follow the same pattern as Task 3: export the pure function for direct testing.

Tests must verify each AC listed above:
- compaction-v2.AC2.3: System-role messages passed through as `{ role: 'system', content: string }`. Test `normalizeMessage` with a system-role message.
- compaction-v2.AC2.4: When `request.system` is provided, it still becomes the first system message. This is integration-level — verify by testing the message array construction logic.
- compaction-v2.AC2.5: Multiple system-role messages in array are sequential (each becomes its own `{ role: 'system' }` entry). Test `normalizeMessage` with multiple system messages.

Follow project testing patterns: `describe`/`it` blocks, `bun:test` imports.

**Verification:**

Run: `bun test src/model/openai-compat.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(model): add system-role message handling tests for openai-compat adapter`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Verify full test suite passes

**Verifies:** compaction-v2.AC2.4 (backward compatibility)

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

Run: `bun test`
Expected: All tests pass. No regressions from the Message type extension.

This confirms that existing code consuming `Message` with `role: 'user' | 'assistant'` still works (the union was widened, not narrowed, so existing call sites remain valid).

**Commit:** No commit needed — verification only
<!-- END_TASK_6 -->
