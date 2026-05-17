# Impulse Continuation Implementation Plan — Phase 3

**Goal:** Create LLM-backed implementation of the `ContinuationJudge` port interface.

**Architecture:** Imperative Shell adapter that receives a `ModelProvider` at construction, delegates prompt building and response parsing to the pure functions from Phase 1. Follows the same port/adapter split as `impulse.ts` (core) + `impulse-assembler.ts` (shell).

**Tech Stack:** TypeScript, Bun test runner

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### impulse-continuation.AC2: LLM judge evaluation
- **impulse-continuation.AC2.1 Success:** Judge calls ModelProvider with correct prompt and returns parsed decision
- **impulse-continuation.AC2.2 Failure:** Model provider error (network, timeout) returns `shouldContinue: false`
- **impulse-continuation.AC2.3 Failure:** Model returns unparseable response, judge returns `shouldContinue: false`

---

## Reference Files

The executor should read these files to understand established patterns:

- `src/subconscious/continuation.ts` — Pure functions from Phase 1 (types, `buildContinuationPrompt`, `parseContinuationResponse`)
- `src/subconscious/impulse-assembler.ts` — Imperative Shell adapter pattern with factory function
- `src/model/types.ts` — `ModelProvider` interface, `ModelRequest`, `ModelResponse`, `TextBlock`, `ContentBlock`, `Message`
- `src/compaction/compactor.ts:490` — Existing `model.complete()` call pattern
- `src/compaction/compactor.test.ts:162-178` — `ModelProvider` mock pattern
- `src/subconscious/CLAUDE.md` — Module contracts and conventions

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: ContinuationJudge adapter implementation

**Verifies:** impulse-continuation.AC2.1, impulse-continuation.AC2.2, impulse-continuation.AC2.3

**Files:**
- Create: `src/subconscious/continuation-judge.ts`

**Implementation:**

Create `src/subconscious/continuation-judge.ts` with pattern annotation `// pattern: Imperative Shell` on line 1.

Import the `ContinuationJudge` type and pure functions from `./continuation.ts`. Import `ModelProvider` from `@/model/types`. Import `TextBlock` from `@/model/types` for content filtering.

Define the dependencies type:

```typescript
type ContinuationJudgeDeps = {
  readonly model: ModelProvider;
  readonly modelName: string;
};
```

Implement the factory function:

```typescript
function createContinuationJudge(deps: Readonly<ContinuationJudgeDeps>): ContinuationJudge
```

The `evaluate` method:
1. Call `buildContinuationPrompt(context)` to construct the prompt string
2. Build a `ModelRequest` with:
   - `messages: [{ role: 'user', content: prompt }]`
   - `model: deps.modelName`
   - `max_tokens: 256` (response is short JSON)
   - `temperature: 0` (deterministic evaluation)
3. Call `deps.model.complete(request)` inside a try/catch
4. Extract text from response: `response.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('')`
5. Call `parseContinuationResponse(text)` and return the result
6. On any error (model call failure, network timeout), return `{ shouldContinue: false, reason: 'Judge evaluation failed: <error message>' }`

Export `ContinuationJudgeDeps` and `createContinuationJudge` as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(subconscious): add continuation judge adapter`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ContinuationJudge adapter tests

**Verifies:** impulse-continuation.AC2.1, impulse-continuation.AC2.2, impulse-continuation.AC2.3

**Files:**
- Create: `src/subconscious/continuation-judge.test.ts`
- Test: `src/subconscious/continuation-judge.test.ts` (unit)

**Testing:**

Follow the mock pattern from `src/compaction/compactor.test.ts:162-178` for creating a mock `ModelProvider`. The mock must implement both `complete()` and `stream()` methods. Use `as unknown as ModelProvider` cast.

Tests must verify each AC listed above:

- **impulse-continuation.AC2.1:** Mock `ModelProvider` that returns `{ content: [{ type: 'text', text: '{"continue": true, "reason": "found momentum"}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } }`. Call `judge.evaluate(context)` with a valid `ContinuationJudgeContext`. Assert result is `{ shouldContinue: true, reason: 'found momentum' }`. Also capture the request passed to `model.complete()` and verify:
  - Request has exactly 1 message with `role: 'user'`
  - Message content contains the agent response text from context
  - `max_tokens` is 256
  - `temperature` is 0

- **impulse-continuation.AC2.2:** Mock `ModelProvider` whose `complete()` throws an `Error('Connection refused')`. Assert result is `{ shouldContinue: false }` and `reason` contains the error message.

- **impulse-continuation.AC2.3:** Mock `ModelProvider` that returns text `'I think we should continue exploring'` (valid text but not JSON). Assert result is `{ shouldContinue: false, reason: 'Failed to parse continuation response' }`.

Create test data for `ContinuationJudgeContext` inline, reusing the same shape as Phase 1 tests.

**Verification:**
Run: `bun test src/subconscious/continuation-judge.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add continuation judge adapter tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
