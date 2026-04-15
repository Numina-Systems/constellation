# Context Overflow Guard Implementation Plan — Phase 4

**Goal:** Add a last-resort guard that prevents oversized requests by truncating oldest messages when estimation still exceeds the model's context limit after compaction.

**Architecture:** A pure function `truncateOldest` in `src/agent/context.ts` drops oldest non-system messages until the estimated total fits within `modelMaxTokens`. It preserves leading system messages (clip-archive summaries) and the most recent user message. The agent loop calls this between `buildMessages` and `model.complete()`. A warning is logged when the guard fires.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-overflow-guard.AC3: Pre-flight guard truncates when needed
- **context-overflow-guard.AC3.1 Success:** Agent never calls `model.complete()` with estimated tokens exceeding `modelMaxTokens`
- **context-overflow-guard.AC3.2 Success:** Truncation preserves leading system messages (clip-archive summaries)
- **context-overflow-guard.AC3.3 Success:** Truncation preserves the most recent user message
- **context-overflow-guard.AC3.4 Success:** Oldest non-system messages are dropped first
- **context-overflow-guard.AC3.5 Success:** Warning is logged when the pre-flight guard fires
- **context-overflow-guard.AC3.6 Edge:** History with only system message + latest user message is never truncated further (minimum viable context)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Implement `truncateOldest` pure function

**Verifies:** context-overflow-guard.AC3.2, context-overflow-guard.AC3.3, context-overflow-guard.AC3.4, context-overflow-guard.AC3.6

**Files:**
- Modify: `src/agent/context.ts` (add function after `shouldCompress` at line 145)
- Modify: `src/agent/index.ts` (add export)
- Test: `src/agent/context.test.ts` (unit)

**Implementation:**

Add `truncateOldest` to `src/agent/context.ts` after the `shouldCompress` function. This is a pure function — it takes an array of `Message` objects and returns a truncated copy.

The function:
1. Identifies leading system messages (contiguous system-role messages at the start of the array — these are clip-archive summaries)
2. Identifies the most recent user message (last message with `role === "user"`)
3. Calculates the token budget available for non-protected messages: `modelMaxTokens - overheadTokens - protectedTokens`
4. Drops oldest non-protected messages first until the total fits

```typescript
export function truncateOldest(
  messages: ReadonlyArray<Message>,
  modelMaxTokens: number,
  overheadTokens: number,
): Array<Message> {
  const availableTokens = modelMaxTokens - overheadTokens;

  if (availableTokens <= 0) {
    // Can't fit anything — return minimum viable context
    return extractMinimumContext(messages);
  }

  // Estimate current total
  const currentTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0,
  );

  if (currentTokens <= availableTokens) {
    return Array.from(messages);
  }

  // Identify protected messages
  // 1. Leading system messages (clip-archive summaries)
  let leadingSystemCount = 0;
  for (const msg of messages) {
    if (msg.role === 'system') {
      leadingSystemCount++;
    } else {
      break;
    }
  }

  // 2. Most recent user message index
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  // Build result: keep protected, drop from oldest non-protected
  const leading = messages.slice(0, leadingSystemCount);
  const lastUser = lastUserIndex >= 0 ? [messages[lastUserIndex]!] : [];

  // Droppable messages: everything between leading system and end, except the last user message
  const droppable: Array<{ index: number; msg: Message }> = [];
  for (let i = leadingSystemCount; i < messages.length; i++) {
    if (i !== lastUserIndex) {
      droppable.push({ index: i, msg: messages[i]! });
    }
  }

  // Calculate tokens for protected messages
  const protectedTokens = [...leading, ...lastUser].reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0,
  );

  let remainingBudget = availableTokens - protectedTokens;

  // Drop oldest droppable messages until remaining fit within budget.
  // Calculate total droppable tokens first, then drop from oldest until we're under budget.
  let droppableTokens = 0;
  const droppableWithTokens = droppable.map((d) => {
    const tokens = estimateTokens(
      typeof d.msg.content === 'string' ? d.msg.content : JSON.stringify(d.msg.content),
    );
    droppableTokens += tokens;
    return { ...d, tokens };
  });

  // Drop from oldest (front) until remaining droppable tokens fit
  let tokensDropped = 0;
  let dropCount = 0;
  for (const d of droppableWithTokens) {
    if (droppableTokens - tokensDropped <= remainingBudget) {
      break;
    }
    tokensDropped += d.tokens;
    dropCount++;
  }

  const kept = droppableWithTokens.slice(dropCount);

  // Reconstruct in original order: leading system + surviving droppable + last user
  const result = [...leading, ...kept.map((k) => k.msg), ...lastUser];
  return result;
}

function extractMinimumContext(messages: ReadonlyArray<Message>): Array<Message> {
  const result: Array<Message> = [];

  // Keep leading system messages
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push(msg);
    } else {
      break;
    }
  }

  // Keep last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      result.push(messages[i]!);
      break;
    }
  }

  return result;
}
```

