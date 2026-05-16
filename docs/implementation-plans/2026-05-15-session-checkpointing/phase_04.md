# Session Checkpointing Implementation Plan

**Goal:** Implement checkpoint restoration on startup, reconstructing full agent state from a serialized checkpoint.

**Architecture:** Imperative Shell restoration function that reads a checkpoint from the store and replays state into the agent's subsystems. Integrated into the composition root startup sequence, before the agent loop begins. CLI flag and config-driven resume provide two entry points.

**Tech Stack:** Bun, TypeScript 5.7+, PostgreSQL, Zod

**Scope:** Phase 4 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC3: Restoration Fidelity
- **session-checkpointing.AC3.1 Success:** Restored agent sees the same conversation history as when checkpointed
- **session-checkpointing.AC3.2 Success:** Restored agent's working memory matches the checkpoint state (not the current DB state if it diverged)
- **session-checkpointing.AC3.3 Success:** Restored agent's pending predictions are present and reviewable
- **session-checkpointing.AC3.4 Success:** Restored agent's active interests resume with their checkpointed engagement scores
- **session-checkpointing.AC3.5 Success:** Compaction metadata is restored so the next compaction check uses the correct baseline
- **session-checkpointing.AC3.6 Failure:** Restoring a checkpoint for a conversation that has been deleted fails with a clear error (not a silent empty state)
- **session-checkpointing.AC3.7 Edge:** Restoring the same checkpoint twice produces identical state each time (idempotent)

### session-checkpointing.AC6: Resume Startup
- **session-checkpointing.AC6.1 Success:** `--resume <checkpoint_id>` CLI flag loads the specified checkpoint on startup
- **session-checkpointing.AC6.2 Success:** `resume_checkpoint` config option provides the same functionality via config.toml
- **session-checkpointing.AC6.3 Success:** If no checkpoint ID is provided but `auto_resume` is true, the most recent checkpoint for the configured owner is loaded
- **session-checkpointing.AC6.4 Failure:** Invalid or missing checkpoint ID produces a clear startup error and the daemon does not start

---

<!-- START_TASK_1 -->
### Task 1: Restoration function

**Verifies:** session-checkpointing.AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7

**Files:**
- Create: `src/agent/checkpoint-restore.ts`

**Implementation:**

Create `src/agent/checkpoint-restore.ts` with pattern annotation `// pattern: Imperative Shell`.

Define `RestorationDependencies`:

```typescript
type RestorationDependencies = {
  readonly persistence: PersistenceProvider;
  readonly memory: MemoryManager;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
  readonly owner: string;
};
```

Define `RestorationResult`:

```typescript
type RestorationResult = {
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly compactionMetadata: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
  readonly messageCount: number;
};
```

Export `async function restoreFromCheckpoint(checkpoint: SessionCheckpoint, deps: RestorationDependencies): Promise<RestorationResult>`:

1. **Verify conversation exists (AC3.6):** Query the messages table for the checkpoint's `conversationId`:
   ```sql
   SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1
   ```
   If count is `0`, throw an Error: `Cannot restore checkpoint ${checkpoint.id}: conversation ${checkpoint.conversationId} has no messages (deleted or missing)`.

2. **Verify message coverage (AC3.1):** The checkpoint stores `messageIds`. Verify that the messages exist in the database:
   ```sql
   SELECT id FROM messages WHERE conversation_id = $1 AND id = ANY($2)
   ```
   If the count of returned IDs does not match `checkpoint.messageIds.length`, log a warning about missing messages but continue (messages may have been pruned by compaction — this is expected). The conversation history is loaded from the DB by `conversationId`, not by individual message IDs. The `messageIds` in the checkpoint serve as a verification checksum, not a restoration source.

3. **Restore working memory (AC3.2):** The checkpoint's working memory may differ from what's currently in the database (if the DB state diverged after the checkpoint was taken). To restore:
   - Get current working memory blocks: `deps.memory.getWorkingBlocks()` (owner is baked in at `MemoryManager` construction — no owner parameter needed)
   - For each checkpoint block, check if a block with that label exists:
     - If it exists and content differs, update it via `deps.memory.write(block.label, block.content, 'working')`
     - If it doesn't exist, create it via `deps.memory.write(block.label, block.content, 'working')`
   - For current DB blocks that are NOT in the checkpoint, delete them via `deps.memory.deleteBlock(blockId)` (they were created after the checkpoint and should be removed to match checkpoint state)

   **Note:** `MemoryManager.write()` goes through the mutation permission enforcement flow. For restoration of known-good checkpoint state, use the lower-level `MemoryStore` directly (via `deps.persistence.query()` or a dedicated store method) to bypass the mutation approval flow. This prevents the agent's memory permission system from rejecting legitimate restoration writes.

   This ensures the working memory exactly matches the checkpoint state (AC3.2).

