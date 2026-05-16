# Architectural Hardening Implementation Plan

**Goal:** Restructure `restoreFromCheckpoint()` into the three-tier Atomic Handoff pattern with transaction wrapping and pre-flight validation

**Architecture:** Tier 0 performs pure validation (label/block constraints). Tier 1 wraps all DB operations (message verification, prediction verification, interest restoration) in `withTransaction`. Tier 2 performs memory writes last inside the transaction, with best-effort cleanup on failure before rethrowing to trigger DB rollback.

**Tech Stack:** Bun (TypeScript), PostgreSQL 17

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC1: Checkpoint restore is fully atomic
- **arch-hardening.AC1.1 Success:** Full restore completes — predictions, interests, and memory all reflect checkpoint state
- **arch-hardening.AC1.2 Failure:** Pre-flight rejects invalid label — no DB or memory state modified
- **arch-hardening.AC1.3 Failure:** Pre-flight rejects oversized block — no DB or memory state modified
- **arch-hardening.AC1.4 Failure:** Pre-flight rejects block count exceeding limit — no DB or memory state modified
- **arch-hardening.AC1.5 Failure:** DB write fails mid-Tier-1 — all Tier 1 writes rolled back, memory untouched
- **arch-hardening.AC1.6 Failure:** Memory write fails in Tier 2 — DB rolled back, memory best-effort cleared to blank state

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->
<!-- START_TASK_1 -->
### Task 1: Add pre-flight validation function

**Verifies:** arch-hardening.AC1.2, arch-hardening.AC1.3, arch-hardening.AC1.4

**Files:**
- Modify: `src/agent/checkpoint-restore.ts` (add new function before `restoreFromCheckpoint`)

**Implementation:**

Add a pure validation function that checks MemoryManager constraints before any state is modified. This is Tier 0 of the Atomic Handoff pattern.

```typescript
type PreflightResult =
  | { valid: true }
  | { valid: false; reason: string };

const MAX_WORKING_BLOCKS = 20;
const MAX_BLOCK_CONTENT_LENGTH = 10000;
const LABEL_PATTERN = /^[a-z][a-z0-9_-]*$/;

function validateMemoryConstraints(
  workingMemory: ReadonlyArray<{ readonly label: string; readonly content: string }>,
): PreflightResult {
  if (workingMemory.length > MAX_WORKING_BLOCKS) {
    return {
      valid: false,
      reason: `working memory block count ${workingMemory.length} exceeds limit of ${MAX_WORKING_BLOCKS}`,
    };
  }

  for (const block of workingMemory) {
    if (!LABEL_PATTERN.test(block.label)) {
      return {
        valid: false,
        reason: `invalid memory block label "${block.label}": must match pattern ${LABEL_PATTERN.source}`,
      };
    }
    if (block.content.length > MAX_BLOCK_CONTENT_LENGTH) {
      return {
        valid: false,
        reason: `memory block "${block.label}" content length ${block.content.length} exceeds limit of ${MAX_BLOCK_CONTENT_LENGTH}`,
      };
    }
  }

  return { valid: true };
}
```

**IMPORTANT — Constraint discovery required at implementation time:**

The constants `MAX_WORKING_BLOCKS = 20`, `MAX_BLOCK_CONTENT_LENGTH = 10000`, and `LABEL_PATTERN` are reasonable defaults. Investigation confirmed no explicit limits exist in `MemoryManager` today. However, before implementing:

1. Run: `grep -rn "MAX_\|LIMIT\|max_blocks\|max_content" src/memory/ src/config/`
2. Check `src/config/schema.ts` for any memory-related Zod schema fields
3. If constants are found elsewhere, use those values instead of the hardcoded defaults
4. If no constraints exist, define these constants in a shared location (e.g., `src/memory/constants.ts`) so they can be referenced by both the pre-flight validator and any future MemoryManager enforcement

These constants are the contract between checkpoint validation and memory writes. If they're wrong (too restrictive: rejects valid checkpoints; too permissive: passes invalid ones), the pre-flight becomes unreliable.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(agent): add pre-flight validation for checkpoint memory constraints`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update RestorationDependencies and add MessageStore

**Verifies:** None (infrastructure for Task 3)

**Files:**
- Modify: `src/agent/checkpoint-restore.ts` (update `RestorationDependencies` type, update imports)

**Implementation:**

Add `messageStore`, `traceRecorder` to the `RestorationDependencies` type:

