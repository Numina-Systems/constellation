# Session Checkpointing Implementation Plan — Phase 4

**Goal:** Implement checkpoint restoration on startup, reconstructing full agent state from a serialized checkpoint.

**Architecture:** Imperative Shell restoration function that reads a checkpoint from the store and replays state into the agent's subsystems. Integrated into the composition root startup sequence, before the agent loop begins. CLI flag (`--resume`) and config-driven resume (`resume_checkpoint`, `auto_resume`) provide entry points.

**Tech Stack:** Bun (TypeScript), PostgreSQL

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC3: Restoration Fidelity
- **session-checkpointing.AC3.1 Success:** Restored agent sees the same conversation history as when checkpointed
- **session-checkpointing.AC3.2 Success:** Restored agent's working memory matches the checkpoint state (not the current DB state if it diverged)
- **session-checkpointing.AC3.3 Success:** Restored agent's pending predictions are present and reviewable
- **session-checkpointing.AC3.4 Success:** Restored agent's active interests resume with their checkpointed decay values
- **session-checkpointing.AC3.5 Success:** Compaction metadata is restored so the next compaction check uses the correct baseline
- **session-checkpointing.AC3.6 Failure:** Restoring a checkpoint for a conversation that has been deleted fails with a clear error (not a silent empty state)
- **session-checkpointing.AC3.7 Edge:** Restoring the same checkpoint twice produces identical state each time (idempotent)

### session-checkpointing.AC6: Resume Startup
- **session-checkpointing.AC6.1 Success:** `--resume <checkpoint_id>` CLI flag loads the specified checkpoint on startup
- **session-checkpointing.AC6.2 Success:** `resume_checkpoint` config option provides the same functionality via config.toml
- **session-checkpointing.AC6.3 Success:** If no checkpoint ID is provided but `auto_resume` is true, the most recent checkpoint for the configured owner is loaded
- **session-checkpointing.AC6.4 Failure:** Invalid or missing checkpoint ID produces a clear startup error and the daemon does not start

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Restoration function

**Verifies:** session-checkpointing.AC3.1, session-checkpointing.AC3.2, session-checkpointing.AC3.3, session-checkpointing.AC3.4, session-checkpointing.AC3.5, session-checkpointing.AC3.6, session-checkpointing.AC3.7

**Files:**
- Create: `src/agent/checkpoint-restore.ts`

**Implementation:**

Create `src/agent/checkpoint-restore.ts` with pattern annotation `// pattern: Imperative Shell`.

