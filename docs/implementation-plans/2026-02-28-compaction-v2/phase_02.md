# Compaction V2 Implementation Plan — Phase 2: Refactor Summarization Prompt System

**Goal:** Replace the `{placeholder}` string interpolation approach with structured conversation messages for summarization LLM calls, giving the LLM proper role context.

**Architecture:** Instead of building a single interpolated string passed as a user message, the summarization pipeline will construct a structured `ModelRequest` with: (1) a system prompt via `request.system`, (2) a system-role message for prior summary context, (3) original conversation messages with preserved roles, and (4) a directive as a final user message. The config `prompt` field becomes a plain system prompt string.

**Tech Stack:** TypeScript, Bun

**Scope:** 2 of 6 phases from original design (phase 2)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-v2.AC1: Structured Summarization Prompts
- **compaction-v2.AC1.1 Success:** Summarization LLM call uses `system` field for config prompt (or default) and passes messages as structured conversation
- **compaction-v2.AC1.2 Success:** Previous compaction summary is passed as a system-role message in the messages array
- **compaction-v2.AC1.3 Success:** Actual conversation messages preserve their original roles (user/assistant) in the summarization request
- **compaction-v2.AC1.4 Success:** Baked-in directive appears as final user message with preserve/condense/prioritize/remove instructions
- **compaction-v2.AC1.5 Edge:** No previous summary results in no system-role context message (not an empty one)
- **compaction-v2.AC1.6 Edge:** Re-summarization (`resummarizeBatches`) uses the same structured message approach

### compaction-v2.AC4: Persona Via Custom Prompt Only
- **compaction-v2.AC4.3 Success:** Custom `prompt` in config is used as-is for the system prompt (no transformation)
- **compaction-v2.AC4.4 Success:** Absent custom prompt falls back to default generic system prompt

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Replace prompt.ts with structured message builder

**Verifies:** compaction-v2.AC1.1, compaction-v2.AC1.2, compaction-v2.AC1.3, compaction-v2.AC1.4, compaction-v2.AC1.5, compaction-v2.AC4.3, compaction-v2.AC4.4

**Files:**
- Modify: `src/compaction/prompt.ts` (complete rewrite)

**Implementation:**

Replace the entire contents of `src/compaction/prompt.ts`. Remove `DEFAULT_SUMMARIZATION_PROMPT`, `InterpolatePromptOptions`, and `interpolatePrompt`. Replace with:

1. `DEFAULT_SYSTEM_PROMPT` — a plain system prompt string (no placeholders):

```typescript
export const DEFAULT_SYSTEM_PROMPT = `You are summarizing a conversation history to preserve essential context while compacting it. Create a concise narrative summary that maintains chronological order and preserves the causal chain of decisions.`;
```

2. `DEFAULT_DIRECTIVE` — a baked-in directive string for the final user message:

```typescript
export const DEFAULT_DIRECTIVE = `Summarize the conversation above. Follow these priorities:

PRESERVE: Decisions made and their rationale. Tool outcomes (successes and failures). User constraints and preferences explicitly stated. Causal chains explaining why decisions were made.

CONDENSE: Repetitive exchanges into single statements. Verbose tool output into key results. Conversational filler and acknowledgements.

PRIORITIZE: Recent context over older context. Actionable information over historical detail. Unresolved questions and pending tasks.

REMOVE: Greetings and small talk. Redundant confirmations. Formatting artifacts.

Output only the summary text as a flowing narrative, not bullet points.`;
```

3. `BuildSummarizationRequestOptions` type and `buildSummarizationRequest` function:

```typescript
import type { Message, ModelRequest } from '../model/types.js';
import type { ConversationMessage } from '../agent/types.js';

export type BuildSummarizationRequestOptions = {
  readonly systemPrompt: string | null;
  readonly previousSummary: string | null;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly modelName: string;
  readonly maxTokens: number;
};

export function buildSummarizationRequest(
  options: BuildSummarizationRequestOptions,
): ModelRequest {
  const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const messages: Array<Message> = [];

  // Previous summary as system-role message (AC1.2, AC1.5)
  if (options.previousSummary) {
    messages.push({
      role: 'system',
      content: `Previous summary of conversation:\n${options.previousSummary}`,
    });
  }

  // Conversation messages with original roles preserved (AC1.3)
  for (const msg of options.messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    } else if (msg.role === 'tool') {
      // Tool messages become user messages with context
      messages.push({
        role: 'user',
        content: `[Tool result]: ${msg.content}`,
      });
    }
    // system messages in the conversation are intentionally skipped —
    // they are clip-archives injected by prior compaction cycles and their
    // content is already captured by the previousSummary parameter.
    // Any future role additions to ConversationMessage should be handled
    // explicitly here.
  }

  // Directive as final user message (AC1.4)
  messages.push({
    role: 'user',
    content: DEFAULT_DIRECTIVE,
  });

  return {
    system,
    messages,
    model: options.modelName,
    max_tokens: options.maxTokens,
    temperature: 0,
  };
}
```

