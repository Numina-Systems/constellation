# Impulse Continuation Implementation Plan — Phase 1

**Goal:** Create continuation decision types, prompt builder, and response parser as pure Functional Core functions.

**Architecture:** Port interface (`ContinuationJudge`) with pure prompt construction and JSON response parsing. Follows the same Functional Core pattern as `src/subconscious/impulse.ts` — types and pure functions in one file, no I/O.

**Tech Stack:** TypeScript, Bun test runner

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### impulse-continuation.AC1: Continuation prompt and response parsing
- **impulse-continuation.AC1.1 Success:** Prompt includes agent response text, trace summaries, active interests, and event type
- **impulse-continuation.AC1.2 Success:** Valid JSON response `{"continue": true, "reason": "..."}` parses to `ContinuationDecision`
- **impulse-continuation.AC1.3 Failure:** Malformed JSON (truncated, missing fields, non-JSON text) parses to `shouldContinue: false`
- **impulse-continuation.AC1.4 Edge:** Empty agent response produces valid prompt (no crash)

---

## Reference Files

The executor should read these files to understand established patterns:

- `src/subconscious/impulse.ts` — Pure event builder pattern to follow (Functional Core)
- `src/subconscious/types.ts` — Domain types including `Interest`
- `src/reflexion/types.ts` — `OperationTrace` type definition
- `src/subconscious/impulse.test.ts` — Pure function test patterns
- `src/subconscious/CLAUDE.md` — Module contracts and conventions

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: ContinuationDecision types, prompt builder, and response parser

**Verifies:** impulse-continuation.AC1.1, impulse-continuation.AC1.2, impulse-continuation.AC1.3, impulse-continuation.AC1.4

**Files:**
- Create: `src/subconscious/continuation.ts`

**Implementation:**

Create `src/subconscious/continuation.ts` with pattern annotation `// pattern: Functional Core` on line 1.

Define the following types:

```typescript
type ContinuationDecision = {
  readonly shouldContinue: boolean;
  readonly reason: string;
};

type ContinuationJudgeContext = {
  readonly agentResponse: string;
  readonly traces: ReadonlyArray<OperationTrace>;
  readonly interests: ReadonlyArray<Interest>;
  readonly eventType: 'impulse' | 'introspection';
};
```

Define the port interface:

```typescript
type ContinuationJudge = {
  readonly evaluate: (context: Readonly<ContinuationJudgeContext>) => Promise<ContinuationDecision>;
};
```

Implement two exported pure functions:

**`buildContinuationPrompt(context: Readonly<ContinuationJudgeContext>): string`**

Constructs a prompt for the LLM judge. The prompt must include:
- The agent's response text (from `context.agentResponse`)
- Trace summaries using `formatTraceSummary` from `@/scheduled-context` (same import used by `impulse.ts`)
- Active interests formatted as a list (name + engagement score)
- The event type (`impulse` or `introspection`)
- Instructions asking the model to return JSON `{"continue": true/false, "reason": "..."}`

Handle edge case: when `agentResponse` is empty, include a placeholder like `"(no response)"` instead.

**`parseContinuationResponse(text: string): ContinuationDecision`**

Parses the model's text response into a `ContinuationDecision`:
- Try `JSON.parse` on the input text
- If the text contains JSON embedded in other text (e.g., markdown code blocks), extract the JSON object first
- Valid response: object with boolean `continue` field and string `reason` field → map to `{ shouldContinue: continue, reason }`
- Any failure (malformed JSON, missing fields, wrong types, empty input) → return `{ shouldContinue: false, reason: 'Failed to parse continuation response' }`

Import `OperationTrace` from `@/reflexion/types` and `Interest` from `./types` (same as `impulse.ts` does). Import `formatTraceSummary` from `@/scheduled-context`.

Export all types and both functions as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): add continuation types and pure functions`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Continuation prompt and response parser tests

**Verifies:** impulse-continuation.AC1.1, impulse-continuation.AC1.2, impulse-continuation.AC1.3, impulse-continuation.AC1.4

**Files:**
- Create: `src/subconscious/continuation.test.ts`
- Test: `src/subconscious/continuation.test.ts` (unit)

**Testing:**

Follow the pattern in `src/subconscious/impulse.test.ts` — import from `bun:test`, use `describe`/`it` blocks named after ACs.

Tests must verify each AC listed above:

- **impulse-continuation.AC1.1:** `buildContinuationPrompt` includes agent response text, trace summaries (use `formatTraceSummary` output), interest names and scores, and event type in the output string. Test with a context containing at least 2 interests, 1 trace, and non-empty agent response.
- **impulse-continuation.AC1.2:** `parseContinuationResponse` with valid JSON `'{"continue": true, "reason": "exploring further"}'` returns `{ shouldContinue: true, reason: 'exploring further' }`. Also test `continue: false`.
- **impulse-continuation.AC1.3:** `parseContinuationResponse` with:
  - Truncated JSON (`'{"continue": tr'`) returns `{ shouldContinue: false, reason: 'Failed to parse continuation response' }`
  - Missing `continue` field (`'{"reason": "test"}'`) returns `shouldContinue: false`
  - Missing `reason` field (`'{"continue": true}'`) returns `shouldContinue: false`
  - Non-JSON text (`'I think we should continue'`) returns `shouldContinue: false`
  - Empty string returns `shouldContinue: false`
- **impulse-continuation.AC1.4:** `buildContinuationPrompt` with empty `agentResponse` (`''`) produces a valid string (no crash, contains the placeholder).

Also test that `parseContinuationResponse` handles JSON embedded in markdown code blocks (e.g., `` ```json\n{"continue": true, "reason": "test"}\n``` ``).

Create test data inline (no fixtures needed) following the pattern from `impulse.test.ts`:

```typescript
const context: ContinuationJudgeContext = {
  agentResponse: 'I found interesting patterns in the data...',
  traces: [{
    id: 'trace-1',
    owner: 'test',
    conversationId: 'conv-1',
    toolName: 'web_search',
    input: { query: 'lattice cryptography' },
    outputSummary: 'Found 3 results',
    durationMs: 500,
    success: true,
    error: null,
    createdAt: new Date('2026-04-15T12:00:00Z'),
  }],
  interests: [{
    id: 'int-1',
    owner: 'test',
    name: 'Cryptography',
    description: 'Post-quantum cryptographic methods',
    source: 'conversation',
    engagementScore: 8.5,
    status: 'active',
    lastEngagedAt: new Date('2026-04-15T11:00:00Z'),
    createdAt: new Date('2026-04-10T10:00:00Z'),
  }],
  eventType: 'impulse',
};
```

**Verification:**
Run: `bun test src/subconscious/continuation.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add continuation prompt and parser tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
