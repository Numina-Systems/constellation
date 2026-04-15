# Subconscious Implementation Plan — Phase 4: Impulse Handler and Scheduler

**Goal:** System-owned cron task that fires during wake hours and dispatches impulse events to the subconscious agent via `processEvent()`.

**Architecture:** Pure impulse event builder in `src/subconscious/impulse.ts` (following `src/activity/sleep-events.ts` pattern), system-owned cron task registration in composition root, activity-gated dispatch via `createActivityDispatch()`.

**Tech Stack:** TypeScript (Bun), croner, bun:test

**Scope:** 7 phases from original design (phase 4 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC1: Subconscious fires autonomously during wake hours
- **subconscious.AC1.1 Success:** Impulse events fire at the configured cron interval during wake hours
- **subconscious.AC1.2 Success:** Each impulse dispatches a reflect→generate→act prompt to the subconscious agent
- **subconscious.AC1.3 Success:** Impulse prompt includes current interests, recent traces, and recent memories
- **subconscious.AC1.4 Failure:** Impulses are suppressed during sleep hours (activity-gated)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Impulse prompt builder — pure function

**Verifies:** None directly (tested in Task 3)

**Files:**
- Create: `src/subconscious/impulse.ts`

**Implementation:**

Create with pattern annotation `// pattern: Functional Core`.

Follow the `SleepTaskEvent` pattern from `src/activity/sleep-events.ts`. The impulse builder is a pure function that assembles a structured prompt from pre-fetched state.

Define the input type:

```typescript
type ImpulseContext = {
  readonly interests: ReadonlyArray<Interest>;
  readonly recentExplorations: ReadonlyArray<ExplorationLogEntry>;
  readonly recentTraces: ReadonlyArray<OperationTrace>;
  readonly recentMemories: ReadonlyArray<string>;
  readonly timestamp: Date;
};
```

Export the builder function:

```typescript
export function buildImpulseEvent(context: Readonly<ImpulseContext>): ExternalEvent
```

The function builds a multi-section prompt following the reflect→generate→act cycle:

**Section 1: Reflect**
```
[Reflect]
Here's what's happened recently. What patterns or insights do you notice?

[Recent Activity]
{formatted traces via formatTraceSummary()}

[Recent Memories]
{bulleted list of recent memory snippets, or "No recent memories." if empty}

[Recent Explorations]
{formatted exploration log entries, or "No recent explorations." if empty}
```

**Section 2: Generate**
```
[Generate]
Given what you know and what you've been exploring, what's interesting right now?

[Active Interests]
{formatted list of active interests with engagement scores, or "You have no interests yet. What are you curious about?" if empty}
```

**Section 3: Act**
```
[Act]
Pursue your chosen curiosity. You have access to all tools — web search, code execution, memory writes, scheduling.

Use manage_interest and manage_curiosity to track what you're doing. Log your exploration.
```

Return as `ExternalEvent`:
```typescript
return {
  source: 'subconscious:impulse',
  content: prompt,
  metadata: {
    taskType: 'impulse',
    interestCount: context.interests.length,
    traceCount: context.recentTraces.length,
  },
  timestamp: context.timestamp,
};
```

Import `formatTraceSummary` from `../scheduled-context.ts` to format traces (reuse existing pattern).

Import `ExternalEvent` from `../agent/types.ts`.
Import `Interest`, `ExplorationLogEntry` from `./types.ts`.
Import `OperationTrace` from `../reflexion/types.ts`.

**Helper functions** (all pure, within the same file):

`formatInterests(interests)`: Format each interest as `- {name} (score: {score}, source: {source}): {description}`. If empty, return the cold-start prompt: `"You have no interests yet. What are you curious about?"`

`formatExplorations(entries)`: Format each as `- [{time}] {action} → {outcome}`. If empty, return `"No recent explorations."`

`formatMemories(memories)`: Format each as `- {memory}`. If empty, return `"No recent memories."`

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add impulse prompt builder`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Impulse context assembler — imperative shell

**Verifies:** None directly (tested in Task 3)

**Files:**
- Create: `src/subconscious/impulse-assembler.ts`

**Implementation:**

Create with pattern annotation `// pattern: Imperative Shell`.

This module fetches the real data needed to build the impulse event. It bridges the pure `buildImpulseEvent()` with the actual dependencies.

Define the dependency type:

```typescript
type ImpulseAssemblerDeps = {
  readonly interestRegistry: InterestRegistry;
  readonly traceStore: TraceStore;
  readonly memory: MemoryManager;
  readonly owner: string;
};
```

Define the return type (designed for Phase 6 extension with morning/wrap-up methods):

```typescript
type ImpulseAssembler = {
  assembleImpulse(): Promise<ExternalEvent>;
  assembleMorningAgenda(): Promise<ExternalEvent>;
  assembleWrapUp(): Promise<ExternalEvent>;
};
```

Export the assembler factory:

```typescript
export function createImpulseAssembler(deps: Readonly<ImpulseAssemblerDeps>): ImpulseAssembler
```

**`assembleImpulse()` method:**

1. Query active interests: `deps.interestRegistry.listInterests(deps.owner, { status: 'active' })`
2. Query recent exploration log: `deps.interestRegistry.listExplorationLog(deps.owner, 10)`
3. Query recent traces (last 2 hours, limit 20): `deps.traceStore.queryTraces({ owner: deps.owner, lookbackSince: new Date(Date.now() - 2 * 3600_000), limit: 20 })`
4. Query recent memories from working memory tier: `deps.memory.read('recent thoughts conversations discoveries interests', 5, 'working')` — semantic search scoped to working memory (most recent context). Map results to `result.block.content` strings. The query string targets working memory which contains recent conversation context and agent reflections.
5. Call `buildImpulseEvent({ interests, recentExplorations, recentTraces, recentMemories, timestamp: new Date() })`
6. Return the event.

Run queries 1-4 in parallel via `Promise.all()`.

**`assembleMorningAgenda()` and `assembleWrapUp()` methods (stubs for Phase 6):**

For now, these are stubs that throw:
```typescript
assembleMorningAgenda: async () => { throw new Error('Morning agenda not implemented yet — see Phase 6'); },
assembleWrapUp: async () => { throw new Error('Wrap-up not implemented yet — see Phase 6'); },
```

Phase 6 will replace these stubs with real implementations that call `buildMorningAgendaEvent()` and `buildWrapUpEvent()`.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add impulse context assembler`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Impulse builder tests

**Verifies:** subconscious.AC1.2, subconscious.AC1.3

**Files:**
- Create: `src/subconscious/impulse.test.ts`

**Testing:**

**subconscious.AC1.2:** Each impulse dispatches a reflect→generate→act prompt to the subconscious agent
- `describe('subconscious.AC1.2: Impulse prompt structure')`:
  - `it('builds a prompt with Reflect, Generate, and Act sections')` — call `buildImpulseEvent()` with sample data, verify the returned event content contains `[Reflect]`, `[Generate]`, and `[Act]` sections.
  - `it('returns ExternalEvent with source subconscious:impulse')` — verify `source`, `metadata.taskType`, and `timestamp`.

**subconscious.AC1.3:** Impulse prompt includes current interests, recent traces, and recent memories
- `describe('subconscious.AC1.3: Impulse prompt content')`:
  - `it('includes active interests with scores')` — pass interests with known names/scores, verify they appear in the output.
  - `it('includes recent traces via formatTraceSummary')` — pass trace data, verify `[Recent Activity]` section contains trace entries.
  - `it('includes recent memories')` — pass memory strings, verify they appear under `[Recent Memories]`.
  - `it('includes recent explorations')` — pass exploration log entries, verify they appear.
  - `it('shows cold-start prompt when no interests exist')` — pass empty interests array, verify output contains "You have no interests yet. What are you curious about?"
  - `it('handles all-empty context gracefully')` — pass all empty arrays, verify valid event is returned with "No recent" messages.

These are pure function tests — no database needed.

**Verification:**
Run: `bun test src/subconscious/impulse.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add impulse builder tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Register impulse scheduler in composition root

**Verifies:** None directly (tested in Task 6)

**Files:**
- Modify: `src/index.ts` — register impulse cron task on system scheduler
- Modify: `src/subconscious/index.ts` — export new functions

**Implementation:**

Update `src/subconscious/index.ts` to export:
- `buildImpulseEvent` from `./impulse.ts`
- `createImpulseAssembler` from `./impulse-assembler.ts`

In `src/index.ts`, after the subconscious agent creation (from Phase 3), when subconscious is enabled:

1. Create the impulse assembler:
```typescript
const impulseAssembler = createImpulseAssembler({
  interestRegistry,
  traceStore,
  memory,
  owner: AGENT_OWNER,
});
```

2. Register the impulse cron task on the system scheduler. Convert `impulse_interval_minutes` to a cron expression:
```typescript
const impulseMinutes = config.subconscious.impulse_interval_minutes;
const impulseCron = `*/${impulseMinutes} * * * *`;
```

3. Schedule the impulse task (following the activity tasks pattern):
```typescript
await systemScheduler.schedule({
  id: crypto.randomUUID(),
  name: 'subconscious-impulse',
  schedule: impulseCron,
  payload: { taskType: 'impulse' },
});
```

4. Handle the impulse task in the system scheduler handler. In the existing `handleSystemSchedulerTaskWithActivity` function (or equivalent), add a case for `'subconscious-impulse'`:
```typescript
if (task.name === 'subconscious-impulse' && subconsciousAgent) {
  const event = await impulseAssembler.assembleImpulse();
  await subconsciousAgent.processEvent(event);
}
```

5. Add `'subconscious-impulse'` to the `suppressDuringSleep` list in the activity dispatch configuration. This ensures impulses are suppressed during sleep hours (AC1.4).

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): register impulse scheduler in composition root`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Activity dispatch integration for impulse suppression

**Verifies:** None directly (tested in Task 6)

**Files:**
- Modify: `src/index.ts` — ensure impulse task is in suppressDuringSleep list

**Implementation:**

In the `createActivityDispatch` call for the system scheduler (around line 988-994 of index.ts), add `'subconscious-impulse'` to the `suppressDuringSleep` array:

```typescript
systemScheduler.onDue(createActivityDispatch({
  activityManager: am,
  originalHandler: handleSystemSchedulerTaskWithActivity,
  onTransition: handleTransition,
  suppressDuringSleep: ['review-predictions', 'subconscious-impulse'],
}));
```

This means:
- During wake hours: impulse fires normally, dispatches to subconscious agent
- During sleep hours: impulse is suppressed (dropped silently, not queued)
- This differs from regular events which get queued — impulses are time-sensitive and stale by wake time

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): suppress impulse during sleep hours`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Impulse scheduling and activity gating tests

