# Session Checkpointing Implementation Plan — Phase 3

**Goal:** Wire checkpoint creation into the four trigger points: explicit command, pre-compaction, shutdown, and turn interval.

**Architecture:** Imperative Shell integration across the agent loop, shutdown handler, and tool registry. A shared `performCheckpoint` helper collects agent state from subsystem dependencies and delegates to `serializeCheckpoint` and `CheckpointStore.save` + `.prune`. All checkpoint creation is wrapped in try/catch so failures never block the agent (AC1.6).

**Tech Stack:** Bun (TypeScript), PostgreSQL

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC1: Checkpoint Creation
- **session-checkpointing.AC1.1 Success:** Explicit `/checkpoint` command creates a checkpoint and confirms with the checkpoint ID
- **session-checkpointing.AC1.2 Success:** Pre-compaction checkpoint is created automatically before compaction runs
- **session-checkpointing.AC1.3 Success:** Graceful shutdown (SIGTERM/SIGINT) creates a checkpoint before exit
- **session-checkpointing.AC1.4 Success:** Turn-interval checkpoint fires every N turns when `checkpoint_interval` is configured (e.g., every 10 turns)
- **session-checkpointing.AC1.5 Edge:** Turn-interval of 0 disables interval-based checkpointing (only explicit/pre-compaction/shutdown triggers remain)
- **session-checkpointing.AC1.6 Edge:** Checkpoint creation failure (DB error) does not block the agent loop — warning is logged, operation continues

---

<!-- START_TASK_1 -->
### Task 1: Config schema and type additions

**Verifies:** session-checkpointing.AC1.4, session-checkpointing.AC1.5

**Files:**
- Modify: `src/config/schema.ts` (the `AgentConfigSchema` block, currently lines 6-17)
- Modify: `src/agent/types.ts` (the `AgentConfig` type, currently lines 21-32)
- Modify: `src/index.ts` (the config unpacking block inside `createAgent()` call, currently around lines 967-976)

**Implementation:**

**In `src/config/schema.ts`:** Add four fields to `AgentConfigSchema`, following the existing `recall_enabled` and `cache_diagnostics` patterns:

```typescript
checkpoint_interval: z.number().int().nonnegative().default(0),
checkpoint_retention: z.number().int().positive().default(5),
auto_resume: z.boolean().default(false),
resume_checkpoint: z.string().optional(),
```

- `checkpoint_interval`: Turns between automatic checkpoints. `0` disables interval checkpointing (AC1.5).
- `checkpoint_retention`: Max checkpoints to retain per conversation (default 5).
- `auto_resume`: Load most recent checkpoint for configured owner on startup.
- `resume_checkpoint`: Explicit checkpoint ID to restore on startup.

**In `src/agent/types.ts`:** Add corresponding optional fields to `AgentConfig`:

```typescript
checkpoint_interval?: number;
checkpoint_retention?: number;
auto_resume?: boolean;
resume_checkpoint?: string;
```

**In `src/index.ts`:** Add to the config unpacking block:

```typescript
checkpoint_interval: config.agent.checkpoint_interval,
checkpoint_retention: config.agent.checkpoint_retention,
auto_resume: config.agent.auto_resume,
resume_checkpoint: config.agent.resume_checkpoint,
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(config): add checkpoint config fields to agent schema`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add getResult() to RecallContextState

**Verifies:** None (prerequisite for checkpoint creation — exposes recall cache for serialization)

**Files:**
- Modify: `src/recall/context.ts` (currently 59 lines)

**Implementation:**

The `RecallContextState` type at `src/recall/context.ts:11-13` currently only has `setResult`. The implementation holds `currentResult` in closure. Add a getter:

1. Add `getResult(): RecallResult | null` to the `RecallContextState` type definition at line 12.
2. In `createRecallContextProvider()` at line 44, add the getter to the provider object: `provider.getResult = () => currentResult;`

This is a minimal additive change — one type line and one implementation line.

**Verification:**
Run: `bun run build`
Expected: Type-check passes. No existing tests break.

**Commit:** `feat(recall): expose getResult() on RecallContextState for checkpoint serialization`

<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Checkpoint creation helper

**Verifies:** session-checkpointing.AC1.6

**Files:**
- Create: `src/agent/checkpoint-create.ts`

**Implementation:**

