# Reflexive Recall Implementation Plan

**Goal:** Wire recall into `processMessage()` flow, add config fields, register context provider in composition root, and emit trace recordings.

**Architecture:** Imperative Shell integration — modifies the agent loop to call `performRecall()` inside the tool loop (after `buildSystemPrompt()`, before skill injection), caches result across tool rounds, and traces execution. Config fields are added to AgentConfigSchema with safe defaults (disabled by default).

**Tech Stack:** TypeScript, Bun, Zod (config schema)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-05-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC8: Trace Recording
- **reflexive-recall.AC8.1 Success:** Trace recorded via `TraceRecorder` with elapsed ms and fragment count
- **reflexive-recall.AC8.2 Success:** Trace fires even when recall returns zero fragments

### reflexive-recall.AC6: Guard Conditions (partial — config gate)
- **reflexive-recall.AC6.1 Success:** `recall_enabled=false` skips recall entirely (default behavior)

### reflexive-recall.AC9: Compaction Ordering
- **reflexive-recall.AC9.1 Success:** Recall runs after compaction check completes
- **reflexive-recall.AC9.2 Success:** Recalled context tokens are not included in compaction threshold estimate

---

<!-- START_TASK_1 -->
### Task 1: Add config fields

**Verifies:** reflexive-recall.AC6.1

**Files:**
- Modify: `src/config/schema.ts:6-14` (AgentConfigSchema)
- Modify: `src/agent/types.ts:19-27` (AgentConfig type)

**Implementation:**

In `src/config/schema.ts`, add to `AgentConfigSchema` (after `max_context_tokens` field):
```typescript
recall_enabled: z.boolean().default(false),
recall_token_budget: z.number().int().positive().default(4096),
```

In `src/agent/types.ts`, add to `AgentConfig` type (after `skill_threshold`):
```typescript
recall_enabled?: boolean;
recall_token_budget?: number;
```

No changes needed to `src/config/config.ts` — fields pass through directly via Zod schema validation.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): add recall_enabled and recall_token_budget config fields`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add recall dependencies to AgentDependencies

**Verifies:** None (infrastructure for AC7.1 and AC8 wiring)

**Files:**
- Modify: `src/agent/types.ts:49-64` (AgentDependencies)

**Implementation:**

Import at the top of `src/agent/types.ts`:
```typescript
import type { RecallContextState } from '@/recall/index.js';
import type { SearchStore } from '@/search/store.js';
```

Add these fields to `AgentDependencies` type (after `traceRecorder?` field, around line 59):
```typescript
recallContextState?: RecallContextState;
searchStore?: SearchStore;
summarizationModel?: ModelProvider;
summarizationModelName?: string;
```

All four fields are optional — recall is disabled by default and these are only used when `recall_enabled` is true.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): add recall dependencies to AgentDependencies`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Agent loop integration

**Verifies:** reflexive-recall.AC8.1, reflexive-recall.AC8.2, reflexive-recall.AC6.1, reflexive-recall.AC9.1, reflexive-recall.AC9.2

**Files:**
- Modify: `src/agent/agent.ts:123-145` (tool loop, between buildSystemPrompt and skills)

**Implementation:**

Add recall step inside the tool loop, after `buildSystemPrompt()` (line 127) and before the `if (deps.skills)` block (line 129).

The recall step should:

