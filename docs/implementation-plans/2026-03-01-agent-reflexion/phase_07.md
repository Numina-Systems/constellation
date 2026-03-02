# Agent Reflexion Implementation Plan

**Goal:** Wire all reflexion and scheduler components into the composition root and register the hourly review scheduled task.

**Architecture:** Modify `src/index.ts` to create stores, register tools, wire trace recorder and context providers into the agent, start the scheduler, and register a review job that fires hourly via `processEvent()`.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC3: Prediction Review
- **agent-reflexion.AC3.4 Success:** Review job expires predictions older than 24h as `expired` without evaluating them
- **agent-reflexion.AC3.6 Success:** Review job with zero pending predictions still produces a reflection noting the absence

### agent-reflexion.AC4: Scheduler
- **agent-reflexion.AC4.6 Success:** Review job is registered as a scheduled task at daemon startup and fires hourly via `processEvent()`

### agent-reflexion.AC5: Wiring & Context
- **agent-reflexion.AC5.3 Success:** All new components (store, recorder, tools, scheduler, context provider) are wired in the composition root and the daemon starts successfully

---

## Phase 7: Composition Root Wiring & Review Job

**Goal:** Wire all components into `src/index.ts` and register the hourly review scheduled task.

**Key investigation findings:**
- Composition root at `src/index.ts` follows a clear creation order: providers → DB → memory → tools → runtime → compactor → agent → data sources → REPL
- Agent owner is hardcoded as `'spirit'` (line 319, `createMemoryManager(memoryStore, embedding, 'spirit')`)
- Tool registration: `registry.register(tool)` takes a single `Tool` (loop over arrays from factory functions)
- `processEventQueue(eventQueue, agent)` drains a queue and calls `agent.processEvent(event)` for each item
- `formatExternalEvent` in `src/agent/agent.ts` handles source-specific formatting — scheduler events will show as `[External Event: review-job]`
- `createPredictionStore(persistence)` takes only persistence (owner is per-method)
- `createTraceRecorder(persistence)` takes only persistence
- `createPostgresScheduler(persistence, owner)` takes persistence + owner
- `createPredictionTools({ store, owner, conversationId })` needs owner + conversationId
- `createIntrospectionTools({ traceStore, predictionStore, owner })` needs owner
- `createPredictionContextProvider(store, owner)` needs owner
- Shutdown handler at `src/index.ts:88-106` stops Bluesky — needs to also stop the scheduler

**CLAUDE.md files to read before implementation:**
- `src/agent/CLAUDE.md` — Agent loop contracts
- `src/extensions/CLAUDE.md` — Extension interface contracts

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Wire reflexion stores, tools, and context provider into composition root

**Verifies:** agent-reflexion.AC5.3

**Files:**
- Modify: `src/index.ts` (add imports and wiring for all reflexion components)

**Implementation:**

Add imports at the top of `src/index.ts` (after existing imports, around line 29):

```typescript
import { createPredictionStore, createTraceRecorder } from '@/reflexion';
import { createPredictionTools, createIntrospectionTools } from '@/reflexion';
import { createPredictionContextProvider } from '@/reflexion';
import type { TraceStore } from '@/reflexion';
import { createPostgresScheduler } from '@/scheduler';
```

The agent owner constant — extract the hardcoded `'spirit'` into a named constant for reuse:

```typescript
const AGENT_OWNER = 'spirit';
```

Replace the existing `createMemoryManager(memoryStore, embedding, 'spirit')` call with `createMemoryManager(memoryStore, embedding, AGENT_OWNER)`.

**After memory manager creation (after line 319), create reflexion stores:**

```typescript
const predictionStore = createPredictionStore(persistence);
const traceRecorder: TraceStore = createTraceRecorder(persistence);
```

Note: `createTraceRecorder` returns `TraceStore` (which extends `TraceRecorder` with `queryTraces`). Explicit typing avoids type casts at call sites.

**After existing tool registration (after line 327, after `createCompactContextTool()`), register reflexion tools:**

The prediction tools require a `conversationId` — use the main agent's conversation ID. Since the agent hasn't been created yet at this point, and `createPredictionTools` needs a `conversationId`, use the agent's conversation ID after agent creation. However, the tool registry needs tools registered before agent creation (the registry is a dependency).