Create `src/agent/checkpoint-create.ts` with pattern annotation `// pattern: Imperative Shell`.

Import types from checkpoint modules, memory, reflexion, subconscious, and recall:
- `serializeCheckpoint`, `CheckpointTrigger`, `AgentCheckpointState` from `./checkpoint-types.ts` and `./checkpoint-serializer.ts`
- `CheckpointStore` from `@/persistence/checkpoint-store.ts`
- `MemoryManager` from `@/memory/manager.ts`
- `PredictionStore` from `@/reflexion/types.ts`
- `InterestRegistry` from `@/subconscious/types.ts`
- `RecallContextState` from `@/recall/context.ts`
- `randomUUID` from `node:crypto`

Define `CheckpointDependencies`:
```typescript
type CheckpointDependencies = {
  readonly checkpointStore: CheckpointStore;
  readonly memory: MemoryManager;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
  readonly owner: string;
  readonly conversationId: string;
  readonly retentionCount: number;
};
```

Define `CheckpointAgentState` (runtime state the agent exposes via a shared ref):
```typescript
type CheckpointAgentState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly compactionMeta: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
};
```

Export `async function performCheckpoint(trigger, agentState, deps): Promise<string | null>`:

1. Collect subsystem state:
   - `workingMemory`: `deps.memory.list('working')` → map to `{ label: b.label, content: b.content }`
   - `pendingPredictions`: If `deps.predictionStore` exists, `deps.predictionStore.listPredictions(deps.owner, 'pending')` → map to `{ id: p.id, predictionText: p.predictionText, domain: p.domain, confidence: p.confidence, createdAt: p.createdAt.toISOString() }`. Otherwise empty array.
   - `activeInterests`: If `deps.interestRegistry` exists, `deps.interestRegistry.listInterests(deps.owner, { status: 'active' })` → map to `{ id: i.id, name: i.name, engagementScore: i.engagementScore, status: i.status, lastEngagedAt: i.lastEngagedAt.toISOString() }`. Otherwise empty array.
   - `recallCache`: If `deps.recallContextState?.getResult()` returns a result, map to `{ decomposition: result.fragments.length > 0 ? { queries: [...decomp.queries], entities: [...decomp.entities] } : null, fragmentCount: result.fragments.length }`. Otherwise `null`. Note: Need to get the decomposition separately from the result — the `RecallResult` only has fragments, totalTokens, queryCount, elapsed. The decomposition lives in the recall pipeline, not the result. Simplify: store `fragmentCount` from the result and set `decomposition: null` for now. Full decomposition capture would require threading it through `RecallContextState` which is out of scope.

2. Build `AgentCheckpointState` from collected data + `agentState` fields

3. Generate ID with `randomUUID()` and timestamp with `new Date().toISOString()`

4. Call `serializeCheckpoint({ id, conversationId: deps.conversationId, owner: deps.owner, trigger, state, createdAt })`

5. Call `deps.checkpointStore.save(checkpoint)` then `deps.checkpointStore.prune(deps.conversationId, deps.retentionCount)`

6. Wrap entire operation in try/catch. On error: `console.warn('[checkpoint] failed to create ${trigger} checkpoint:', (error as Error).message)`. Return `null`.

7. On success: return `checkpoint.id`.

Export `CheckpointDependencies`, `CheckpointAgentState`, and `performCheckpoint`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): implement checkpoint creation helper with failure tolerance`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Checkpoint creation helper tests

**Verifies:** session-checkpointing.AC1.6

**Files:**
- Create: `src/agent/checkpoint-create.test.ts`

**Testing:**

Unit tests using inline stubs (same approach as `src/agent/agent.test.ts` mock patterns). No database needed — stub all dependencies.

Tests:

- **Successful checkpoint creation:** Stub all deps with in-memory implementations (memory returns blocks, predictionStore returns predictions, interestRegistry returns interests). Call `performCheckpoint('explicit', agentState, deps)`. Assert returns a UUID string. Assert `checkpointStore.save` was called with a valid checkpoint containing the collected state.

- **Failure tolerance (AC1.6):** Stub `checkpointStore.save` to throw. Call `performCheckpoint()`. Assert returns `null` (not thrown). Verify no exception propagates.

- **Empty subsystem state:** Stub memory to return `[]`, no predictionStore, no interestRegistry, no recallContextState. Assert checkpoint has empty arrays and null recallCache.

- **Full subsystem state mapping:** Verify working memory blocks correctly map `label` and `content`. Verify predictions map `id`, `predictionText`, `domain`, `confidence`, `createdAt` (as ISO string). Verify interests map `id`, `name`, `engagementScore`, `status`, `lastEngagedAt` (as ISO string).

- **Prune is called after save:** Assert that `checkpointStore.prune` is called with the correct conversationId and retentionCount.

**Verification:**
Run: `bun test src/agent/checkpoint-create.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add unit tests for checkpoint creation helper`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: Checkpoint tool definition

**Verifies:** session-checkpointing.AC1.1

**Files:**
- Create: `src/tool/builtin/checkpoint.ts`

**Implementation:**

Create `src/tool/builtin/checkpoint.ts` with pattern annotation `// pattern: Imperative Shell`.