1. **Only run on the first tool loop round** (cache result across rounds since user message doesn't change):
   ```typescript
   // Before the while loop (around line 122):
   let cachedRecallResult: RecallResult | null = null;
   let recallExecuted = false;
   ```

2. **Inside the tool loop** (after line 127, before line 129):
   ```typescript
   // Recall step — fires once per turn, cached across tool rounds
   if (!recallExecuted && deps.config.recall_enabled && deps.recallContextState) {
     recallExecuted = true;
     try {
       cachedRecallResult = await performRecall(userMessage, {
         searchStore: deps.searchStore,
         embedding: deps.embedding ?? null,
         model: deps.summarizationModel ?? null,
         modelName: deps.summarizationModelName ?? null,
         tokenBudget: deps.config.recall_token_budget ?? 4096,
         traceRecorder: deps.traceRecorder,
         owner: deps.owner,
         conversationId: id,
         coreLabels: getCoreLabels(deps.memory),
       });
     } catch (error) {
       console.warn('recall: pipeline failed, continuing without recall', error);
       cachedRecallResult = null;
     }
     deps.recallContextState.setResult(cachedRecallResult);
     // Rebuild system prompt with recall context now set
     systemPrompt = await buildSystemPrompt(deps.memory, deps.contextProviders);
   } else if (recallExecuted && deps.recallContextState) {
     // Subsequent rounds: result already cached, just ensure state is set
     deps.recallContextState.setResult(cachedRecallResult);
   }
   ```

3. **Key details:**
   - `performRecall()` handles its own guard conditions (message length, missing embedding) — the agent loop only checks the config gate (`recall_enabled`) and presence of the context state
   - Recall runs AFTER compaction (compaction check is before the tool loop at line ~115) — satisfies AC9.1
   - Recalled context is injected via `ContextProvider` into `buildSystemPrompt()`, NOT counted toward the compaction threshold — satisfies AC9.2 (compaction threshold is estimated from conversation history, not system prompt content)
   - The system prompt is rebuilt after recall sets its result, so the context provider's output is included
   - Trace recording is handled inside `performRecall()` (Phase 3) — AC8.1, AC8.2

4. **Helper for core labels** (add near top of agent.ts or inline):
   ```typescript
   function getCoreLabels(memory: MemoryManager): ReadonlyArray<string> {
     // Get labels of core memory blocks already in system prompt
     // to avoid duplicating them in recall results
     return memory.getCoreBlockLabels?.() ?? [];
   }
   ```
   
   If `MemoryManager` doesn't expose `getCoreBlockLabels()`, pass an empty array and note this as a known limitation (core block deduplication would require a follow-up PR to expose the labels).

5. **Dependencies from Task 2:** `searchStore`, `summarizationModel`, and `summarizationModelName` are already declared on `AgentDependencies` (added in Task 2). Use them as `deps.searchStore`, `deps.summarizationModel`, `deps.summarizationModelName`.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): wire recall into agent tool loop with caching`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Composition root wiring

**Verifies:** reflexive-recall.AC6.1

**Files:**
- Modify: `src/index.ts` (around lines 580-600 for provider creation, lines 880-902 for agent wiring)

**Implementation:**

1. **Import recall module** (at top of file with other imports):
   ```typescript
   import { createRecallContextProvider } from '@/recall/index.js';
   import type { RecallContextState } from '@/recall/index.js';
   ```

2. **Create recall context provider** (around line 594, after other context providers):
   ```typescript
   const recallContextProvider = createRecallContextProvider();
   ```

3. **Add to contextProviders array** (around line 899):
   ```typescript
   contextProviders: [
     ...contextProviders,
     recallContextProvider,  // recall context added here
     predictionContextProvider,
     schedulingContextProvider,
     subconsciousContextProvider,
     introspectionContextProvider,
   ],
   ```

4. **Pass recall deps to agent** (in the agent creation object, around line 901):
   ```typescript
   recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
   searchStore: searchStore,
   summarizationModel: summarizationModel,
   summarizationModelName: config.summarization?.name ?? null,
   ```

   The `searchStore` variable should already exist in the composition root (it's created for the search tool). The `summarizationModel` is the same one passed to the compactor.

5. **Pass config fields** (in the config object passed to agent, around lines 893-894):
   ```typescript
   recall_enabled: config.agent.recall_enabled,
   recall_token_budget: config.agent.recall_token_budget,
   ```

**Verification:**

Before committing, verify integration correctness:

1. Confirm agent loop order by reading `src/agent/agent.ts`:
   - Compaction check (before tool loop) → Tool loop → `buildSystemPrompt()` → Recall step → Skills → Model call
   - This satisfies AC9.1 (recall runs after compaction)

2. Confirm compaction threshold estimation does NOT include recalled context tokens:
   - Compaction check uses conversation history token count (not system prompt size)
   - Recalled context is injected into system prompt, not conversation history
   - Therefore AC9.2 is satisfied by architecture

3. Run full build and test suite:

Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build && bun test`
Expected: Build succeeds, all existing tests pass (recall is disabled by default, no behavior change)

**Commit:** `feat(recall): wire recall context provider and deps in composition root`
<!-- END_TASK_4 -->
