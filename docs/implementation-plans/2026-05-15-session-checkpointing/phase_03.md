# Session Checkpointing Implementation Plan

**Goal:** Wire checkpoint creation into the four trigger points: explicit command, pre-compaction, shutdown, and turn interval.

**Architecture:** Imperative Shell integration across the agent loop, shutdown handler, and tool registry. A shared `createCheckpoint` helper collects agent state and delegates to `serializeCheckpoint` and `CheckpointStore.save` + `.prune`. All checkpoint creation is wrapped in try/catch so failures never block the agent.

**Tech Stack:** Bun, TypeScript 5.7+, PostgreSQL, Zod

**Scope:** Phase 3 of 4

**Codebase verified:** 2026-05-15

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
### Task 1: Config schema additions

**Verifies:** session-checkpointing.AC1.4, AC1.5

**Files:**
- Modify: `src/config/schema.ts`

**Implementation:**

Add three fields to `AgentConfigSchema` in `src/config/schema.ts`:

```typescript
checkpoint_interval: z.number().int().nonnegative().default(0),
checkpoint_retention: z.number().int().positive().default(5),
auto_resume: z.boolean().default(false),
```

And add one optional field to `AppConfigSchema` (not inside `AgentConfigSchema`, since it's a startup parameter rather than runtime config — or place in `AgentConfigSchema` if that's simpler for wiring):

Actually, keep all checkpoint config in `AgentConfigSchema` since it's agent behavior:

```typescript
checkpoint_interval: z.number().int().nonnegative().default(0),
checkpoint_retention: z.number().int().positive().default(5),
auto_resume: z.boolean().default(false),
resume_checkpoint: z.string().uuid().optional(),
```

- `checkpoint_interval`: Number of turns between automatic checkpoints. `0` disables interval checkpointing (AC1.5).
- `checkpoint_retention`: Maximum checkpoints to retain per conversation (default 5). Used by pruning.
- `auto_resume`: When true and no explicit checkpoint ID is given, load the most recent checkpoint for the configured owner on startup.
- `resume_checkpoint`: Explicit checkpoint UUID to restore on startup. Overrides `auto_resume`.

**Important:** `AgentConfig` in `src/agent/types.ts` is manually defined (NOT inferred from Zod). After adding these fields to `AgentConfigSchema`, you must also:
1. Add the corresponding fields to the `AgentConfig` type in `src/agent/types.ts`
2. Update the manual mapping in `src/index.ts` (where config schema values are mapped to `AgentConfig` properties) to include the new checkpoint fields

