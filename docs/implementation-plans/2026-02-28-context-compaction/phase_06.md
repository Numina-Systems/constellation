# Context Compaction Implementation Plan — Phase 6

**Goal:** Remove the old compression logic from `agent.ts`, wire the new `Compactor` into `AgentDependencies`, and update the automatic trigger to use the new module.

**Architecture:** Add `compactor` to `AgentDependencies` (optional, for backwards compatibility during rollout). Update the compression trigger in `processMessage()` to call `compactor.compress()` instead of the internal `compressConversationHistory()`. Remove the old function and `COMPRESSION_KEEP_RECENT` constant. Wire `Compactor` instantiation in the composition root (`index.ts`). Update existing agent tests to use mock compactor.

**Tech Stack:** TypeScript

**Scope:** 7 phases from original design (phase 6 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-compaction.AC7: Migration preserves existing behaviour
- **context-compaction.AC7.1 Success:** Old `compressConversationHistory()` is removed from `agent.ts`
- **context-compaction.AC7.2 Success:** Automatic compression trigger (`shouldCompress()`) still fires at the same threshold
- **context-compaction.AC7.3 Success:** All existing agent tests pass after migration

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add Compactor to AgentDependencies and update createAgent

**Files:**
- Modify: `src/agent/types.ts:33-40`
- Modify: `src/agent/index.ts` (add Compactor re-export if needed)

**Implementation:**

Add `compactor` as an optional field on `AgentDependencies`:

```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  compactor?: Compactor;
};
```

Import `Compactor` type from `@/compaction`.

Making it optional preserves backwards compatibility — existing code that creates an agent without a compactor won't break. The agent loop checks `if (deps.compactor)` before using it.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass. No existing code breaks.

**Commit:** `feat(agent): add optional Compactor to AgentDependencies`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Replace compressConversationHistory with Compactor in agent loop

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

Three changes to `agent.ts`:

1. **Remove `COMPRESSION_KEEP_RECENT` constant** (line 14). No longer needed — the compactor gets its config from `CompactionConfig`.

2. **Update compression trigger** (lines 44-46). Replace:
   ```typescript
   if (shouldCompress(history, deps.config.context_budget, modelMaxTokens)) {
     history = await compressConversationHistory(history, id);
   }
   ```
   With:
   ```typescript
   if (deps.compactor && shouldCompress(history, deps.config.context_budget, modelMaxTokens)) {
     const result = await deps.compactor.compress(history, id);
     history = Array.from(result.history);
   }
   ```
   The guard `deps.compactor &&` ensures the old codepath is simply skipped if no compactor is injected (backwards compatible).

3. **Remove `compressConversationHistory()` function** (lines 244-311). Delete the entire function. Also remove the Phase 5 guard check (`if ('compactor' in deps && deps.compactor)`) from the compact_context special case — now that compactor is a typed optional field, use `deps.compactor` directly.

4. **Update compact_context special case** (from Phase 5). Change the guard to `if (deps.compactor)` and use the typed field. If no compactor, return a tool error: `{ success: false, output: 'Compaction not configured' }`.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `refactor(agent): replace compressConversationHistory with Compactor`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire Compactor in composition root

**Files:**
- Modify: `src/index.ts:234-278`

**Implementation:**

In the `main()` function, after creating the summarization model provider (Phase 1) and before creating the agent (line 266), create the compactor:

1. Build `CompactionConfig` from `config.summarization` (or defaults if absent):
   ```typescript
   const compactionConfig: CompactionConfig = {
     chunkSize: config.summarization?.chunk_size ?? 20,
     keepRecent: config.summarization?.keep_recent ?? 5,
     maxSummaryTokens: config.summarization?.max_summary_tokens ?? 1024,
     clipFirst: config.summarization?.clip_first ?? 2,
     clipLast: config.summarization?.clip_last ?? 2,
     prompt: config.summarization?.prompt ?? null,
   };
   ```

2. Create the compactor:
   ```typescript
   const compactor = createCompactor({
     model: summarizationModel,  // from Phase 1 (falls back to main model)
     memory,
     persistence,
     config: compactionConfig,
     modelName: config.summarization?.name ?? config.model.name,
     getPersona: async () => {
       const blocks = await memory.list('core');
       const persona = blocks.find(b => b.label === 'core:persona');
       return persona?.content ?? '';
     },
   });
   ```

3. Pass compactor to `createAgent()`:
   ```typescript
   const agent = createAgent({
     model,
     memory,
     registry,
     runtime,
     persistence,
     config: { ... },
     compactor,
   });
   ```

Import `createCompactor` from `@/compaction` and `CompactionConfig` type.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

```bash
bun test
```

Expected: All tests pass. The existing compression test (`AC1.12: compresses context when budget exceeded`) should still work — see Task 4.

**Commit:** `feat: wire Compactor into composition root`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Update existing agent compression test to use mock Compactor

**Verifies:** context-compaction.AC7.2, context-compaction.AC7.3

**Files:**
- Modify: `src/agent/agent.test.ts`

**Testing:**

The existing test `AC1.12: compresses context when budget exceeded` (lines 290-362) needs updating because:
- The old test checked for a summarization system prompt in model calls
- The new flow delegates to `Compactor.compress()`, which handles LLM calls internally
- The agent test should now verify that the compactor is called, not that the model receives a summarization prompt

Update the test:
1. Create a mock compactor with call recording, following the project's hand-written mock factory pattern:
   ```typescript
   function createMockCompactor(result: CompactionResult): Compactor & { calls: Array<{ history: ReadonlyArray<ConversationMessage>; conversationId: string }> } {
     const calls: Array<{ history: ReadonlyArray<ConversationMessage>; conversationId: string }> = [];
     return {
       calls,
       async compress(history, conversationId) {
         calls.push({ history: [...history], conversationId });
         return result;
       },
     };
   }
   ```
2. Inject it via `AgentDependencies`
3. Assert that `compress()` was called when budget exceeded (check `mockCompactor.calls.length === 1`)
4. Assert that after compression, the agent loop continues with the compressed history

Tests must verify:
- context-compaction.AC7.2: `shouldCompress()` still fires at the same threshold (`context_budget * model_max_tokens`). The trigger condition hasn't changed — only what happens after the trigger.
- context-compaction.AC7.3: All existing agent tests pass. The mock compactor should be a no-op for tests that don't exercise compression.

For tests that don't involve compression, omit the `compactor` field from `AgentDependencies` (it's optional).

**Verification:**

```bash
bun test src/agent/agent.test.ts
```

Expected: ALL existing + updated tests pass.

**Commit:** `test(agent): update compression tests for Compactor integration`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Full verification — build and all tests

**Files:**
- No new files — operational verification only

**Implementation:**

Run the full build and test suite to verify no regressions:

```bash
bun run build
```

Expected: Type-checks pass with no errors.

```bash
bun test
```

Expected: Same pass/fail counts as baseline (116+ pass, 3 DB-dependent fail). New tests added in Phases 2-6 should all pass. No existing tests broken.

Verify the old compression code is completely removed:
- No references to `compressConversationHistory` anywhere
- No references to `COMPRESSION_KEEP_RECENT` in agent.ts
- `shouldCompress()` still exists in `context.ts` and is still called in agent.ts

**Commit:** No commit — verification only.

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
