# Architectural Hardening Implementation Plan

**Goal:** Eliminate redundant `loadConversationHistory` call per turn by passing the already-maintained in-memory history array to `updateCheckpointStateAndTriggerInterval()`

**Architecture:** `updateCheckpointStateAndTriggerInterval()` gains a `currentHistory` parameter. `processMessage()` passes its local `history` array (which is already kept in sync via manual pushes after each persistence call). No database query removed from the initial load — only the second redundant load is eliminated.

**Tech Stack:** Bun (TypeScript)

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC3: History loaded once per turn
- **arch-hardening.AC3.1 Success:** `loadConversationHistory` called exactly once per `processMessage` invocation
- **arch-hardening.AC3.2 Success:** Checkpoint state includes message IDs from locally-appended messages (not just initial load)
- **arch-hardening.AC3.3 Edge:** Mid-turn checkpoint (triggered by tool) captures all messages persisted up to that point

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Modify updateCheckpointStateAndTriggerInterval signature

**Verifies:** arch-hardening.AC3.1

**Files:**
- Modify: `src/agent/agent.ts` (lines 133-160, function signature and body)

**Implementation:**

Change the function signature from:
```typescript
async function updateCheckpointStateAndTriggerInterval(
  currentTurnNumber: number,
): Promise<void>
```

To:
```typescript
async function updateCheckpointStateAndTriggerInterval(
  currentTurnNumber: number,
  currentHistory: ReadonlyArray<ConversationMessage>,
): Promise<void>
```

Replace the body that loads history (lines 137-149):
```typescript
// Before:
if (deps.checkpointStateRef) {
  const currentHistory = await loadConversationHistory(id);
  const messageIds = currentHistory.map(m => m.id);
  deps.checkpointStateRef.current = {
    turnNumber: currentTurnNumber,
    toolRound: 0,
    messageIds,
    compactionMeta: { ... },
  };
}

// After:
if (deps.checkpointStateRef) {
  const messageIds = currentHistory.map(m => m.id);
  deps.checkpointStateRef.current = {
    turnNumber: currentTurnNumber,
    toolRound: 0,
    messageIds,
    compactionMeta: {
      lastCompactedIndex: Math.max(0, lastCompactionMessageCount - 1),
      summaryCount: lastCompactionSummaryCount,
    },
  };
}
```

The `loadConversationHistory(id)` call inside this function is removed entirely. The function is now synchronous for the checkpoint state update portion (only the `checkpointFn('interval')` call at the end remains async).

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: Type errors at the two call sites (expected — fixed in Task 2)

**Commit:** `refactor(agent): add currentHistory parameter to updateCheckpointStateAndTriggerInterval`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update callers to pass history array

**Verifies:** arch-hardening.AC3.1, arch-hardening.AC3.2

**Files:**
- Modify: `src/agent/agent.ts` (lines 446 and 590, the two call sites)

**Implementation:**

Update both call sites to pass the local `history` variable:

**Call site 1 (line 446)** — after assistant response completes:
```typescript
// Before:
await updateCheckpointStateAndTriggerInterval(turnNumber);

// After:
await updateCheckpointStateAndTriggerInterval(turnNumber, history);
```

**Call site 2 (line 590)** — after max tool rounds exceeded:
```typescript
// Before:
await updateCheckpointStateAndTriggerInterval(turnNumber);

// After:
await updateCheckpointStateAndTriggerInterval(turnNumber, history);
```

The `history` variable is the same one initialized at line 201 (`let history = await loadConversationHistory(id)`) and maintained throughout the tool loop via manual pushes (lines 557-570). By the time either call site executes, `history` contains all messages persisted during the turn.

**Important:** Verify that at call site 1 (line 446), the assistant message has already been pushed onto `history` before this call. The current code at lines 557-565 pushes the assistant message during tool rounds, but for the `end_turn` case (line 446), check whether the assistant message is added to `history` before the checkpoint update call. If not, add it:

```typescript
// After persisting assistant message (line 461):
const assistantMessageId = await persistMessage({...});

// Push onto history before checkpoint update:
history.push({
  id: assistantMessageId,
  conversation_id: id,
  role: 'assistant',
  content: text,
  tool_calls: undefined,
  tool_call_id: undefined,
  reasoning_content: reasoning ?? undefined,
  created_at: new Date(),
});

await updateCheckpointStateAndTriggerInterval(turnNumber, history);
```

This ensures AC3.2 — checkpoint state includes IDs from locally-appended messages.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `refactor(agent): pass in-memory history to checkpoint state update`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for single-load history behaviour

**Verifies:** arch-hardening.AC3.1, arch-hardening.AC3.2, arch-hardening.AC3.3

**Files:**
- Create: `src/agent/history-loading.test.ts`

**Implementation:**

These tests verify that history is loaded exactly once per turn and that the checkpoint state ref contains all message IDs including locally-appended ones. Test via a query-counting wrapper around a real persistence provider.

**Test setup pattern:**

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '@/persistence/postgres.ts';
import { createAgent } from '@/agent/agent.ts';
import type { PersistenceProvider } from '@/persistence/types.ts';

const DB_URL = 'postgresql://constellation:constellation@localhost:5432/constellation';

function createQueryCountingProvider(base: PersistenceProvider): PersistenceProvider & { historyLoadCount: number } {
  let historyLoadCount = 0;
  const HISTORY_QUERY_PATTERN = 'FROM messages WHERE conversation_id';

  return {
    ...base,
    historyLoadCount,
    query: async <T extends Record<string, unknown>>(sql: string, params?: ReadonlyArray<unknown>) => {
      if (sql.includes(HISTORY_QUERY_PATTERN) && sql.includes('ORDER BY created_at ASC') && !sql.includes('COUNT')) {
        historyLoadCount++;
      }
      return base.query<T>(sql, params);
    },
    get historyLoadCount() { return historyLoadCount; },
  };
}
```

Create a minimal mock model provider that returns `end_turn` with a simple text response (no tool use) for AC3.1/AC3.2, and one that returns tool_use for AC3.3.

**Testing:**

- **arch-hardening.AC3.1:** Create agent with query-counting provider and mock model (returns `end_turn` immediately). Call `processMessage('test')`. Assert `provider.historyLoadCount === 1`. The history query should fire exactly once (the initial load), not twice.

- **arch-hardening.AC3.2:** Create agent with `checkpointStateRef` exposed (pass it in AgentDependencies). Mock model returns `end_turn`. Call `processMessage('test')`. After completion, inspect `checkpointStateRef.current.messageIds`. Verify it contains at least 2 IDs (user message + assistant response). Verify these IDs exist in the database via a direct query.

- **arch-hardening.AC3.3:** Create agent with `checkpointStateRef`. Mock model returns one tool_use round (calls a no-op tool), then `end_turn` on the second call. After `processMessage` completes, inspect `checkpointStateRef.current.messageIds`. Verify it includes IDs for: user message, assistant tool-use message, tool result message, and final assistant response. Count should be >= 4.

Follow project pattern: `describe('arch-hardening.AC3.1: ...', () => { it('...', async () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/agent/history-loading.test.ts`
Expected: All tests pass

**Commit:** `test(agent): verify single history load per turn`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