**Verifies:** subconscious.AC1.1, subconscious.AC1.4

**Files:**
- Create: `src/subconscious/scheduling.test.ts`

**Testing:**

**subconscious.AC1.1:** Impulse events fire at the configured cron interval during wake hours
- `describe('subconscious.AC1.1: Impulse scheduling')`:
  - `it('converts impulse_interval_minutes to valid cron expression')` — verify that `20` becomes `*/20 * * * *` cron. This tests the cron expression construction.
  - `it('impulse assembler returns valid ExternalEvent')` — create a mock-based impulse assembler, verify it produces an event with `source: 'subconscious:impulse'`.

**subconscious.AC1.4:** Impulses are suppressed during sleep hours (activity-gated)
- `describe('subconscious.AC1.4: Impulse suppression during sleep')`:
  - `it('impulse task name is in suppressDuringSleep list')` — this is a wiring/config assertion. Test that the activity dispatch configuration includes `'subconscious-impulse'` in its suppress list. This may need to be tested at the integration level or extracted as a constant.
  - `it('createActivityDispatch suppresses named tasks during sleep')` — import `createActivityDispatch` from `../activity/dispatch.ts`, create with a mock activity manager in sleeping mode, fire a task with name `'subconscious-impulse'`, verify the original handler was NOT called.

**Verification:**
Run: `bun test src/subconscious/scheduling.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add impulse scheduling and activity gating tests`

<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