4. **Restore pending predictions (AC3.3):** The checkpoint stores prediction snapshots (`id`, `prediction`, `createdAt`). Since predictions are persisted in the database, we verify they still exist rather than re-creating them:
   - If `deps.predictionStore` is present, call `deps.predictionStore.listPredictions(deps.owner, 'pending')`
   - Log the count of pending predictions found. If checkpoint has predictions that no longer exist in DB (evaluated or expired since checkpoint), log a warning. This is informational — we don't re-create predictions.

   Rationale: Predictions have evaluation state and FK constraints. Re-creating them would duplicate data. The checkpoint records what was pending at snapshot time. On restore, the DB is the source of truth for prediction existence — we just verify and log discrepancies.

5. **Restore active interests (AC3.4):** Similar to predictions, interests are persisted:
   - If `deps.interestRegistry` is present, call `deps.interestRegistry.listInterests(deps.owner, { status: 'active' })`
   - For each interest in the checkpoint, find the matching DB interest by label (name). If found and the engagement score differs from the checkpoint value, update it via `deps.interestRegistry.updateInterest(id, { engagementScore: interest.engagementScore })`
   - This restores the engagement scores to their checkpointed state (AC3.4)

6. **Restore compaction metadata (AC3.5):** Return `compactionMetadata` from the checkpoint in the `RestorationResult`. The caller (composition root) uses this to initialize the agent's compaction baseline. The compaction module doesn't have a "set baseline" API — the agent tracks this internally via message array indexing. Returning it in the result lets the composition root set the initial state.

7. **Warm recall cache (AC3.6 content):** If `deps.recallContextState` is present and `checkpoint.recallCache` is not null:
   - The recall cache stores a `RecallResult`. We can't fully reconstruct a `RecallResult` from the checkpoint's summary (which only has `decomposition` and `fragmentCount`). Instead, clear the cache by calling `deps.recallContextState.setResult(null)`. The next turn will re-run recall naturally.
   - This is acceptable because recall is cheap (runs once per turn) and the cache is a performance optimization, not critical state.

8. Return `RestorationResult` with `conversationId`, `turnNumber`, `toolRound`, `compactionMetadata`, and `messageCount` (from the verification query).

**Idempotency (AC3.7):** Running `restoreFromCheckpoint` twice with the same checkpoint produces the same state because:
- Working memory is set to match checkpoint (idempotent upsert + delete)
- Interest scores are set to checkpoint values (idempotent update)
- Recall cache is cleared (idempotent)
- Returned metadata is derived from checkpoint (deterministic)

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): implement checkpoint restoration function`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Restoration integration tests

**Verifies:** session-checkpointing.AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7

**Files:**
- Test: `src/agent/checkpoint-restore.test.ts` (integration)

**Implementation:**

Create `src/agent/checkpoint-restore.test.ts` with integration tests against a real PostgreSQL database. These tests require a populated database with messages, memory blocks, predictions, and interests.

Setup: Connect to test database, run migrations, seed test data before each test, clean up after.

Test cases:

1. **Full restoration round-trip (AC3.1, AC3.2, AC3.3, AC3.4, AC3.5):**
   - Seed: Create a conversation with 5 messages, 2 working memory blocks, 1 pending prediction, 1 active interest
   - Create a checkpoint via `serializeCheckpoint()` with matching state
   - Save the checkpoint via `CheckpointStore.save()`
   - Modify the DB state: add a new working memory block, change an interest's engagement score
   - Call `restoreFromCheckpoint(checkpoint, deps)`
   - Assert: working memory matches checkpoint (new block removed, original blocks intact)
   - Assert: interest engagement score matches checkpoint value
   - Assert: `RestorationResult.compactionMetadata` matches checkpoint
   - Assert: `RestorationResult.messageCount` equals 5

2. **Deleted conversation fails (AC3.6):**
   - Create a checkpoint referencing a conversation ID
   - Delete all messages for that conversation
   - Call `restoreFromCheckpoint(checkpoint, deps)`
   - Assert: throws Error with message containing "no messages"

3. **Idempotent restoration (AC3.7):**
   - Seed DB with known state
   - Create and save checkpoint
   - Call `restoreFromCheckpoint()` twice
   - After both calls, assert working memory, interests, and returned metadata are identical

4. **Empty checkpoint restores cleanly:**
   - Create checkpoint with empty arrays for all collections
   - Seed DB with some working memory blocks
   - Call `restoreFromCheckpoint()`
   - Assert: all working memory blocks deleted (checkpoint had none)
   - Assert: result has zero-value compaction metadata

5. **Missing predictions logged but not fatal:**
   - Create checkpoint with a pending prediction
   - Delete the prediction from DB (simulate evaluation that happened after checkpoint)
   - Call `restoreFromCheckpoint()`
   - Assert: does not throw. Function completes successfully.

Stub approach: Use real `PersistenceProvider`, real `MemoryManager` (with `createPostgresMemoryStore`), real `PredictionStore`, real `InterestRegistry`. These are integration tests.

**Verification:**
Run: `bun test src/agent/checkpoint-restore.test.ts`
Expected: All tests pass (requires running PostgreSQL with migrations)

**Commit:** `test(checkpoint): add checkpoint restoration integration tests`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: CLI resume flag

**Verifies:** session-checkpointing.AC6.1, AC6.4

**Files:**
- Modify: `src/index.ts`

**Implementation:**

In `src/index.ts`, parse CLI arguments before the composition root runs. Use `process.argv` directly (no need for a CLI framework for a single flag):

```typescript
function parseResumeFlag(): string | undefined {
  const idx = process.argv.indexOf('--resume');
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    console.error('Error: --resume requires a checkpoint ID');
    process.exit(1);
  }
  return value;
}
```

Call this early in the startup sequence:

```typescript
const resumeCheckpointId = parseResumeFlag();
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): add --resume CLI flag parsing`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Resume startup integration

**Verifies:** session-checkpointing.AC6.1, AC6.2, AC6.3, AC6.4

**Files:**
- Modify: `src/index.ts`

**Implementation:**

After the `CheckpointStore` is created and config is loaded, but before `createAgent()` is called, add the resume logic:

```typescript
// Determine checkpoint to restore (CLI flag > config > auto_resume)
const resumeId = resumeCheckpointId ?? config.agent.resume_checkpoint;

