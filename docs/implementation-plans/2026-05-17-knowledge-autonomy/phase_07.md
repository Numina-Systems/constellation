# Knowledge Autonomy Implementation Plan — Phase 7: Archivist Activity Integration

**Goal:** Wire archivist pipeline into the circadian activity system with scheduled incremental and full runs

**Architecture:** Follows existing patterns exactly: extend `SLEEP_TASK_NAMES` array, add event builder function, add switch-case routing in `handleSleepTask`, register system-owned scheduled tasks via check-then-register pattern, create archivist sub-agent following the subconscious agent pattern.

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, Bun

**Scope:** 7 phases from original design (phase 7 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC4: Archivist
- **knowledge-autonomy.AC4.8 Success:** Incremental pipeline runs on configured schedule during wake cycles
- **knowledge-autonomy.AC4.9 Success:** Full pipeline runs during sleep at configured offset
- **knowledge-autonomy.AC4.10 Failure:** Archivist skips readonly, familiar, pinned, append blocks and archivist:*/diary:* labels
- **knowledge-autonomy.AC4.11 Failure:** Missing embedding provider causes dedup/crossref to be skipped (not crash), other stages continue

---

<!-- START_TASK_1 -->
### Task 1: Extend SLEEP_TASK_NAMES and add sleep event builder

**Files:**
- Modify: `src/activity/schedule.ts` (add `'sleep-archivist'` to `SLEEP_TASK_NAMES` array at line ~83)
- Modify: `src/activity/sleep-events.ts` (add `buildArchivistEvent()` function)

**Implementation:**

In `src/activity/schedule.ts`, extend the `SLEEP_TASK_NAMES` array:

Change:
```typescript
export const SLEEP_TASK_NAMES = ['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis'] as const;
```

To:
```typescript
export const SLEEP_TASK_NAMES = ['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis', 'sleep-archivist'] as const;
```

In `src/activity/sleep-events.ts`, add a new event builder function following the existing pattern (`buildCompactionEvent`, `buildPredictionReviewEvent`, etc.):

```typescript
export function buildArchivistEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
  timestamp: Date,
): SleepTaskEvent {
  let content = `Sleep task: Knowledge Archivist (Full Pipeline)

Run the full archivist pipeline to maintain knowledge health:
- Scan all mutable memory blocks
- Identify and merge near-duplicate blocks
- Cross-reference related blocks
- Prune empty blocks
- Write a reflection on memory health

This is a background maintenance task. Focus on knowledge quality and organization.`;

  if (flaggedEvents.length > 0) {
    content += `\n\n[Flagged Events: ${flaggedEvents.length} high-priority items arrived during sleep]`;
  }

  return {
    source: 'sleep-task',
    content,
    metadata: { taskType: 'archivist', sleepTask: true },
    timestamp,
  };
}
```

Check the exact type of `SleepTaskEvent` and `QueuedEvent` from the existing event builders to match the pattern precisely.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/activity/`
Expected: All existing tests pass

**Commit:** `feat(archivist): extend SLEEP_TASK_NAMES and add sleep event builder`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: handleSleepTask routing for archivist

**Files:**
- Modify: `src/index.ts` (add `case 'sleep-archivist'` to `handleSleepTask` switch-case at line ~1445)

**Implementation:**

In the `handleSleepTask` function's switch-case (around line 1445-1473), add a new case:

```typescript
case 'sleep-archivist':
  event = buildArchivistEvent(flaggedEvents, new Date());
  break;
```

Add the import for `buildArchivistEvent` from `@/activity/sleep-events`.

When this event is queued and processed, it triggers the archivist sub-agent to run the full pipeline. The actual pipeline execution happens in the archivist sub-agent's event handler (Task 4).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add sleep task routing for full pipeline`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: System task registration for archivist

**Files:**
- Modify: `src/index.ts` (add check-then-register for archivist incremental and sleep tasks, near existing system task registrations at lines ~1614-1676)

**Implementation:**

Follow the existing check-then-register pattern. Two tasks:

**1. Incremental task (wake cycle):**

```typescript
if (config.archivist?.enabled !== false) {
  const archivistIncrementalCron = config.archivist?.incremental_cron ?? '0 */3 * * *';

  const existingIncrementalTasks = await persistence.query<{ id: string }>(
    `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
    ['system', 'archivist-incremental'],
  );

  if (existingIncrementalTasks.length === 0) {
    await systemScheduler.schedule({
      id: crypto.randomUUID(),
      name: 'archivist-incremental',
      schedule: archivistIncrementalCron,
      payload: { type: 'archivist-incremental' },
    });
    console.log(`archivist incremental task scheduled (${archivistIncrementalCron})`);
  } else {
    console.log('archivist incremental task already scheduled');
  }