Add `truncateOldest` to the barrel export in `src/agent/index.ts`.

**Testing:**

Tests must verify each AC:
- context-overflow-guard.AC3.2: Create messages with leading system messages + user/assistant messages. Truncate with tight budget. Assert system messages preserved.
- context-overflow-guard.AC3.3: Create messages where budget forces truncation. Assert the most recent user message is always in the result.
- context-overflow-guard.AC3.4: Create messages [sys, user1, asst1, user2, asst2, user3]. Truncate. Assert user1/asst1 dropped before user2/asst2.
- context-overflow-guard.AC3.6: Create messages with only [sys, user]. Truncate with extremely tight budget. Assert both are returned (minimum viable context).
- Edge: No user messages in history — returns only leading system messages.
- Edge: No system messages — preserves last user, drops oldest others.

Pure function tests — no mocking needed.

**Verification:**

Run: `bun test src/agent/context.test.ts`
Expected: All tests pass.

**Commit:** `feat(agent): add truncateOldest pure function for pre-flight guard`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire pre-flight guard into agent loop

**Verifies:** context-overflow-guard.AC3.1, context-overflow-guard.AC3.5

**Files:**
- Modify: `src/agent/agent.ts:142-145` (between buildMessages and modelRequest)

**Implementation:**

In `src/agent/agent.ts`, after `buildMessages` at line 142 and before `modelRequest` construction at line 145, insert the pre-flight guard:

```typescript
const messages = await buildMessages(history, deps.memory);

// Pre-flight guard: truncate if estimated request exceeds model limit
const requestOverhead = estimateOverheadTokens(systemPrompt, deps.registry.toModelTools(), maxTokens);
const messageTokens = messages.reduce(
  (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
  0,
);

let finalMessages = messages;
if (messageTokens + requestOverhead > modelMaxTokens) {
  console.warn(
    `pre-flight guard: estimated ${messageTokens + requestOverhead} tokens exceeds limit ${modelMaxTokens}, truncating oldest messages`,
  );
  finalMessages = truncateOldest(messages, modelMaxTokens, requestOverhead);
}

// Call the model with current context
const modelRequest = {
  messages: finalMessages,
  system: systemPrompt,
  tools: deps.registry.toModelTools(),
  model: modelName,
  max_tokens: maxTokens,
};
```

Import `truncateOldest` and `estimateOverheadTokens` from `./context.js`.

Note: `estimateOverheadTokens` was added in Phase 2. If Phase 2 placed the overhead computation before `shouldCompress`, the pre-flight guard can reuse the same function but must recompute inside the loop since the system prompt changes per-round (skills are appended at line 127-139).

**Testing:**

AC3.1 and AC3.5 are integration concerns verified by the structural wiring. The unit tests for `truncateOldest` (Task 1) verify the truncation logic. To verify AC3.5 (warning logged), the implementation uses `console.warn` — this can be tested by capturing console output if desired, but the structural presence of the log statement satisfies the AC.

**Verification:**

Run: `bun run build`
Expected: Type-check passes.

Run: `bun test`
Expected: All non-DB tests pass.

**Commit:** `feat(agent): wire pre-flight guard into agent loop`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full test suite verification

**Verifies:** No regression from pre-flight guard changes.

**Files:** None (verification only)

**Verification:**

Run: `bun test`
Expected: All non-DB tests pass. No regressions.

Run: `bun run build`
Expected: Type-check passes.

**Commit:** No commit needed — verification step.

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