**Verification:**
Run: `bun run build`
Expected: Type-check passes. Existing tests still pass (defaults don't break anything).

**Commit:** `feat(checkpoint): add checkpoint config fields to agent schema`
<!-- END_TASK_1 -->

<!-- START_TASK_1B -->
### Task 1b: Add getResult() to RecallContextState

**Verifies:** session-checkpointing.AC2.6 (prerequisite for checkpoint creation)

**Files:**
- Modify: `src/recall/context.ts`
- Modify: `src/recall/CLAUDE.md` (if it exists — update the public API section)

**Implementation:**

The `RecallContextState` type in `src/recall/context.ts` currently has `setResult(result)` but no getter. The implementation already holds `currentResult` in closure. Add:

1. Add `getResult(): RecallResult | null` to the `RecallContextState` type definition
2. In `createRecallContextState()`, expose the getter: `getResult: () => currentResult`

This is a minimal change — one type addition and one line of implementation.

**Verification:**
Run: `bun run build`
Expected: Type-check passes. No existing tests break (additive change only).

**Commit:** `feat(recall): expose getResult() on RecallContextState for checkpoint serialization`
<!-- END_TASK_1B -->

<!-- START_TASK_2 -->
### Task 2: Checkpoint creation helper

**Verifies:** session-checkpointing.AC1.6

**Files:**
- Create: `src/agent/checkpoint-create.ts`
- Test: `src/agent/checkpoint-create.test.ts` (unit)

**Implementation:**

Create `src/agent/checkpoint-create.ts` with pattern annotation `// pattern: Imperative Shell`.

This module provides the shared checkpoint creation logic used by all four trigger points.

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

Define `CheckpointAgentState` (the mutable runtime state the agent exposes):

```typescript
type CheckpointAgentState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly compactionMetadata: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
};
```

Export `async function performCheckpoint(trigger: CheckpointTrigger, agentState: CheckpointAgentState, deps: CheckpointDependencies): Promise<string | null>`:

1. Collect subsystem state:
   - `workingMemory`: Call `deps.memory.getWorkingBlocks()` → map to `{ label: block.label, content: block.content }` (note: `MemoryManager` has owner baked in at construction — no owner parameter needed)
   - `pendingPredictions`: If `deps.predictionStore` exists, call `deps.predictionStore.listPredictions(deps.owner, 'pending')` → map to `{ id: p.id, prediction: p.predictionText, createdAt: p.createdAt.toISOString() }`. Otherwise, empty array.
   - `activeInterests`: If `deps.interestRegistry` exists, call `deps.interestRegistry.listInterests(deps.owner, { status: 'active' })` → map to `{ label: i.name, engagementScore: i.engagementScore }`. (Note: decay rate is a config-level value from `InterestRegistryConfig.engagementHalfLifeDays`, not per-interest. Only the engagement score is meaningful for restoration.) Otherwise, empty array.
   - `recallCache`: If `deps.recallContextState` exists, call `deps.recallContextState.getResult()` (added in Task 1b). If the result is present, map to `{ decomposition: { queries: [...], entities: [...] }, fragmentCount: result.fragments.length }`. Otherwise, `null`.

2. Build `AgentCheckpointState` from collected data + `agentState`

3. Call `serializeCheckpoint(deps.conversationId, deps.owner, trigger, state)`

4. Call `deps.checkpointStore.save(checkpoint)` inside a transaction with `deps.checkpointStore.prune(deps.conversationId, deps.retentionCount)`

   Since `CheckpointStore` methods use the underlying query function, and we want save+prune atomicity, the `performCheckpoint` function should accept the `PersistenceProvider.withTransaction` to wrap both calls. Alternatively, since `createCheckpointStore` already has access to `withTransaction`, add a `saveAndPrune(checkpoint, retainCount)` method to `CheckpointStore` that runs both in a single transaction.

   Simpler approach: Add `saveAndPrune(checkpoint: SessionCheckpoint, conversationId: string, retainCount: number): Promise<number>` to `CheckpointStore` (modifying Phase 2's store). This method calls save then prune within `withTransaction`. Returns the prune count.

5. Wrap the entire operation in try/catch. On error, log a warning: `console.warn('[checkpoint] failed to create ${trigger} checkpoint:', error.message)`. Return `null`.

6. On success, return `checkpoint.id`.

**Modification to Phase 2:** Add `saveAndPrune` method to `CheckpointStore` type and implementation. This is a convenience method that wraps `save` + `prune` in a single transaction.

**Testing:**

Create `src/agent/checkpoint-create.test.ts` with unit tests using manual stubs:

1. **Successful checkpoint creation:** Stub all dependencies with in-memory implementations. Call `performCheckpoint('explicit', agentState, deps)`. Assert it returns a UUID string. Assert `checkpointStore.save` was called with a valid checkpoint. Assert `checkpointStore.prune` was called.

2. **Failure tolerance (AC1.6):** Stub `checkpointStore.save` to throw an Error. Call `performCheckpoint()`. Assert it returns `null` (not thrown). Assert a warning was logged (use a spy or verify via captured console output).

3. **Empty subsystem state:** Stub memory to return empty blocks, no prediction store, no interest registry, no recall state. Call `performCheckpoint()`. Assert checkpoint has empty arrays for all collections and `null` recallCache.

4. **Full subsystem state:** Stub all dependencies with populated data. Assert the checkpoint correctly maps working memory labels/content, prediction IDs/text/dates, and interest labels/engagement scores.

Stub pattern: Plain objects implementing the required interface methods. Same approach as `src/compaction/compactor.test.ts`.

**Verification:**
Run: `bun test src/agent/checkpoint-create.test.ts`
Expected: All tests pass

**Commit:** `feat(checkpoint): implement checkpoint creation helper with failure tolerance`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Checkpoint tool

**Verifies:** session-checkpointing.AC1.1

**Files:**
- Create: `src/tool/checkpoint-tool.ts`

**Implementation:**

Create `src/tool/checkpoint-tool.ts` with pattern annotation `// pattern: Imperative Shell`.

Export `createCheckpointTool(deps: CheckpointDependencies, getAgentState: () => CheckpointAgentState): Tool`:

The tool definition:
- `name`: `'checkpoint'`
- `description`: `'Create a snapshot of the current agent state. Captures conversation history, working memory, predictions, interests, and compaction metadata. Returns the checkpoint ID.'`
- `input_schema`: `{ type: 'object', properties: {}, required: [] }` (no parameters)
- `handler`: Calls `performCheckpoint('explicit', getAgentState(), deps)`. On success, returns `'Checkpoint created: ${id}'`. On null (failure), returns `'Checkpoint creation failed. Check logs for details.'`

The tool is registered like other built-in tools — the composition root in `src/index.ts` creates it and adds it to the registry.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): add /checkpoint tool definition`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Pre-compaction trigger

**Verifies:** session-checkpointing.AC1.2

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

In `src/agent/agent.ts`, find the two locations where compaction is triggered:

1. The automatic compression check (around line 126):
   ```typescript
   if (deps.compactor && shouldCompress(history, deps.config.context_budget, modelMaxTokens, overheadTokens)) {
     const result = await deps.compactor.compress(history, id);
   ```

2. The `compact_context` tool call handler (around line 270):
   ```typescript
   if (deps.compactor) {
     const compactionResult = await deps.compactor.compress(history, id);
   ```

Before each `compress()` call, insert a checkpoint creation call:

```typescript
if (deps.checkpointDeps) {
  await performCheckpoint('pre_compaction', deps.checkpointDeps.getAgentState(), deps.checkpointDeps.deps);
}
```

Add `checkpointDeps?: { getAgentState: () => CheckpointAgentState; deps: CheckpointDependencies }` to `AgentDependencies`.

This keeps the checkpoint logic out of the agent's core responsibility — it's an optional dependency that fires when present.

**Verification:**
Run: `bun run build && bun test`
Expected: Type-check passes. All existing tests still pass (checkpointDeps is optional).

**Commit:** `feat(checkpoint): add pre-compaction checkpoint trigger`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Turn-interval trigger

**Verifies:** session-checkpointing.AC1.4, AC1.5

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

In the agent loop within `processMessage`, track the current turn number. After a complete turn (user message processed, assistant response generated), check if interval checkpointing is configured:

```typescript
if (
  deps.checkpointDeps &&
  deps.config.checkpoint_interval > 0 &&
  turnNumber % deps.config.checkpoint_interval === 0
) {
  await performCheckpoint('interval', deps.checkpointDeps.getAgentState(), deps.checkpointDeps.deps);
}
```

The turn counter should be maintained as local state within the agent closure (incremented each time `processMessage` completes). It's also part of the `CheckpointAgentState` that `getAgentState()` returns.

When `checkpoint_interval` is `0`, the condition short-circuits and no interval checkpoint is created (AC1.5).

**Verification:**
Run: `bun run build && bun test`
Expected: Type-check passes. Existing tests pass.

**Commit:** `feat(checkpoint): add turn-interval checkpoint trigger`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Shutdown trigger

**Verifies:** session-checkpointing.AC1.3

**Files:**
- Modify: `src/index.ts`

**Implementation:**

In `src/index.ts`, modify `createShutdownHandler` to accept optional checkpoint creation parameters:

```typescript
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  dataSourceRegistry?: DataSourceRegistry,
  scheduler?: SchedulerWrapper,
  activityManager?: ActivityManager,
  mcpClients?: Array<McpClient>,
  checkpointFn?: () => Promise<void>,  // NEW
)
```

In the handler function body, before the existing cleanup steps (stop scheduler, shutdown data sources, etc.), call:

```typescript
if (checkpointFn) {
  try {
    await checkpointFn();
  } catch (err) {
    console.warn('[checkpoint] shutdown checkpoint failed:', (err as Error).message);
  }
}
```

The `checkpointFn` is a closure created in the composition root that calls `performCheckpoint('shutdown', ...)`. This keeps the shutdown handler generic.

At the composition root where `createShutdownHandler` is called (around line 1378), construct the checkpoint closure if a `CheckpointStore` is available:

```typescript
const shutdownCheckpointFn = checkpointStore
  ? async () => {
      await performCheckpoint('shutdown', getAgentState(), checkpointDeps);
    }
  : undefined;

const shutdownHandler = createShutdownHandler(
  rl, persistence, dataSourceRegistry, schedulerWrapper,
  activityManager, mcpClients, shutdownCheckpointFn,
);
```

**Design note:** The shutdown handler has limited time before SIGKILL. The checkpoint write is a single INSERT + DELETE query — it should complete within a few hundred milliseconds. The try/catch ensures a DB failure doesn't prevent the rest of the cleanup sequence.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): add shutdown checkpoint trigger`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Composition root wiring

**Verifies:** session-checkpointing.AC1.1 (tool registration)

**Files:**
- Modify: `src/index.ts`

**Implementation:**

In the composition root section of `src/index.ts` (where tools are registered, around lines 550-689):

1. Create the `CheckpointStore`:
   ```typescript
   const checkpointStore = createCheckpointStore(persistence.query, persistence.withTransaction);
   ```

2. Build `CheckpointDependencies`:
   ```typescript
   const checkpointDeps: CheckpointDependencies = {
     checkpointStore,
     memory: memoryManager,
     predictionStore: predictionStore,
     interestRegistry: interestRegistry,
     recallContextState: recallContextState,
     owner: config.agent.owner ?? 'default',
     conversationId: agent.conversationId,
     retentionCount: config.agent.checkpoint_retention,
   };
   ```

   Note: `checkpointDeps` depends on `agent.conversationId`, which is only available after `createAgent()`. Wire this after agent creation.

3. Create and register the checkpoint tool:
   ```typescript
   const checkpointTool = createCheckpointTool(checkpointDeps, getAgentState);
   registry.register(checkpointTool);
   ```

4. Pass `checkpointDeps` to `createAgent` via the new `AgentDependencies.checkpointDeps` field.

5. Wire the shutdown checkpoint function as described in Task 6.

The `getAgentState` callback is a function that reads the agent's current turn number, tool round, message IDs, and compaction metadata. This requires exposing these values from the agent — either via the existing `Agent` interface or via a shared mutable ref.

Simplest approach: Create a `CheckpointAgentState` ref object that the agent updates each turn, and the checkpoint system reads:

```typescript
const agentStateRef: { current: CheckpointAgentState } = {
  current: { turnNumber: 0, toolRound: 0, messageIds: [], compactionMetadata: { lastCompactedIndex: -1, summaryCount: 0 } },
};
```

The agent updates `agentStateRef.current` at the end of each turn. The `getAgentState` callback returns `agentStateRef.current`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes. Application starts without errors.

**Commit:** `feat(checkpoint): wire checkpoint creation into composition root`
<!-- END_TASK_7 -->