There are two approaches:
1. Register prediction tools with a placeholder conversation ID (the tools use it for recording predictions, and the main REPL agent's conversation ID is generated at `createAgent` time)
2. Generate the conversation ID upfront and pass it to both tools and agent

Use approach 2 — generate a conversation ID before creating tools:

```typescript
const mainConversationId = crypto.randomUUID();
```

Then register prediction and introspection tools:

```typescript
const predictionTools = createPredictionTools({
  store: predictionStore,
  owner: AGENT_OWNER,
  conversationId: mainConversationId,
});
for (const tool of predictionTools) {
  registry.register(tool);
}

const introspectionTools = createIntrospectionTools({
  traceStore: traceRecorder,
  predictionStore,
  owner: AGENT_OWNER,
});
for (const tool of introspectionTools) {
  registry.register(tool);
}
```

**Create context provider (before agent creation):**

```typescript
const predictionContextProvider = createPredictionContextProvider(predictionStore, AGENT_OWNER);
```

**Modify agent creation (around line 417) to include new dependencies:**

```typescript
const agent = createAgent({
  model,
  memory,
  registry,
  runtime,
  persistence,
  config: {
    max_tool_rounds: config.agent.max_tool_rounds,
    context_budget: config.agent.context_budget,
    model_max_tokens: DEFAULT_MODEL_MAX_TOKENS,
    model_name: config.model.name,
  },
  getExecutionContext,
  compactor,
  traceRecorder,
  owner: AGENT_OWNER,
  contextProviders: [predictionContextProvider],
}, mainConversationId);
```

Note: Pass `mainConversationId` as the second argument to `createAgent` so the agent uses the same conversation ID as the prediction tools.

**Also update the Bluesky agent creation** (around line 438) to include `traceRecorder` and `owner` so Bluesky tool calls are also traced:

```typescript
const blueskyAgent = createAgent({
  model,
  memory,
  registry,
  runtime,
  persistence,
  config: { ... },
  getExecutionContext,
  traceRecorder,
  owner: AGENT_OWNER,
}, blueskyConversationId);
```

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat: wire reflexion stores, tools, and context provider into composition root`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire scheduler and register review job

**Verifies:** agent-reflexion.AC4.6, agent-reflexion.AC5.3

**Files:**
- Modify: `src/index.ts` (add scheduler wiring and review job registration)

**Implementation:**

**After agent creation (after the `createAgent` call), set up the scheduler:**

```typescript
const scheduler = createPostgresScheduler(persistence, AGENT_OWNER);
```

**Register the `onDue` handler that fires `processEvent` when a task is due:**

Create a dedicated event queue for scheduler events (separate from Bluesky's queue), and a processing function similar to the Bluesky pattern.

**Note:** The existing `processEventQueue` has hardcoded `[bluesky]` log prefixes. For now, reuse it as-is — the scheduler events will log with `[bluesky]` prefix, which is cosmetic only. A follow-up cleanup can add a `sourceLabel` parameter to `processEventQueue` or inline the drain loop.

```typescript
const schedulerEventQueue = createEventQueue(10);
let schedulerProcessing = false;

async function processSchedulerEvent(): Promise<void> {
  if (schedulerProcessing) return;
  schedulerProcessing = true;
  try {
    await processEventQueue(schedulerEventQueue, agent);
  } finally {
    schedulerProcessing = false;
  }
}

scheduler.onDue((task) => {
  // AC3.4: Expire stale predictions older than 24h before sending review event
  predictionStore
    .expireStalePredictions(AGENT_OWNER, new Date(Date.now() - 24 * 3600_000))
    .then((expiredCount) => {
      if (expiredCount > 0) {
        console.log(`review job: expired ${expiredCount} stale predictions`);
      }
    })
    .catch((error) => {
      console.warn('review job: failed to expire stale predictions', error);
    });

  const reviewEvent = {
    source: 'review-job',
    content: [
      `Scheduled task "${task.name}" has fired.`,
      '',
      'Review your pending predictions against recent operation traces.',
      'Use self_introspect to see your recent tool usage, then use list_predictions to see pending predictions.',
      'For each prediction, use annotate_prediction to record whether it was accurate.',
      'After reviewing, write a brief reflection to archival memory summarizing what you learned.',
      '',
      'If you have no pending predictions, still write a brief reflection noting this and consider whether you should be making predictions about outcomes of your actions.',
    ].join('\n'),
    metadata: {
      taskId: task.id,
      taskName: task.name,
      schedule: task.schedule,
      ...task.payload,
    },
    timestamp: new Date(),
  };

  schedulerEventQueue.push(reviewEvent);
  processSchedulerEvent().catch((error) => {
    console.error('scheduler event processing error:', error);
  });
});
```

**Register the hourly review job (AC4.6):**

Schedule the review task with a cron expression for hourly execution. The `schedule` method is idempotent in the sense that it creates a new row — but on restart, the previous task is already in the DB. To avoid duplicate tasks on restart, query for existing review tasks first:

```typescript
// Register hourly review job if not already scheduled
const existingTasks = await persistence.query<{ id: string }>(
  `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
  [AGENT_OWNER, 'review-predictions'],
);

if (existingTasks.length === 0) {
  await scheduler.schedule({
    id: crypto.randomUUID(),
    name: 'review-predictions',
    schedule: '0 * * * *', // Every hour at minute 0
    payload: { type: 'prediction-review' },
  });
  console.log('review job scheduled (hourly)');
} else {
  console.log('review job already scheduled');
}
```

**Start the scheduler:**

```typescript
scheduler.start();
console.log('scheduler started');
```

**Update shutdown handler to stop the scheduler:**

Modify `createShutdownHandler` to accept and stop the scheduler. Add a scheduler parameter:

```typescript
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  blueskySource?: BlueskyDataSource | null,
  scheduler?: { stop(): void } | null,
): () => Promise<void> {
```

In the shutdown function body, before `performShutdown`, add:

```typescript
if (scheduler) {
  scheduler.stop();
  console.log('scheduler stopped');
}
```

Update the call site to pass the scheduler:

```typescript
const shutdownHandler = createShutdownHandler(rl, persistence, blueskySource, scheduler);
```

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat: wire scheduler and register hourly review job`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Smoke test for composition root wiring

**Verifies:** agent-reflexion.AC5.3, agent-reflexion.AC3.4, agent-reflexion.AC3.6

**Files:**
- Create: `src/index.wiring.test.ts`

**Testing:**

This test verifies that all new components can be wired together without errors. It does NOT test individual component behaviour (covered in earlier phase tests). It verifies the composition root wiring logic is correct.

Since `src/index.ts` uses a `main()` function that's only called when `import.meta.main` is true, and the wiring logic is embedded in `main()`, testing the full wiring requires either:
1. Importing individual exported functions from `index.ts` (`processEventQueue`, `createShutdownHandler`, etc.)
2. Testing that imports resolve and types are compatible

Use approach 1 — test the exported utility functions and verify import compatibility:

Tests must verify:
- **agent-reflexion.AC5.3 (import compatibility):** Import all new modules (`@/reflexion`, `@/scheduler`) and verify they export the expected factory functions. This catches broken barrel exports or missing re-exports.
- **agent-reflexion.AC5.3 (shutdown handler with scheduler):** Call `createShutdownHandler` with a mock scheduler that has a `stop()` method. Verify `stop()` is called during shutdown.
- **agent-reflexion.AC4.6 (review event format):** Construct a review event the same way the composition root does (source `'review-job'`, content with instructions, metadata with task info). Pass it to a mock agent's `processEvent`. Verify it's called with the correct event shape.
- **agent-reflexion.AC3.4 (expiry invocation):** Verify the onDue handler calls `predictionStore.expireStalePredictions` with the correct owner and a 24h-ago cutoff date.
- **agent-reflexion.AC3.6 (zero-predictions prompt):** Verify the review event content includes guidance for the zero-predictions case ("If you have no pending predictions").

**Verification:**

Run: `bun test src/index.wiring.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: No type errors

**Commit:** `test: add composition root wiring smoke tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