Import types from agent, persistence, memory, reflexion, subconscious, and recall modules.

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
  readonly compactionMeta: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
  readonly messageCount: number;
};
```

Export `async function restoreFromCheckpoint(checkpoint: SessionCheckpoint, deps: RestorationDependencies): Promise<RestorationResult>`:

1. **Verify conversation exists (AC3.6):** Query the messages table:
   ```sql
   SELECT COUNT(*)::int as count FROM messages WHERE conversation_id = $1
   ```
   If count is 0 AND `checkpoint.messageIds.length > 0`, throw: `"cannot restore checkpoint ${checkpoint.id}: conversation ${checkpoint.conversationId} has no messages (deleted or missing)"`. If the checkpoint itself had no messages (fresh conversation), this is fine.

2. **Verify message coverage (AC3.1):** The checkpoint stores `messageIds`. Query existing message IDs:
   ```sql
   SELECT id FROM messages WHERE conversation_id = $1
   ```
   Compare against checkpoint's `messageIds`. If some are missing, log a warning (messages may have been pruned by compaction). The conversation history is loaded by `conversationId` on agent creation — `messageIds` serve as a verification checksum, not a data source.

3. **Restore working memory (AC3.2):** Working memory may have diverged from the checkpoint:
   - Get current working blocks: `deps.memory.list('working')`
   - For each checkpoint block (`checkpoint.workingMemory`):
     - Find matching current block by label
     - If exists and content differs: `deps.memory.write(block.label, block.content, 'working')`
     - If doesn't exist: `deps.memory.write(block.label, block.content, 'working')`
   - For current blocks NOT in checkpoint (created after checkpoint): `deps.memory.deleteBlock(block.id)`

   Note: `MemoryManager.write()` enforces permission checks. Working memory blocks use `readwrite` permission (see `src/memory/types.ts:10`), so writes should succeed. If any block uses `familiar` permission (requires human approval), the write will queue a mutation instead of applying immediately — log a warning if this happens.

4. **Verify pending predictions (AC3.3):** Predictions are persisted in the database and don't need re-creation:
   - If `deps.predictionStore` exists, call `deps.predictionStore.listPredictions(deps.owner, 'pending')`
   - Compare against `checkpoint.pendingPredictions` by ID
   - Log any discrepancies (predictions evaluated or expired since checkpoint)
   - No re-creation — the DB is the source of truth for prediction lifecycle

5. **Restore active interests (AC3.4):** Interest engagement scores may have decayed since checkpoint:
   - If `deps.interestRegistry` exists, call `deps.interestRegistry.listInterests(deps.owner)`
   - For each checkpoint interest, find matching DB interest by `id`
   - If found and `engagementScore` differs: `deps.interestRegistry.updateInterest(id, { engagementScore: interest.engagementScore })`
   - Log any interests in checkpoint that no longer exist in DB

6. **Compaction metadata (AC3.5):** Return `checkpoint.compactionMeta` in the `RestorationResult`. The composition root uses this to set the agent's initial compaction baseline. The compactor doesn't expose a "set baseline" API — the agent tracks this via message array indexing internally.

7. **Clear recall cache:** If `deps.recallContextState` exists, call `deps.recallContextState.setResult(null)`. The cache is a performance optimization — it will be rebuilt on the next turn via the recall pipeline. Attempting to reconstruct a full `RecallResult` from the checkpoint's summary data would be lossy.

8. Return `RestorationResult`.

**Idempotency (AC3.7):** Running `restoreFromCheckpoint` twice with the same checkpoint produces identical state:
- Working memory: idempotent upsert + delete (same labels → same content)
- Interest scores: set to checkpoint values (same scores each time)
- Recall cache: cleared (idempotent)
- Returned metadata: derived from checkpoint (deterministic)

Export `RestorationDependencies`, `RestorationResult`, and `restoreFromCheckpoint`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): implement checkpoint restoration function`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Restoration integration tests

**Verifies:** session-checkpointing.AC3.1, session-checkpointing.AC3.2, session-checkpointing.AC3.3, session-checkpointing.AC3.4, session-checkpointing.AC3.5, session-checkpointing.AC3.6, session-checkpointing.AC3.7

**Files:**
- Create: `src/agent/checkpoint-restore.test.ts`

**Testing:**

Integration tests against a real PostgreSQL database. Follow setup pattern from `src/persistence/checkpoint-store.test.ts` and `src/skill/postgres-store.test.ts`.

Setup: Connect to test database, run migrations. Before each test, truncate relevant tables (`session_checkpoints`, working memory blocks, predictions, interests). Use `serializeCheckpoint()` to create test checkpoints.

Tests:

- **Full restoration (AC3.1, AC3.2, AC3.4, AC3.5):** Seed DB with messages, working memory blocks, and interests. Create checkpoint capturing this state. Modify DB state (add a memory block, change an engagement score). Call `restoreFromCheckpoint()`. Verify working memory matches checkpoint (new block removed, originals restored). Verify interest engagement score restored. Verify returned `compactionMeta` matches checkpoint.

- **Deleted conversation fails (AC3.6):** Create checkpoint referencing a conversation with messages. Delete all messages. Call `restoreFromCheckpoint()`. Assert throws error containing "no messages".

- **Idempotent (AC3.7):** Seed DB. Create checkpoint. Call `restoreFromCheckpoint()` twice. After both calls, verify working memory, interests, and returned metadata are identical.

- **Empty checkpoint restores cleanly:** Create checkpoint with empty arrays. Seed DB with working memory blocks. Call `restoreFromCheckpoint()`. Assert all working memory blocks deleted.

- **Missing predictions logged but not fatal (AC3.3):** Create checkpoint with a pending prediction. Delete the prediction from DB. Call `restoreFromCheckpoint()`. Assert no exception. Function completes.

- **Missing interests logged but not fatal (AC3.4):** Create checkpoint with an active interest. Delete the interest from DB. Call `restoreFromCheckpoint()`. Assert no exception.

