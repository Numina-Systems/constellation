# Dynamic Sleep Cycle Implementation Plan — Phase 3

**Goal:** Inject activity state and circadian guidance into the agent's system prompt.

**Architecture:** Context provider following the cached async refresh pattern from `src/reflexion/context-provider.ts`. Factory function returns a `ContextProvider` (synchronous `() => string | undefined`). Async refresh fires in the background; stale-but-fast on the read path.

**Tech Stack:** TypeScript 5.7+

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC6: Context provider circadian awareness
- **sleep-cycle.AC6.1 Success:** Active mode injects status line with next sleep time
- **sleep-cycle.AC6.2 Success:** Sleep mode injects contemplative tone guidance, time, next wake, and queue stats
- **sleep-cycle.AC6.3 Success:** Sleep mode includes flagged event source and timestamp summaries
- **sleep-cycle.AC6.4 Edge:** Context provider returns `undefined` when activity feature is disabled

### sleep-cycle.AC4: Soft bypass for high-priority events
- **sleep-cycle.AC4.2 Success:** Flagged event count and summaries appear in context provider output during sleep tasks
- **sleep-cycle.AC4.3 Success:** Flagged events are not auto-processed — agent sees them and decides
- **sleep-cycle.AC4.4 Edge:** Zero flagged events produces clean context output (no empty section)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create activity context provider

**Files:**
- Create: `src/activity/context-provider.ts`

**Implementation:**

Follow the cached async refresh pattern from `src/reflexion/context-provider.ts` (lines 11-45). Annotate with `// pattern: Imperative Shell` (same as the prediction context provider, since it performs async I/O).

Factory signature:
```typescript
export function createActivityContextProvider(
  activityManager: ActivityManager,
): ContextProvider
```

Import `ContextProvider` from `../agent/types.ts` and `ActivityManager`, `QueuedEvent` from `./types.ts`.

**Cache pattern** (identical to prediction context provider):
- `CACHE_TTL = 60_000` (60 seconds, matching scheduler tick interval per design)
- Closure state: `cached: { result: string | undefined; timestamp: number } | null = null`
- `refreshing = false` flag to prevent concurrent refreshes
- `refresh()` function:
  1. If `refreshing`, return
  2. Set `refreshing = true`
  3. Call `activityManager.getState()` and `activityManager.getFlaggedEvents()` via `Promise.all`
  4. In `.then()`: format the result string based on mode, store in `cached`
  5. In `.catch()`: log warning, don't update cache
  6. In `.finally()`: reset `refreshing = false`

**Format logic** (inside the `.then()`):

For **active mode**:
```
[Activity] Status: active | Next sleep: {nextTransitionAt formatted as ISO string}
```

For **sleeping mode**:
```
[Activity] Status: sleeping | Next wake: {nextTransitionAt formatted as ISO string}
Queued events: {queuedEventCount} | Flagged: {flaggedEventCount}

[Circadian Guidance]
You are in sleep mode. Focus on reflective, contemplative processing:
- Review and consolidate memories rather than acquiring new information
- Evaluate pending predictions and past decisions
- Identify patterns across recent interactions
- Prefer depth of thought over breadth of action

{flagged event section, only if flaggedEventCount > 0}
```

**Flagged event section** (only when `flaggedEventCount > 0`):
```
[Flagged Events]
These high-priority events arrived during sleep. Review and decide if action is needed:
- [{source}] at {enqueuedAt ISO string}
- [{source}] at {enqueuedAt ISO string}
```

If `flaggedEventCount === 0`, omit the `[Flagged Events]` section entirely (sleep-cycle.AC4.4).

**Return function**: Same pattern as prediction context provider — check cache freshness, trigger refresh if stale, return `cached?.result`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): add activity context provider with cached async refresh`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Export context provider from barrel

**Files:**
- Modify: `src/activity/index.ts` (add export)

**Implementation:**

Add to the barrel export:
```typescript
export { createActivityContextProvider } from './context-provider.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(activity): export context provider from barrel`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Activity context provider tests

**Verifies:** sleep-cycle.AC6.1, sleep-cycle.AC6.2, sleep-cycle.AC6.3, sleep-cycle.AC6.4, sleep-cycle.AC4.2, sleep-cycle.AC4.3, sleep-cycle.AC4.4

**Files:**
- Create: `src/activity/context-provider.test.ts`

**Testing:**

This can be tested with mock `ActivityManager` (no database needed) since the context provider only calls `getState()` and `getFlaggedEvents()` on the interface. Follow the inline mock pattern used in `src/agent/agent.test.ts`.

Create a helper function that returns a mock `ActivityManager` with configurable state:
```typescript
function createMockActivityManager(overrides: {
  mode?: 'active' | 'sleeping';
  nextTransitionAt?: Date | null;
  queuedEventCount?: number;
  flaggedEventCount?: number;
  flaggedEvents?: ReadonlyArray<QueuedEvent>;
}): ActivityManager
```

Tests must verify each AC listed above:

- sleep-cycle.AC6.1: Create provider with mock in active mode. Wait for async refresh (use a short delay or flush promises). Call provider, verify output contains `[Activity] Status: active` and next sleep time.
- sleep-cycle.AC6.2: Create provider with mock in sleeping mode with queue stats. Verify output contains `[Activity] Status: sleeping`, `[Circadian Guidance]`, queue counts.
- sleep-cycle.AC6.3: Create provider with mock in sleeping mode with flagged events. Verify output contains `[Flagged Events]` section with source and timestamp for each flagged event.
- sleep-cycle.AC6.4: This AC verifies the disabled case — `createActivityContextProvider` is never called when activity is disabled, so no context is injected. Test this by verifying the provider factory is a standalone function with no side effects: create a provider, verify the first call returns `undefined` (cache is empty before first refresh), confirming no injection occurs until async refresh completes. This proves the provider is inert until explicitly wired. The composition root (Phase 7) conditionally creates the provider only when `config.activity?.enabled`.
- sleep-cycle.AC4.2: Same as AC6.3 — flagged event summaries appear in sleep context.
- sleep-cycle.AC4.3: Flagged events are surfaced via the context provider for the agent to review — they are not auto-processed. Verify that the context output includes flagged event details with source and timestamp, presented as informational (agent decides what to do). The context provider's role is to make flagged events visible; it does not trigger processing. This is the "not auto-processed" guarantee — events are shown, not acted on.
- sleep-cycle.AC4.4: Create provider with mock in sleeping mode, zero flagged events. Verify output does NOT contain `[Flagged Events]` section.

**Note on async testing:** The context provider returns stale cache on first call. To test the formatted output, either:
- Call the provider, wait briefly (`await Bun.sleep(50)`), then call again
- Or directly test the formatting logic if extracted to a pure function

**Verification:**
Run: `bun test src/activity/context-provider.test.ts`
Expected: All tests pass

**Commit:** `test(activity): add context provider tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