```

**2. Full (sleep) task:**

```typescript
  if (activityEnabled && scheduleConfig) {
    const offsetHours = config.archivist?.sleep_offset_hours ?? 3;
    const archivistSleepCron = sleepTaskCron(scheduleConfig.sleepSchedule, offsetHours, scheduleConfig.timezone);

    const existingSleepTasks = await persistence.query<{ id: string }>(
      `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
      ['system', 'sleep-archivist'],
    );

    if (existingSleepTasks.length === 0) {
      await systemScheduler.schedule({
        id: crypto.randomUUID(),
        name: 'sleep-archivist',
        schedule: archivistSleepCron,
        payload: { type: 'sleep-archivist' },
      });
      console.log(`archivist sleep task scheduled (${archivistSleepCron})`);
    } else {
      console.log('archivist sleep task already scheduled');
    }
  }
}
```

Import `sleepTaskCron` from `@/activity/schedule` if not already imported.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): register system tasks for incremental and sleep runs`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Archivist event handler in system scheduler dispatch

**Files:**
- Modify: `src/index.ts` (add `archivist-incremental` handling to `handleSystemSchedulerTaskWithActivity` function at line ~1494)

**Implementation:**

In the `handleSystemSchedulerTaskWithActivity` function, add a handler for the `archivist-incremental` task. This should be added alongside the existing impulse task handling:

```typescript
else if (task.name === 'archivist-incremental' && archivistPipeline) {
  (async () => {
    try {
      console.log('[archivist] running incremental pipeline');
      const result = await archivistPipeline.runIncremental();
      console.log(`[archivist] incremental complete: scanned=${result.scanned}, deduped=${result.deduped}, pruned=${result.pruned}`);
    } catch (error) {
      console.error('[archivist] incremental pipeline error:', error);
    }
  })();
}
```

The `archivistPipeline` variable needs to be created in the composition root (Task 5). The incremental pipeline runs directly — it doesn't need a sub-agent because it has no LLM calls.

For the **full pipeline** (sleep task), the sleep event is already routed via `handleSleepTask` (Task 2) to build an event that gets queued to the main agent or archivist sub-agent. The sub-agent processes the event and calls `archivistPipeline.runFull()`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add incremental pipeline handler to system scheduler dispatch`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Composition root wiring — pipeline and sub-agent

**Files:**
- Modify: `src/index.ts` (create archivist pipeline, create archivist sub-agent following subconscious pattern)

**Implementation:**

Add imports:

```typescript
import { createArchivistPipeline } from '@/archivist';
import type { ArchivistPipeline } from '@/archivist';
```

After the memory store, embedding provider, and summarization model are created, create the archivist pipeline:

```typescript
let archivistPipeline: ArchivistPipeline | null = null;

if (config.archivist?.enabled !== false) {
  archivistPipeline = createArchivistPipeline({
    memoryStore,
    memoryManager: memory,
    embedding: embedding ?? null,
    summarizationModel: summarizationModelProvider ?? null,
    persistence,
    owner: AGENT_OWNER,
    dedupThreshold: config.archivist?.dedup_threshold ?? 0.92,
    crossrefThreshold: config.archivist?.crossref_threshold ?? 0.75,
    tokenBudget: config.archivist?.token_budget ?? 50000,
  });
  console.log('archivist pipeline created');
}
```

The archivist sub-agent for full pipeline runs during sleep follows the subconscious agent pattern from `src/index.ts:1212-1258`. The design explicitly requires a separate sub-agent with an isolated conversation ID.

Create the archivist sub-agent when `inner_conversation_id` is configured:

```typescript
let archivistAgent: Agent | null = null;

if (archivistPipeline && config.archivist?.inner_conversation_id) {
  const archivistSourceInstructions = new Map<string, string>([
    ['sleep-task', `You are the archivist — a background knowledge maintenance agent.
When you receive a sleep task event, run the full archivist pipeline to maintain knowledge health.
Focus on knowledge quality, deduplication, cross-referencing, and organization.
Report a brief summary of actions taken.`],
  ]);

  archivistAgent = createAgent({
    model,
    memory,
    registry,
    runtime,
    persistence,
    embedding,
    config: { ...config.agent, max_tool_rounds: 3 },
    owner: AGENT_OWNER,
    sourceInstructions: archivistSourceInstructions,
    // Minimal context providers — archivist doesn't need diary, recall, etc.
    contextProviders: [],
    classifiedProviders: [],
  }, config.archivist.inner_conversation_id);

  console.log('archivist sub-agent created');
}
```

The sub-agent shares model, memory, persistence, embedding, and tool registry with the main agent but has its own conversation ID. When `sleep-archivist` events fire, route them to this sub-agent instead of the main agent.

Update the sleep task handler to dispatch to the archivist agent:

```typescript
// In handleSleepTask, after building the archivist event:
case 'sleep-archivist':
  event = buildArchivistEvent(flaggedEvents, new Date());
  if (archivistAgent) {
    // Route to archivist sub-agent
    archivistAgent.processEvent(event).catch(error => {
      console.error('[archivist] full pipeline event error:', error);
    });
    return; // Don't queue to main agent
  }
  break; // Fall through to main agent if no sub-agent
```

If `inner_conversation_id` is not configured, the event falls through to the main agent as a fallback.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing tests pass

**Commit:** `feat(archivist): wire pipeline and sub-agent into composition root`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Activity integration tests

**Verifies:** knowledge-autonomy.AC4.8, knowledge-autonomy.AC4.9, knowledge-autonomy.AC4.10, knowledge-autonomy.AC4.11

**Files:**
- Create: `src/archivist/activity.test.ts`

**Testing:**

Tests must verify:
- knowledge-autonomy.AC4.8: `archivist-incremental` task name is handled by the system scheduler dispatch
- knowledge-autonomy.AC4.9: `sleep-archivist` is in `SLEEP_TASK_NAMES` array
- knowledge-autonomy.AC4.9: `buildArchivistEvent()` returns a properly formatted sleep task event
- knowledge-autonomy.AC4.9: `sleepTaskCron()` with configured offset produces a valid cron expression
- knowledge-autonomy.AC4.10: Verify scan stage filtering (already covered in Phase 6 tests, but confirm integration)
- knowledge-autonomy.AC4.11: Pipeline with null embedding provider completes without crashing; dedup/crossref are skipped

Test approach:
- Unit test `buildArchivistEvent` directly — verify event shape, metadata, and flagged events handling
- Unit test that `SLEEP_TASK_NAMES` includes `'sleep-archivist'`
- Integration test: create a pipeline with null embedding, run `runIncremental()`, verify it completes with `dedup.skipped = true`
- Integration test: create a pipeline with null summarization model, run `runFull()`, verify consolidate and reflect are skipped

**Verification:**

Run: `bun test src/archivist/activity.test.ts`
Expected: All tests pass

**Commit:** `test(archivist): add activity integration tests`

<!-- END_TASK_6 -->
