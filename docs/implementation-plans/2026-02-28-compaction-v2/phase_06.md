# Compaction V2 Implementation Plan — Phase 6: Integration Test

**Goal:** End-to-end verification that the refactored compaction pipeline works with structured prompts, importance scoring, and no persona injection.

**Architecture:** A compaction-specific integration test in `src/compaction/compactor.test.ts` that exercises the full `compress()` pipeline with mocked dependencies. Verifies the structured LLM call shape, importance ordering in compressed messages, and clip-archive output. Does not require a real database — uses the existing mock patterns from compactor.test.ts.

**Tech Stack:** TypeScript, Bun

**Scope:** 6 of 6 phases from original design (phase 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests (end-to-end verification):

### compaction-v2.AC1: Structured Summarization Prompts
- **compaction-v2.AC1.1 Success:** Summarization LLM call uses `system` field for config prompt (or default) and passes messages as structured conversation
- **compaction-v2.AC1.2 Success:** Previous compaction summary is passed as a system-role message in the messages array
- **compaction-v2.AC1.3 Success:** Actual conversation messages preserve their original roles (user/assistant) in the summarization request
- **compaction-v2.AC1.4 Success:** Baked-in directive appears as final user message with preserve/condense/prioritize/remove instructions
- **compaction-v2.AC1.5 Edge:** No previous summary results in no system-role context message (not an empty one)
- **compaction-v2.AC1.6 Edge:** Re-summarization (`resummarizeBatches`) uses the same structured message approach

### compaction-v2.AC2: Extended ModelRequest
- **compaction-v2.AC2.1 Success:** `Message` type accepts `role: 'system'` alongside 'user' and 'assistant'

### compaction-v2.AC3: Importance-Based Scoring
- **compaction-v2.AC3.1 Success:** Messages scored by role weight (system > user > assistant by default)
- **compaction-v2.AC3.4 Success:** `splitHistory()` returns `toCompress` sorted by importance ascending (lowest-scored first)

### compaction-v2.AC4: Persona Via Custom Prompt Only
- **compaction-v2.AC4.1 Success:** No code path in compaction module injects persona content
- **compaction-v2.AC4.2 Success:** `getPersona` callback is fully removed from `CreateCompactorOptions`
- **compaction-v2.AC4.4 Success:** Absent custom prompt falls back to default generic system prompt

---

<!-- START_TASK_1 -->
### Task 1: Full pipeline integration test

**Verifies:** compaction-v2.AC1.1, compaction-v2.AC1.2, compaction-v2.AC1.3, compaction-v2.AC1.4, compaction-v2.AC1.5, compaction-v2.AC2.1, compaction-v2.AC3.1, compaction-v2.AC3.4, compaction-v2.AC4.1, compaction-v2.AC4.2, compaction-v2.AC4.4

**Files:**
- Modify: `src/compaction/compactor.test.ts`

**Testing:**

Add a new top-level `describe('compaction pipeline integration', ...)` block at the end of the test file. This exercises the full `createCompactor → compress()` pipeline with mocked dependencies, verifying the combined behavior of all previous phases.

The test should:

1. **Set up mocked dependencies** following the existing test patterns:
   - `ModelProvider` mock that captures the `ModelRequest` passed to `complete()` and returns a canned summary response
   - `MemoryManager` mock (from the `createResummarizeTestContext` pattern) with `write`, `list`, `deleteBlock`
   - `PersistenceProvider` mock with a `query` function that captures SQL calls

2. **Build a test history** with varied message types (15+ messages to ensure compression triggers):
   - System message (clip-archive from prior compaction)
   - Mix of user and assistant messages with varying content:
     - Short assistant messages (low importance)
     - User messages with questions (higher importance due to `?` bonus)
     - Messages with important keywords like "error" or "decision"
   - Recent messages that should be kept (within `keepRecent` window)

3. **Create compactor** with scoring config enabled:
   ```typescript
   const compactor = createCompactor({
     model: mockModel,
     memory: mockMemory,
     persistence: mockPersistence,
     config: {
       chunkSize: 5,
       keepRecent: 3,
       maxSummaryTokens: 512,
       clipFirst: 1,
       clipLast: 1,
       prompt: null,
       scoring: DEFAULT_SCORING_CONFIG,
     },
     modelName: 'test-model',
   });
   ```

4. **Call `compress()`** and verify:
   - **AC4.2:** `createCompactor` does NOT accept `getPersona` (compile-time check — the test compiles)
   - **AC4.4:** The captured `ModelRequest` has `system` field set to `DEFAULT_SYSTEM_PROMPT` (no custom prompt → default)
   - **AC1.1:** The captured `ModelRequest` has `system` field and structured messages array
   - **AC1.3:** The messages array contains user and assistant messages with their original roles
   - **AC1.4:** The last message in the captured request is `{ role: 'user' }` containing the directive text
   - **AC1.5:** If no prior summary existed, no system-role message appears before conversation messages
   - **AC2.1:** System-role messages appear in the messages array (for prior summary)
   - **AC4.1:** No "persona" text appears anywhere in the captured request

5. **Verify importance ordering** (AC3.1, AC3.4):
   - Inspect which messages were passed to the model for summarization
   - The messages should reflect the importance-sorted order from `splitHistory`
   - Lowest-importance messages (short assistant replies) should appear in earlier chunks

6. **Verify result shape:**
   - `CompactionResult.history` contains clip-archive system message + kept recent messages
   - `CompactionResult.batchesCreated > 0`
   - `CompactionResult.messagesCompressed > 0`

Add a second test case for the "with prior summary" scenario:
- Build history with a `[Context Summary —` system message as the first message
- Verify AC1.2: The captured `ModelRequest` has a system-role message with `'Previous summary of conversation:\n...'`

Add a third test case for re-summarization (AC1.6):
- Set up enough batches in the mock memory `list` return to trigger `shouldResummarize`
- Verify the re-summarization `ModelRequest` also uses structured messages (system field + batch system-role messages + directive)

Follow existing test patterns: factory helpers, mock capture, `describe`/`it` blocks.

**Verification:**

Run: `bun test src/compaction/compactor.test.ts`
Expected: All tests pass (existing + new integration tests)

**Commit:** `test(compaction): add full pipeline integration tests for compaction v2`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify full test suite passes

**Verifies:** All ACs end-to-end

**Files:** None (verification only)

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

Run: `bun test`
Expected: All tests pass across the entire project. No regressions.

Verify specific coverage:
- `bun test src/model/` — Model type extension and adapter tests
- `bun test src/compaction/` — Prompt, scoring, compactor, and integration tests
- `bun test src/config/` — Config schema tests (scoring fields have defaults, existing configs valid)

**Commit:** No commit needed — verification only
<!-- END_TASK_2 -->
