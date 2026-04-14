# Subconscious Implementation Plan — Phase 5: Subconscious Context Provider

**Goal:** Main agent sees recent subconscious activity per-turn via `[Inner Life]` summary injected into system prompt.

**Architecture:** Context provider factory in `src/subconscious/context.ts` following the async-refresh TTL caching pattern from `src/reflexion/context-provider.ts` and `src/activity/context-provider.ts`. Returns `() => string | undefined`.

**Tech Stack:** TypeScript (Bun), bun:test

**Scope:** 7 phases from original design (phase 5 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC4: Both agents can interact with interests and see each other's activity
- **subconscious.AC4.5 Success:** Main agent's system prompt includes [Inner Life] section with active interests and recent explorations
- **subconscious.AC4.6 Edge:** Context provider returns undefined when no subconscious activity exists (no [Inner Life] section injected)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Subconscious context provider

**Verifies:** None directly (tested in Task 2)

**Files:**
- Create: `src/subconscious/context.ts`

**Implementation:**

Create with pattern annotation `// pattern: Imperative Shell`.

Follow the exact caching pattern from `src/reflexion/context-provider.ts`:

```typescript
import type { ContextProvider } from '../agent/types.ts';
import type { InterestRegistry } from './types.ts';
```

Export factory function:

```typescript
export function createSubconsciousContextProvider(
  registry: InterestRegistry,
  owner: string,
): ContextProvider
```

**Caching pattern** (copy from prediction context provider):

```typescript
const CACHE_TTL = 120_000; // 2 minutes — subconscious activity changes less frequently than activity state
let cached: { result: string | undefined; timestamp: number } | null = null;
let refreshing = false;

function refresh(): void {
  if (refreshing) return;
  refreshing = true;
  Promise.all([
    registry.listInterests(owner, { status: 'active' }),
    registry.listExplorationLog(owner, 5),
    registry.listInterests(owner, { status: 'dormant' }),
  ])
    .then(([activeInterests, recentExplorations, dormantInterests]) => {
      // If no activity at all, return undefined
      if (activeInterests.length === 0 && recentExplorations.length === 0) {
        cached = { result: undefined, timestamp: Date.now() };
        return;
      }

      cached = { result: formatInnerLife(activeInterests, recentExplorations, dormantInterests), timestamp: Date.now() };
    })
    .catch((error) => {
      console.warn('[subconscious] context provider refresh failed:', error);
    })
    .finally(() => {
      refreshing = false;
    });
}

return () => {
  if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
    refresh();
  }
  return cached?.result;
};
```

**Format function** (pure, same file):

```typescript
function formatInnerLife(
  activeInterests: ReadonlyArray<Interest>,
  recentExplorations: ReadonlyArray<ExplorationLogEntry>,
  dormantInterests: ReadonlyArray<Interest>,
): string
```

Output format:

```
[Inner Life]
Active interests:
- {name} (engagement: {score}): {description}
- ...

Recent explorations:
- [{time}] {action}: {outcome}
- ...

Dormant interests: {count} ({name}, {name}, ...)
```

Rules:
- If no active interests, omit the "Active interests" subsection
- If no recent explorations, omit the "Recent explorations" subsection
- If no dormant interests, omit the "Dormant interests" line
- Truncate exploration outcomes to 100 chars
- Format engagement scores to 1 decimal place
- Dormant interests: show count and first 3 names only

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add subconscious context provider`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Subconscious context provider tests

**Verifies:** subconscious.AC4.5, subconscious.AC4.6

**Files:**
- Create: `src/subconscious/context.test.ts`

**Testing:**

Use mock `InterestRegistry` (same pattern as Phase 2 tool tests). The context provider is synchronous on the read path but triggers async refresh internally.

**subconscious.AC4.5:** Main agent's system prompt includes [Inner Life] section with active interests and recent explorations
- `describe('subconscious.AC4.5: Inner Life context injection')`:
  - `it('formats active interests with engagement scores')` — configure mock with active interests, trigger refresh (call provider, wait briefly with `await Bun.sleep(10)` for async completion, call again), verify output contains `[Inner Life]`, interest names, and scores.
  - `it('includes recent explorations')` — configure mock with exploration log entries, verify output contains exploration actions and outcomes.
  - `it('shows dormant interest count')` — configure mock with dormant interests, verify output contains count and names.
  - `it('caches result within TTL')` — call provider, mutate mock data, call again immediately, verify same result (cached). Note: mock should track call counts to verify no re-fetch.

**subconscious.AC4.6:** Context provider returns undefined when no subconscious activity exists
- `describe('subconscious.AC4.6: Empty state handling')`:
  - `it('returns undefined when no interests or explorations exist')` — configure mock with empty arrays for all queries, trigger refresh, verify provider returns `undefined`.
  - `it('returns undefined on first call before refresh completes')` — create fresh provider, call immediately (before async refresh), verify returns `undefined` (no cached data yet).

**Verification:**
Run: `bun test src/subconscious/context.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add context provider tests`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire context provider into main agent

**Verifies:** None (infrastructure — verified by integration)

**Files:**
- Modify: `src/subconscious/index.ts` — export `createSubconsciousContextProvider`
- Modify: `src/index.ts` — inject context provider into main agent

**Implementation:**

Update `src/subconscious/index.ts` to export:
```typescript
export { createSubconsciousContextProvider } from './context.ts';
```

In `src/index.ts`, when subconscious is enabled (after creating the interest registry from Phase 2):

1. Create the context provider:
```typescript
const subconsciousContextProvider = createSubconsciousContextProvider(
  interestRegistry,
  AGENT_OWNER,
);
```

2. Add it to the main agent's context providers array:
```typescript
contextProviders: [
  ...contextProviders,
  predictionContextProvider,
  schedulingContextProvider,
  subconsciousContextProvider,  // NEW: [Inner Life] section
],
```

The subconscious context provider is injected into the **main** agent only (not the subconscious agent itself — it doesn't need to see its own summary).

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): wire context provider into main agent`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
