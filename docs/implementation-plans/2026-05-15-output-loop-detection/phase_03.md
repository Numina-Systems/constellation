# Output Loop Detection Implementation Plan - Phase 3

**Goal:** Wire loop detection into the agent loop's post-response processing, add config schema fields, and instantiate detector in the composition root.

**Architecture:** Imperative Shell integration. The detector is created at startup and passed as an optional dependency to the agent. After each model response, the agent calls `check()` and dispatches the configured action. Config flows from TOML → Zod schema → typed config → detector factory.

**Tech Stack:** TypeScript (Bun runtime), Zod for config validation

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements:

### loop-detection.AC4: Actions (dispatch in context)
- **loop-detection.AC4.1 Success:** `warn` action injects a system message: "Your recent responses appear repetitive. Try a different approach."
- **loop-detection.AC4.2 Success:** `redirect` action injects the warning message AND appends a hint to use a different tool or strategy
- **loop-detection.AC4.3 Success:** `halt` action ends the current turn and returns an error to the user indicating the agent is stuck

### loop-detection.AC7: False Positive Resistance
- **loop-detection.AC7.1 Success:** Responses that share a common prefix but diverge in content (e.g., step-by-step instructions) score below threshold
- **loop-detection.AC7.2 Success:** Tool call responses with different arguments but same tool name score below threshold
- **loop-detection.AC7.3 Success:** Responses containing large quoted blocks (user message echo) are compared on agent-generated content only, not quoted portions

---

## Key Context for Implementor

**Agent dependencies pattern** (`src/agent/types.ts:62-82`):
```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  // ... other deps ...
  traceRecorder?: TraceRecorder;
  // Add loopDetector here as optional
};
```

**Agent loop key locations** (`src/agent/agent.ts`):
- Line 148–482: `processMessage()` — main turn entry
- Line 333: Model response received (`const response = await deps.model.complete(modelRequest)`)
- Line 336–350: End turn (text response) — text extracted, persisted, returned
- Line 352–466: Tool use handling
- Reset point: line 149 (start of new turn)

**Config schema pattern** (`src/config/schema.ts`):
```typescript
const SomeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  // fields with defaults
});

// In AppConfigSchema:
const AppConfigSchema = z.object({
  // ... existing sections ...
  some_section: SomeConfigSchema.optional(),
});
```

**Composition root** (`src/index.ts`):
- Agent creation: lines 960–997
- traceRecorder created at line 552
- Insert detector creation before agent creation (~line 959)

**Content stripping for AC7.3:**
The design specifies stripping blockquotes and code fences before tokenising to avoid false positives from quoted content. This is a preprocessing step applied before `tokenBigrams()`.

---

<!-- START_TASK_1 -->
### Task 1: Add loop detection config schema

**Verifies:** None (infrastructure — verified operationally by build)

**Files:**
- Modify: `src/config/schema.ts` (add LoopDetectionConfigSchema and wire into AppConfigSchema)

**Implementation:**

Add the following Zod schema definition (place it near other subsystem schemas, before AppConfigSchema):

```typescript
const LoopDetectionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  window_size: z.number().int().positive().default(5),
  similarity_threshold: z.number().min(0).max(1).default(0.85),
  consecutive_trigger: z.number().int().positive().default(3),
  action: z.enum(['warn', 'redirect', 'halt']).default('warn'),
});
```

Add to `AppConfigSchema`:
```typescript
loop_detection: LoopDetectionConfigSchema.default({}),
```

Export the schema and type from `src/config/schema.ts` (add to existing exports):
```typescript
export { LoopDetectionConfigSchema };
export type LoopDetectionSchemaConfig = z.infer<typeof LoopDetectionConfigSchema>;
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(config): add loop_detection config schema with defaults`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Content stripping utility for false positive resistance

**Verifies:** loop-detection.AC7.3

**Files:**
- Create: `src/loop-detection/strip-quotes.ts`
- Create: `src/loop-detection/strip-quotes.test.ts`

**Implementation:**

Create `src/loop-detection/strip-quotes.ts`:

```typescript
// pattern: Functional Core

export function stripQuotedContent(text: string): string {
  let result = text;
  // Remove fenced code blocks (```...```)
  result = result.replace(/```[\s\S]*?```/g, '');
  // Remove blockquotes (lines starting with >)
  result = result.replace(/^>.*$/gm, '');
  // Collapse multiple newlines
  result = result.replace(/\n{2,}/g, '\n');
  return result.trim();
}
```

**Testing:**

Tests must verify:
- **AC7.3:** Text with blockquoted content has quotes removed, leaving only agent-generated content
- Fenced code blocks are stripped entirely
- Lines starting with `>` are removed
- Non-quoted content is preserved intact
- Empty result after stripping returns empty string
- Mixed content (some quoted, some not) retains only unquoted portions

Follow project testing patterns:
- `describe('loop-detection.AC7.3: Quoted content stripping', ...)`
- Import from `bun:test`
- Annotate with `// pattern: Functional Core`

**Verification:**

Run: `bun test src/loop-detection/strip-quotes.test.ts`
Expected: All tests pass

**Commit:** `feat(loop-detection): add quoted content stripping for false positive resistance`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire loop detection into agent dependencies