**Verification:**
Run: `bun test src/agent/checkpoint-restore.test.ts`
Expected: All tests pass (requires PostgreSQL)

**Commit:** `test(agent): add checkpoint restoration integration tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: CLI resume flag

**Verifies:** session-checkpointing.AC6.1, session-checkpointing.AC6.4

**Files:**
- Modify: `src/index.ts`

**Implementation:**

In `src/index.ts`, add a simple CLI argument parser before the composition root runs. No framework needed for a single flag:

```typescript
function parseResumeFlag(): string | undefined {
  const idx = process.argv.indexOf('--resume');
  if (idx === -1) return undefined;
  if (idx + 1 >= process.argv.length || process.argv[idx + 1]!.startsWith('--')) {
    console.error('error: --resume requires a checkpoint ID');
    process.exit(1);
  }
  return process.argv[idx + 1];
}
```

Call early in the startup sequence, before config loading:
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

**Verifies:** session-checkpointing.AC6.1, session-checkpointing.AC6.2, session-checkpointing.AC6.3, session-checkpointing.AC6.4

**Files:**
- Modify: `src/index.ts`

**Implementation:**

After `CheckpointStore` is created and config is loaded, but before `createAgent()` is called, add the resume logic:

```typescript
const resumeId = resumeCheckpointId ?? config.agent.resume_checkpoint;

let restoredState: RestorationResult | null = null;
let resumeConversationId: string | undefined;

if (resumeId) {
  const checkpoint = await checkpointStore.load(resumeId);
  if (!checkpoint) {
    console.error(`error: checkpoint ${resumeId} not found`);
    process.exit(1);
  }
  console.log(`resuming from checkpoint ${resumeId} (conversation: ${checkpoint.conversationId})`);
  restoredState = await restoreFromCheckpoint(checkpoint, restorationDeps);
  resumeConversationId = checkpoint.conversationId;
} else if (config.agent.auto_resume) {
  const checkpoint = await checkpointStore.loadLatest(AGENT_OWNER);
  if (checkpoint) {
    console.log(`auto-resuming from checkpoint ${checkpoint.id} (conversation: ${checkpoint.conversationId})`);
    restoredState = await restoreFromCheckpoint(checkpoint, restorationDeps);
    resumeConversationId = checkpoint.conversationId;
  } else {
    console.log('auto-resume enabled but no checkpoint found — starting fresh');
  }
}

const mainConversationId = resumeConversationId ?? crypto.randomUUID();
```

Pass `mainConversationId` to `createAgent(deps, mainConversationId)` — this is existing behaviour, the agent loads history from DB when given an existing conversation ID.

After agent creation, initialize state from restoration:
```typescript
if (restoredState) {
  agentStateRef.current = {
    turnNumber: restoredState.turnNumber,
    toolRound: restoredState.toolRound,
    messageIds: [],
    compactionMeta: restoredState.compactionMeta,
  };
  console.log(`restored: ${restoredState.messageCount} messages, turn ${restoredState.turnNumber}`);
}
```

**Error handling (AC6.4):**
- `--resume <id>` with missing checkpoint: `process.exit(1)` with error
- `resume_checkpoint` config with missing checkpoint: `process.exit(1)` with error
- `auto_resume` with no checkpoints: log and start fresh
- Restoration failure (deleted conversation): error propagates, `process.exit(1)`

**Verification:**
Run: `bun run build`
Expected: Type-check passes. Application starts without `--resume` flag (no regression).

**Commit:** `feat(checkpoint): wire resume startup with CLI flag and auto_resume`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Barrel exports and final build verification

**Verifies:** None (infrastructure + final validation)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add exports for Phase 3 and Phase 4 modules to `src/agent/index.ts`:

```typescript
export type { RestorationDependencies, RestorationResult } from './checkpoint-restore.ts';
export { restoreFromCheckpoint } from './checkpoint-restore.ts';
export type { CheckpointDependencies, CheckpointAgentState } from './checkpoint-create.ts';
export { performCheckpoint } from './checkpoint-create.ts';
```

**Verification:**
Run: `bun run build && bun test`
Expected: Full type-check passes. All tests pass (unit and integration, excluding pre-existing PostgreSQL connection failures).

**Commit:** `feat(agent): export checkpoint restoration and creation from barrel`

<!-- END_TASK_5 -->