Follow the tool definition pattern from `src/tool/builtin/memory.ts`. Export a factory function:

```typescript
function createCheckpointTool(
  deps: CheckpointDependencies,
  getAgentState: () => CheckpointAgentState,
): Tool
```

Tool definition:
- `name`: `'checkpoint'`
- `description`: `'Create a snapshot of the current agent state including conversation history, working memory, predictions, interests, and compaction metadata. Returns the checkpoint ID.'`
- `parameters`: Empty array (no parameters needed)

Handler: Calls `performCheckpoint('explicit', getAgentState(), deps)`. Returns `{ success: true, output: 'Checkpoint created: ${id}' }` on success, `{ success: false, output: 'Checkpoint creation failed. Check logs for details.', error: 'checkpoint_failed' }` on null.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(tool): add checkpoint tool definition`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Agent loop integration (pre-compaction + turn-interval triggers)

**Verifies:** session-checkpointing.AC1.2, session-checkpointing.AC1.4, session-checkpointing.AC1.5

**Files:**
- Modify: `src/agent/types.ts` (add optional checkpoint deps to `AgentDependencies`)
- Modify: `src/agent/agent.ts`

**Implementation:**

**In `src/agent/types.ts`:** Add optional checkpoint dependencies to `AgentDependencies`:

```typescript
checkpointFn?: (trigger: CheckpointTrigger) => Promise<string | null>;
```

This is a pre-bound function (created in the composition root) that the agent calls when a trigger fires. It avoids passing all checkpoint dependencies into the agent — the agent just calls the function with the trigger type. The composition root binds everything else (agent state ref, subsystem deps).

**In `src/agent/agent.ts`:**

1. **Pre-compaction trigger (AC1.2):** Before each `deps.compactor.compress()` call (there are two — the automatic compression check around line 164, and the `compact_context` tool handler around line 373), insert:
   ```typescript
   if (deps.checkpointFn) {
     await deps.checkpointFn('pre_compaction');
   }
   ```

2. **Turn-interval trigger (AC1.4, AC1.5):** At the end of `processMessage()`, after persisting the assistant response but before returning, add:
   ```typescript
   if (
     deps.checkpointFn &&
     deps.config.checkpoint_interval &&
     deps.config.checkpoint_interval > 0 &&
     turnNumber % deps.config.checkpoint_interval === 0
   ) {
     await deps.checkpointFn('interval');
   }
   ```
   When `checkpoint_interval` is 0 or undefined, this condition short-circuits (AC1.5).

**Verification:**
Run: `bun run build && bun test src/agent/`
Expected: Type-check passes. All existing agent tests pass (checkpointFn is optional).

**Commit:** `feat(agent): add pre-compaction and turn-interval checkpoint triggers`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Shutdown trigger and composition root wiring

**Verifies:** session-checkpointing.AC1.1, session-checkpointing.AC1.3

**Files:**
- Modify: `src/index.ts`

**Implementation:**

**Shutdown trigger (AC1.3):** In `createShutdownHandler()` (around line 239), add an optional checkpoint callback parameter. Before existing cleanup steps (stop scheduler, shutdown data sources), call it:
```typescript
if (checkpointFn) {
  try {
    await checkpointFn();
  } catch (err) {
    console.warn('[checkpoint] shutdown checkpoint failed:', (err as Error).message);
  }
}
```

**Composition root wiring:** After agent creation (around line 960+):

1. Create checkpoint store: `const checkpointStore = createCheckpointStore(persistence);`

2. Create a mutable agent state ref that the agent updates and checkpoint reads:
   ```typescript
   const agentStateRef: { current: CheckpointAgentState } = {
     current: {
       turnNumber: 0, toolRound: 0,
       messageIds: [],
       compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
     },
   };
   ```

3. Build checkpoint deps and the bound `performCheckpoint` function:
   ```typescript
   const checkpointDeps: CheckpointDependencies = {
     checkpointStore,
     memory,
     predictionStore,
     interestRegistry,
     recallContextState,
     owner: AGENT_OWNER,
     conversationId: agent.conversationId,
     retentionCount: config.agent.checkpoint_retention ?? 5,
   };
   
   const checkpointFn = async (trigger: CheckpointTrigger) => {
     return performCheckpoint(trigger, agentStateRef.current, checkpointDeps);
   };
   ```

4. Register checkpoint tool:
   ```typescript
   const checkpointTool = createCheckpointTool(checkpointDeps, () => agentStateRef.current);
   registry.register(checkpointTool);
   ```

5. Pass `checkpointFn` to agent via `AgentDependencies`.

6. Wire shutdown checkpoint: Pass `async () => { await checkpointFn('shutdown'); }` to the shutdown handler.

**Agent state ref update mechanism:** The `checkpointFn` closure captures `agentStateRef`, but the agent must update `agentStateRef.current` so checkpoint reads reflect current state. The chosen approach: pass `agentStateRef` into `AgentDependencies` as a new optional field `checkpointStateRef?: { current: CheckpointAgentState }`. In `agent.ts`, update it at the end of each `processMessage()` call (after persisting the assistant response, before returning):

```typescript
if (deps.checkpointStateRef) {
  const messageIds = history.map(m => m.id);
  deps.checkpointStateRef.current = {
    turnNumber,
    toolRound: 0,
    messageIds,
    compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
  };
}
```

Note: `compactionMeta` values (-1 and 0) are placeholders — the compactor tracks its own state internally and doesn't expose a "last compacted index". For restoration, the meaningful values are `turnNumber` and `messageIds`. The compaction system re-evaluates from scratch on each turn based on the current history length vs. budget, so the exact compaction index is not critical for checkpoint restoration. If more precise compaction state is needed later, it can be added by extending the `Compactor` interface.

Add `checkpointStateRef?: { current: CheckpointAgentState }` to `AgentDependencies` in `src/agent/types.ts` alongside the `checkpointFn` field added in Task 6.

**Verification:**
Run: `bun run build`
Expected: Type-check passes. Application starts without errors.

**Commit:** `feat(checkpoint): wire checkpoint triggers into composition root`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Integration tests for checkpoint triggers

**Verifies:** session-checkpointing.AC1.1, session-checkpointing.AC1.2, session-checkpointing.AC1.3, session-checkpointing.AC1.4, session-checkpointing.AC1.5, session-checkpointing.AC1.6

**Files:**
- Create: `src/agent/checkpoint-triggers.test.ts`

**Testing:**

Add tests that verify the trigger integration using the same agent mock patterns from `src/agent/agent.test.ts`:

- **AC1.1 (explicit tool):** Create a mock agent with checkpoint deps. Simulate a `checkpoint` tool call. Assert `checkpointStore.save` was called with `trigger: 'explicit'`.

- **AC1.2 (pre-compaction):** Create agent with compactor and checkpoint deps. Trigger compaction (send a message that exceeds context budget). Assert a checkpoint with `trigger: 'pre_compaction'` was saved before compression ran.

- **AC1.4 (turn-interval):** Create agent with `checkpoint_interval: 2`. Process 4 messages. Assert checkpoints with `trigger: 'interval'` were saved after turns 2 and 4.

- **AC1.5 (interval disabled):** Create agent with `checkpoint_interval: 0`. Process 4 messages. Assert no interval checkpoints were created.

- **AC1.3 (shutdown):** Call the shutdown checkpoint callback directly (signal testing is impractical in unit tests). Assert a checkpoint with `trigger: 'shutdown'` was saved via `checkpointStore.save`.

- **AC1.6 (failure tolerance):** Create agent with checkpoint deps where `checkpointStore.save` throws. Process a message. Assert agent completes normally (no exception), warning was logged.

**Verification:**
Run: `bun test src/agent/checkpoint-triggers.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add integration tests for checkpoint triggers`

<!-- END_TASK_8 -->