4. `BuildResummarizationRequestOptions` type and `buildResummarizationRequest` function for re-summarization (AC1.6):

```typescript
export type BuildResummarizationRequestOptions = {
  readonly systemPrompt: string | null;
  readonly batchContents: ReadonlyArray<string>;
  readonly modelName: string;
  readonly maxTokens: number;
};

export function buildResummarizationRequest(
  options: BuildResummarizationRequestOptions,
): ModelRequest {
  const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const messages: Array<Message> = [];

  // Each batch as a system-role message providing context
  for (const batchContent of options.batchContents) {
    messages.push({
      role: 'system',
      content: `Summary batch:\n${batchContent}`,
    });
  }

  // Directive as final user message
  messages.push({
    role: 'user',
    content: DEFAULT_DIRECTIVE,
  });

  return {
    system,
    messages,
    model: options.modelName,
    max_tokens: options.maxTokens,
    temperature: 0,
  };
}
```

The file header should be `// pattern: Functional Core` — all functions are pure.

**Verification:**

Run: `bun run build`
Expected: Type-check passes (will have errors in compactor.ts until Task 2, that's expected)

**Commit:** `feat(compaction): replace interpolation with structured message builders`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update compactor.ts to use structured message builders

**Verifies:** compaction-v2.AC1.1, compaction-v2.AC1.6

**Files:**
- Modify: `src/compaction/compactor.ts:21-24` (imports)
- Modify: `src/compaction/compactor.ts:439-472` (summarizeChunk function)
- Modify: `src/compaction/compactor.ts:330-339` (ResummarizeBatchesOptions type)
- Modify: `src/compaction/compactor.ts:347-432` (resummarizeBatches function)
- Modify: `src/compaction/compactor.ts:519-520` (template usage in compress)
- Modify: `src/compaction/compactor.ts:561-570` (resummarizeBatches call in compress)

**Implementation:**

1. Update imports — replace the old prompt imports:

```typescript
// Remove:
import { DEFAULT_SUMMARIZATION_PROMPT, interpolatePrompt } from './prompt.js';

// Add:
import { buildSummarizationRequest, buildResummarizationRequest } from './prompt.js';
```

2. Rewrite `summarizeChunk` — replace interpolation with `buildSummarizationRequest`:

```typescript
async function summarizeChunk(
  chunk: ReadonlyArray<ConversationMessage>,
  existingSummary: string,
  systemPrompt: string | null,
): Promise<string> {
  const request = buildSummarizationRequest({
    systemPrompt,
    previousSummary: existingSummary || null,
    messages: chunk,
    modelName,
    maxTokens: config.maxSummaryTokens,
  });

  const response = await model.complete(request);
  const summary = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return summary;
}
```

Note: `persona` and `template` parameters are removed. The system prompt comes from `config.prompt`.

3. Update `ResummarizeBatchesOptions` — remove `persona` and `template`, add `systemPrompt`:

```typescript
export type ResummarizeBatchesOptions = {
  readonly batches: ReadonlyArray<{ id: string; batch: SummaryBatch }>;
  readonly conversationId: string;
  readonly memory: MemoryManager;
  readonly model: ModelProvider;
  readonly modelName: string;
  readonly config: CompactionConfig;
  readonly systemPrompt: string | null;
};
```

4. Rewrite `resummarizeBatches` LLM call section (lines 380-404) — replace interpolation with `buildResummarizationRequest`:

```typescript
// Replace the interpolatePrompt + ModelRequest construction with:
const batchContents = batchesToResummarize.map((b) => b.batch.content);

const request = buildResummarizationRequest({
  systemPrompt: options.systemPrompt,
  batchContents,
  modelName: options.modelName,
  maxTokens: options.config.maxSummaryTokens,
});

const response = await options.model.complete(request);
```

5. Update `compress()` to use the new signatures. Replace:
- `const persona = await getPersona();` — remove this line
- `const template = config.prompt || DEFAULT_SUMMARIZATION_PROMPT;` — replace with `const systemPrompt = config.prompt;`
- Update `summarizeChunk` calls: pass `systemPrompt` instead of `persona` and `template`
- Update `resummarizeBatches` call: pass `systemPrompt` instead of `persona` and `template`

6. Remove `formatMessagesForPrompt()` (lines 175-181) — this function formatted messages for the old interpolation approach and is now dead code. Delete the entire function.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(compaction): use structured message builders in summarization pipeline`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update prompt tests for structured message builders

**Verifies:** compaction-v2.AC1.1, compaction-v2.AC1.2, compaction-v2.AC1.3, compaction-v2.AC1.4, compaction-v2.AC1.5, compaction-v2.AC1.6, compaction-v2.AC4.3, compaction-v2.AC4.4

**Files:**
- Modify: `src/compaction/prompt.test.ts` (complete rewrite)

**Testing:**

Replace all existing tests with tests for the new functions. The old `interpolatePrompt` tests are no longer relevant.

Tests must verify each AC listed above:

- compaction-v2.AC1.1: `buildSummarizationRequest` returns a `ModelRequest` with `system` field set to the provided system prompt (or default). Messages array contains structured conversation.
- compaction-v2.AC1.2: When `previousSummary` is non-null, the first message in the array is `{ role: 'system', content: 'Previous summary of conversation:\n...' }`.
- compaction-v2.AC1.3: Conversation messages with `role: 'user'` and `role: 'assistant'` appear in the messages array with their original roles.
- compaction-v2.AC1.4: The last message in the array is `{ role: 'user', content: DEFAULT_DIRECTIVE }`.
- compaction-v2.AC1.5: When `previousSummary` is null, no system-role message appears (the first message is either a conversation message or the directive).
- compaction-v2.AC1.6: `buildResummarizationRequest` produces structured messages with batch contents as system-role messages and directive as final user message.
- compaction-v2.AC4.3: When `systemPrompt` is provided, it is used as-is in `request.system`.
- compaction-v2.AC4.4: When `systemPrompt` is null, `DEFAULT_SYSTEM_PROMPT` is used.

Follow project testing patterns: `describe`/`it` blocks, `bun:test` imports, `createMessage` helper factory for `ConversationMessage` test data.

**Verification:**

Run: `bun test src/compaction/prompt.test.ts`
Expected: All tests pass

**Commit:** `test(compaction): add structured message builder tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Update compactor tests for new call structure

**Verifies:** compaction-v2.AC1.1, compaction-v2.AC1.6

**Files:**
- Modify: `src/compaction/compactor.test.ts`

**Implementation:**

Update the existing compactor tests to work with the new function signatures:

1. Update imports — remove `interpolatePrompt` and `DEFAULT_SUMMARIZATION_PROMPT` if imported from prompt.js.

2. Update `createResummarizeTestContext` factory (around line 59):
   - The `ResummarizeBatchesOptions` type no longer has `persona` and `template` fields
   - Replace with `systemPrompt: string | null`
   - Update all test calls to `resummarizeBatches` to use `systemPrompt` instead

3. Update any `createCompactor` calls in tests:
   - `getPersona` is still present in `CreateCompactorOptions` in this phase (removal happens in Phase 3)
   - However, `summarizeChunk` no longer uses persona, so the mock can return anything

4. Update assertions that inspect the `ModelRequest` passed to `model.complete`:
   - The request now has a `system` field (not just messages)
   - The messages array now contains structured messages (system-role for prior summary, user/assistant for conversation, user for directive)
   - Update any assertions that expected a single user message with an interpolated prompt

5. Verify captured `ModelRequest` shapes in resummarize tests:
   - Should have `system` field set
   - Messages should include system-role messages for batch contents
   - Final message should be the directive

**Verification:**

Run: `bun test src/compaction/compactor.test.ts`
Expected: All tests pass

**Commit:** `test(compaction): update compactor tests for structured summarization`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/compaction/index.ts`

**Implementation:**

Update barrel exports to export the new types and functions, remove the old ones:

```typescript
// Remove:
export type { InterpolatePromptOptions } from './prompt.js';
export { DEFAULT_SUMMARIZATION_PROMPT, interpolatePrompt } from './prompt.js';

// Add:
export type { BuildSummarizationRequestOptions, BuildResummarizationRequestOptions } from './prompt.js';
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_DIRECTIVE, buildSummarizationRequest, buildResummarizationRequest } from './prompt.js';
```

**Verification:**

First, verify no external consumers import the old exports:

Run: `grep -r "interpolatePrompt\|InterpolatePromptOptions\|DEFAULT_SUMMARIZATION_PROMPT" src/ --include="*.ts" | grep -v "src/compaction/"`
Expected: No matches. If matches are found, update those consumers before removing exports.

Run: `bun run build`
Expected: Type-check passes.

**Commit:** `refactor(compaction): update barrel exports for new prompt API`
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
Expected: All tests pass. No regressions from the prompt system refactor.

**Commit:** No commit needed — verification only
<!-- END_TASK_6 -->