let restoredState: RestorationResult | null = null;
let resumeConversationId: string | undefined;

if (resumeId) {
  // Explicit checkpoint ID — load it or fail
  const checkpoint = await checkpointStore.load(resumeId);
  if (!checkpoint) {
    console.error(`Error: checkpoint ${resumeId} not found`);
    process.exit(1);
  }
  console.log(`Resuming from checkpoint ${resumeId} (conversation: ${checkpoint.conversationId})`);
  restoredState = await restoreFromCheckpoint(checkpoint, restorationDeps);
  resumeConversationId = checkpoint.conversationId;
} else if (config.agent.auto_resume) {
  // Auto-resume: load most recent checkpoint for owner
  const owner = config.agent.owner ?? 'default';
  const checkpoint = await checkpointStore.loadLatest(owner);
  if (checkpoint) {
    console.log(`Auto-resuming from checkpoint ${checkpoint.id} (conversation: ${checkpoint.conversationId})`);
    restoredState = await restoreFromCheckpoint(checkpoint, restorationDeps);
    resumeConversationId = checkpoint.conversationId;
  } else {
    console.log('Auto-resume enabled but no checkpoint found — starting fresh');
  }
}

// Create agent with restored conversation ID if resuming
const agent = createAgent(deps, resumeConversationId);
```

If `resumeConversationId` is provided to `createAgent()`, it resumes that conversation (this is existing behaviour — `createAgent` already accepts an optional `conversationId`).

After agent creation, if `restoredState` is present, initialize the agent state ref with restored values:

```typescript
if (restoredState) {
  agentStateRef.current = {
    turnNumber: restoredState.turnNumber,
    toolRound: restoredState.toolRound,
    messageIds: [], // Will be populated on next history load
    compactionMetadata: restoredState.compactionMetadata,
  };
  console.log(`Restored: ${restoredState.messageCount} messages, turn ${restoredState.turnNumber}`);
}
```

**Error handling (AC6.4):**
- Explicit `--resume <id>` with invalid/missing ID: `process.exit(1)` with clear error message
- `resume_checkpoint` config with invalid ID: same
- `auto_resume` with no checkpoints: log and continue (start fresh)
- Restoration failure (e.g., deleted conversation): error propagates, prints stack trace, `process.exit(1)`

**Verification:**
Run: `bun run build`
Expected: Type-check passes. Application starts without `--resume` flag (no regression).

Test manually:
1. Start the daemon, have a conversation, trigger `/checkpoint`
2. Stop the daemon
3. Start with `bun run start -- --resume <checkpoint_id>`
4. Verify the conversation resumes with correct state

**Commit:** `feat(checkpoint): wire resume startup with CLI flag and auto_resume`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Barrel exports and final build verification

**Verifies:** None (infrastructure + final validation)

**Files:**
- Modify: `src/agent/index.ts` (ensure restoration exports are present)

**Implementation:**

Add to `src/agent/index.ts`:

```typescript
export type { RestorationDependencies, RestorationResult } from './checkpoint-restore.js';
export { restoreFromCheckpoint } from './checkpoint-restore.js';
export type { CheckpointDependencies, CheckpointAgentState } from './checkpoint-create.js';
export { performCheckpoint } from './checkpoint-create.js';
```

**Verification:**
Run: `bun run build && bun test`
Expected: Full type-check passes. All tests pass (unit and integration).

**Commit:** `feat(checkpoint): complete session checkpointing feature`
<!-- END_TASK_5 -->