**Verifies:** None (infrastructure — verified by build)

**Files:**
- Modify: `src/agent/types.ts` (add `loopDetector` to `AgentDependencies`)

**Implementation:**

Add to `AgentDependencies` type (at `src/agent/types.ts:62-82`):

```typescript
loopDetector?: LoopDetector;
```

Add the import at the top of the file:
```typescript
import type { LoopDetector } from '@/loop-detection/types.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(agent): add loopDetector to AgentDependencies`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Integrate loop detection into agent loop

**Verifies:** loop-detection.AC4.1, loop-detection.AC4.2, loop-detection.AC4.3, loop-detection.AC7.1, loop-detection.AC7.2

**Files:**
- Modify: `src/agent/agent.ts` (add post-response loop detection check)

**Implementation:**

The agent loop needs three modifications:

**1. Reset on new user message** — At the start of `processMessage()` (around line 149):
```typescript
deps.loopDetector?.reset();
```

**Why reset per user message (not per conversation):** AC2.3 says "per-conversation, not global" — this means one detector instance per conversation (structural, via composition root), NOT that the window persists indefinitely. Loops happen within one multi-round response cycle (the tool-round loop for a single user request). Resetting on each new user message means: if the user sends a new request, stale loop state from the previous request doesn't carry over. The design's "Reset detector on new user message" is intentional.

**2. Post-response check** — After model response is received (after line 333, before the stop_reason check):

Import `stripQuotedContent` at the top of the file (static import):
```typescript
import { stripQuotedContent } from '@/loop-detection/strip-quotes.js';
```

Then in the post-response section:
```typescript
if (deps.loopDetector) {
  // For text responses, check the text content (stripped of quotes)
  // For tool calls, check serialised tool name + arguments
  const responseForDetection = response.stopReason === 'end_turn'
    ? stripQuotedContent(response.text ?? '')
    : response.toolUses?.map(t => `${t.name} ${JSON.stringify(t.input)}`).join('\n') ?? '';

  const loopResult = deps.loopDetector.check(responseForDetection);

  if (loopResult.triggered) {
    if (loopResult.action === 'halt') {
      // End the turn with an error message
      return {
        response: 'I appear to be stuck in a repetitive loop and cannot make progress. Please try rephrasing your request or providing additional context.',
        tokensUsed: { input: 0, output: 0 },
      };
    }

    // For warn/redirect, inject a system message before the next round
    const warningMessage = 'Your recent responses appear repetitive. Try a different approach.';
    const redirectHint = loopResult.action === 'redirect'
      ? ' Consider using a different tool or strategy than what you have been attempting.'
      : '';

    // Inject as system context for next model call
    // Implementation: append to conversation history as a system-injected message
    history.push({
      role: 'user',
      content: `[System: ${warningMessage}${redirectHint}]`,
    });
  }
}
```

**Note:** The exact integration pattern depends on how `history` and the response object are structured at that point in the agent loop. The implementor should:
- Examine the exact shape of `response` from `model.complete()` at line 333
- Examine how `history` is maintained and what message format it uses
- Adapt the injection approach to match existing patterns (look at how compaction injects messages)

**3. For AC7.1 and AC7.2:** These are satisfied structurally:
- AC7.1 (common prefix divergence): Bigram Jaccard naturally handles this — shared prefix generates some shared bigrams but divergent content produces enough unique bigrams to stay below threshold
- AC7.2 (same tool name, different args): Serialising as `toolName + JSON(args)` means different arguments produce different bigrams

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(agent): integrate loop detection into post-response processing`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Create detector in composition root

**Verifies:** None (infrastructure — verified by build)

**Files:**
- Modify: `src/index.ts` (create detector and pass to agent)

**Implementation:**

**1. Import** (add to imports section):
```typescript
import { createLoopDetector } from '@/loop-detection/index.js';
import type { LoopDetectionConfig } from '@/loop-detection/types.js';
```

**2. Create detector** (insert before agent creation, around line 959):
```typescript
const loopDetectionConfig: LoopDetectionConfig = {
  enabled: config.loop_detection.enabled,
  windowSize: config.loop_detection.window_size,
  similarityThreshold: config.loop_detection.similarity_threshold,
  consecutiveTrigger: config.loop_detection.consecutive_trigger,
  action: config.loop_detection.action,
};

const loopDetector = loopDetectionConfig.enabled
  ? createLoopDetector({
      config: loopDetectionConfig,
      traceRecorder,
      owner: AGENT_OWNER,
      conversationId: mainConversationId,
    })
  : undefined;
```

**Note:** Zod schema uses `.default({})` on `loop_detection`, so all fields are guaranteed to exist after parsing. No nullish coalescing needed.

**3. Pass to agent** (add to createAgent call at ~line 960–997):
```typescript
loopDetector,
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat: wire loop detector into composition root`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Update barrel export with strip-quotes

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/loop-detection/index.ts`

**Implementation:**

Add to `src/loop-detection/index.ts`:

```typescript
export { stripQuotedContent } from './strip-quotes.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

Run: `bun test src/loop-detection/`
Expected: All loop-detection tests pass

**Commit:** `feat(loop-detection): export stripQuotedContent from barrel`

<!-- END_TASK_6 -->