```typescript
export type RestorationDependencies = {
  readonly persistence: PersistenceProvider;
  readonly memory: MemoryManager;
  readonly messageStore: MessageStore;
  readonly predictionStore?: PredictionStore;
  readonly interestRegistry?: InterestRegistry;
  readonly recallContextState?: RecallContextState;
  readonly traceRecorder: TraceRecorder;
  readonly owner: string;
  readonly log?: (message: string) => void;
};
```

Add imports:
```typescript
import type { MessageStore } from '@/persistence/message-store.ts';
import type { TraceRecorder } from '@/reflexion/types.ts';
```

Update the caller in `src/index.ts` to pass the new fields:
```typescript
const restorationDeps: RestorationDependencies = {
  persistence,
  memory,
  messageStore,       // ← new (created in Phase 2)
  predictionStore,
  interestRegistry,
  recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
  traceRecorder,      // ← new (already exists in composition root)
  owner: AGENT_OWNER,
};
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `refactor(agent): add messageStore and traceRecorder to RestorationDependencies`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Restructure restoreFromCheckpoint into three tiers

**Verifies:** arch-hardening.AC1.1, arch-hardening.AC1.5, arch-hardening.AC1.6

**Files:**
- Modify: `src/agent/checkpoint-restore.ts` (rewrite `restoreFromCheckpoint` body)

**Implementation:**

Restructure the function body into three ordered tiers:

```typescript
export async function restoreFromCheckpoint(
  checkpoint: SessionCheckpoint,
  deps: RestorationDependencies,
): Promise<RestorationResult> {
  const log = deps.log ?? console.log;

  // ── Tier 0: Pre-flight Validation ──
  const preflight = validateMemoryConstraints(checkpoint.workingMemory);
  if (!preflight.valid) {
    const error = new AgentError(
      'CHECKPOINT_FAILED',
      `pre-flight validation failed: ${preflight.reason}`,
      { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
    );
    traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
    throw error;
  }

  // ── Tier 1 + Tier 2: DB writes then memory writes, all inside transaction ──
  return await deps.persistence.withTransaction(async (queryFn) => {
    // Tier 1: DB operations (rolled back on any failure)

    // Verify conversation exists via MessageStore
    const messageCount = await deps.messageStore.count(checkpoint.conversationId);
    if (messageCount === 0 && checkpoint.messageIds.length > 0) {
      const error = new AgentError(
        'CHECKPOINT_FAILED',
        'cannot restore checkpoint: conversation has no messages (deleted or missing)',
        { conversationId: checkpoint.conversationId, checkpointId: checkpoint.id },
      );
      traceError(error, deps.traceRecorder, deps.owner, checkpoint.conversationId);
      throw error;
    }

    // Verify message coverage
    const existingIds = await deps.messageStore.listIds(checkpoint.conversationId);
    const existingIdSet = new Set(existingIds);
    const missingMessages = checkpoint.messageIds.filter(id => !existingIdSet.has(id));
    if (missingMessages.length > 0) {
      log(`checkpoint restore: ${missingMessages.length} messages no longer in conversation (likely compacted)`);
    }

    // Verify predictions (read-only check, no writes)
    if (deps.predictionStore && checkpoint.pendingPredictions.length > 0) {
      const pending = await deps.predictionStore.listPredictions(deps.owner, 'pending');
      const pendingIds = new Set(pending.map(p => p.id));
      const missingPredictions = checkpoint.pendingPredictions.filter(p => !pendingIds.has(p.id));
      if (missingPredictions.length > 0) {
        log(`checkpoint restore: ${missingPredictions.length} predictions no longer pending`);
      }
    }

    // Restore interest engagement scores (DB writes)
    if (deps.interestRegistry && checkpoint.activeInterests.length > 0) {
      const dbInterests = await deps.interestRegistry.listInterests(deps.owner);
      const dbInterestMap = new Map(dbInterests.map(i => [i.id, i]));
      for (const checkpointInterest of checkpoint.activeInterests) {
        const dbInterest = dbInterestMap.get(checkpointInterest.id);
        if (!dbInterest) {
          log(`checkpoint restore: interest "${checkpointInterest.name}" no longer exists`);
          continue;
        }
        if (dbInterest.engagementScore !== checkpointInterest.engagementScore) {
          await deps.interestRegistry.updateInterest(checkpointInterest.id, {
            engagementScore: checkpointInterest.engagementScore,
          });
        }
      }
    }

    // ── Tier 2: Memory writes (last, inside transaction) ──
    try {
      const currentBlocks = await deps.memory.list('working');
      const checkpointLabels = new Set(checkpoint.workingMemory.map(b => b.label));

      // Write all checkpoint blocks
      for (const block of checkpoint.workingMemory) {
        await deps.memory.write(block.label, block.content, 'working');
      }

      // Delete blocks not in checkpoint
      for (const existing of currentBlocks) {
        if (!checkpointLabels.has(existing.label)) {
          await deps.memory.deleteBlock(existing.id);
        }
      }
    } catch (memoryError) {
      // Best-effort clear working memory before rethrowing
      try {
        const remainingBlocks = await deps.memory.list('working');
        for (const block of remainingBlocks) {
          await deps.memory.deleteBlock(block.id);
        }
      } catch {
        // Ignore cleanup failures — the DB rollback is what matters
      }
      throw memoryError; // Propagates to withTransaction, triggers ROLLBACK
    }

    // Clear recall cache
    if (deps.recallContextState) {
      deps.recallContextState.setResult(null);
    }

    return {
      conversationId: checkpoint.conversationId,
      turnNumber: checkpoint.turnNumber,
      toolRound: checkpoint.toolRound,
      compactionMeta: checkpoint.compactionMeta,
      messageCount,
    };
  });
}
```

Key design decisions:
- Tier 0 runs BEFORE the transaction — no cleanup needed on validation failure
- Tier 1 DB reads (message count, message IDs, predictions) use MessageStore which participates transparently in the transaction via AsyncLocalStorage
- Tier 1 DB writes (interest score updates) are inside the transaction
- Tier 2 memory writes are last inside the transaction — if they fail, the catch block clears working memory to a blank state, then rethrows to trigger ROLLBACK on the DB side
- Recall cache clear is a simple in-memory operation (no DB), fine to do at the end

Replace the raw SQL queries with MessageStore calls:
- `persistence.query('SELECT COUNT(*)...')` → `deps.messageStore.count()`
- `persistence.query('SELECT id FROM messages...')` → `deps.messageStore.listIds()`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(agent): restructure checkpoint restore into atomic three-tier pattern`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Atomic checkpoint restore integration tests

**Verifies:** arch-hardening.AC1.1, arch-hardening.AC1.2, arch-hardening.AC1.3, arch-hardening.AC1.4, arch-hardening.AC1.5, arch-hardening.AC1.6

**Files:**
- Create: `src/agent/checkpoint-restore.test.ts`

**Implementation:**

Integration tests with real PostgreSQL. These tests need to verify atomicity — that partial failures leave no trace.

Setup:
- `beforeAll`: create persistence provider, connect, run migrations, create messageStore, create test fixtures
- `afterEach`: truncate messages, memory_blocks, memory_events tables
- `afterAll`: disconnect

Create mock/stub versions of MemoryManager, PredictionStore, InterestRegistry that either use the real DB or provide controllable failure points. The key is testing that:
- On success, all state changes persist
- On failure at each tier, appropriate rollback occurs

**Testing:**

- **arch-hardening.AC1.1:** Insert messages for a conversation. Create a checkpoint with workingMemory blocks, predictions, interests. Call `restoreFromCheckpoint`. Verify: memory blocks match checkpoint, interest scores match checkpoint, no errors thrown.

- **arch-hardening.AC1.2:** Create checkpoint with a workingMemory block having invalid label (e.g., `"123-invalid"`). Call `restoreFromCheckpoint`. Verify: throws `AgentError` with code `CHECKPOINT_FAILED`. Verify: no memory blocks written, no interest scores changed.

- **arch-hardening.AC1.3:** Create checkpoint with a block whose content exceeds `MAX_BLOCK_CONTENT_LENGTH`. Verify: throws before any state changes.

- **arch-hardening.AC1.4:** Create checkpoint with more than `MAX_WORKING_BLOCKS` blocks. Verify: throws before any state changes.

- **arch-hardening.AC1.5:** Create a scenario where a DB operation in Tier 1 fails (e.g., interestRegistry.updateInterest throws). Verify: transaction rolled back, no interest scores changed, no memory blocks written. Use a mock interestRegistry that throws on `updateInterest`.

- **arch-hardening.AC1.6:** Create a scenario where memory.write fails in Tier 2. Use a mock MemoryManager that throws on the second `write()` call. Verify: DB operations rolled back (interest scores unchanged), working memory is cleared to blank state (best-effort cleanup ran).

Follow project pattern: `describe('arch-hardening.AC1.1: ...', () => { it('...', async () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/agent/checkpoint-restore.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add integration tests for atomic checkpoint restore`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
