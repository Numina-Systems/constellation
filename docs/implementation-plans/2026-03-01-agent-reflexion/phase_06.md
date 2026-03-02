# Agent Reflexion Implementation Plan

**Goal:** Add a ContextProvider mechanism to the agent loop and implement a prediction status context provider that injects prediction counts into the system prompt.

**Architecture:** Introduce `ContextProvider` type (`() => string | undefined`) to agent types, modify `buildSystemPrompt` to accept providers, create a cached prediction count provider using Map+timestamp pattern from `src/web/fetch.ts`.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC5: Wiring & Context
- **agent-reflexion.AC5.1 Success:** Prediction context provider injects status line into system prompt when predictions exist
- **agent-reflexion.AC5.2 Edge:** Context provider returns `undefined` (no injection) when no predictions exist

---

## Phase 6: Prediction Context Provider

**Goal:** System prompt injection showing prediction status via a cached context provider.

**Key investigation findings:**
- `ContextProvider` type does NOT exist on this branch (only on `rate-limiter`). This phase introduces it.
- `buildSystemPrompt` in `src/agent/context.ts` currently only calls `memory.buildSystemPrompt()` — needs extension to accept context providers.
- `AgentDependencies` in `src/agent/types.ts` has 8 fields (2 optional). This phase adds `contextProviders`.
- The agent calls `buildSystemPrompt(deps.memory)` at `src/agent/agent.ts:91`. After this phase, it will also pass context providers.
- Existing caching pattern: Map + `Date.now()` timestamp + lazy eviction (see `src/web/fetch.ts`).

**CLAUDE.md files to read before implementation:**
- `src/agent/CLAUDE.md` — Agent loop contracts and system prompt guarantees
- `src/memory/CLAUDE.md` — Memory manager interface (buildSystemPrompt)

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Add ContextProvider type and contextProviders to AgentDependencies

**Files:**
- Modify: `src/agent/types.ts` (add ContextProvider type and field to AgentDependencies)

**Implementation:**

Add the `ContextProvider` type after the `ExternalEvent` type (around line 40):

```typescript
export type ContextProvider = () => string | undefined;
```

Add `contextProviders` as an optional field to `AgentDependencies`:

```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  getExecutionContext?: () => ExecutionContext;
  compactor?: Compactor;
  traceRecorder?: TraceRecorder;   // Added in Phase 4
  owner?: string;                  // Added in Phase 4
  contextProviders?: ReadonlyArray<ContextProvider>;
};
```

Note: `traceRecorder` and `owner` are added by Phase 4. If Phase 4 has already been executed, both will be present. If not, `contextProviders` goes after whatever the last field is.

Update `src/agent/index.ts` to re-export `ContextProvider` if not already exported:

```typescript
export type { ContextProvider } from './types.ts';
```

**Verification:**

Run: `bun run build`
Expected: No type errors (field is optional, no callers break)

Run: `bun test`
Expected: All existing tests still pass

**Commit:** `feat(agent): add ContextProvider type and contextProviders to AgentDependencies`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend buildSystemPrompt to accept context providers

**Files:**
- Modify: `src/agent/context.ts` (extend `buildSystemPrompt` signature)
- Modify: `src/agent/agent.ts` (pass context providers to `buildSystemPrompt`)

**Implementation:**

In `src/agent/context.ts`, modify `buildSystemPrompt` to accept optional context providers:

```typescript
export async function buildSystemPrompt(
  memory: MemoryManager,
  contextProviders?: ReadonlyArray<ContextProvider>,
): Promise<string> {
  let prompt = await memory.buildSystemPrompt();

  if (contextProviders) {
    for (const provider of contextProviders) {
      const line = provider();
      if (line !== undefined) {
        prompt += `\n\n${line}`;
      }
    }
  }

  return prompt;
}
```

Add the import at the top of `context.ts`:

```typescript
import type { ContextProvider } from './types.ts';
```

In `src/agent/agent.ts`, update the call site (around line 91) to pass context providers:

Change:
```typescript
const systemPrompt = await buildSystemPrompt(deps.memory);
```

To:
```typescript
const systemPrompt = await buildSystemPrompt(deps.memory, deps.contextProviders);
```

**Verification:**

Run: `bun run build`
Expected: No type errors

Run: `bun test`
Expected: All existing tests still pass (contextProviders is optional, existing callers pass undefined)

**Commit:** `feat(agent): extend buildSystemPrompt to inject context provider output`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Implement prediction context provider

**Verifies:** agent-reflexion.AC5.1, agent-reflexion.AC5.2

**Files:**
- Create: `src/reflexion/context-provider.ts`

**Implementation:**

Create `createPredictionContextProvider(store, owner)` returning `ContextProvider`. The file must be `// pattern: Imperative Shell` (database I/O via store).

Factory signature:

```typescript
import type { PredictionStore } from './types.ts';
import type { ContextProvider } from '../agent/types.ts';

export function createPredictionContextProvider(
  store: PredictionStore,
  owner: string,
): ContextProvider
```

The provider:
1. Calls `store.listPredictions(owner, 'pending', 50)` to get pending predictions
2. If empty, returns `undefined` (AC5.2 — no injection when no predictions exist)
3. If predictions exist, returns a formatted status line, e.g.:
   ```
   [Prediction Journal] You have 3 pending predictions awaiting review.
   ```
4. Caches the result for 5 minutes using the Map+timestamp pattern from `src/web/fetch.ts`:
   - Store `{ result: string | undefined, timestamp: number }` in a closure variable (no need for a Map since there's only one cached value)
   - On each call, check if `Date.now() - timestamp < 300_000` (5 minutes). If fresh, return cached result.
   - If stale or first call, query the store and update cache.

**Important:** The `ContextProvider` type is synchronous (`() => string | undefined`). Since the prediction count requires a DB query (async), the cache must be primed asynchronously. Use a fire-and-forget async refresh pattern:
- The provider synchronously returns the last cached value (or `undefined` on first call)
- Triggers an async refresh in the background when cache is stale
- The next call after the refresh completes will see the updated value

```typescript
export function createPredictionContextProvider(
  store: PredictionStore,
  owner: string,
): ContextProvider {
  const CACHE_TTL = 300_000; // 5 minutes
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    store
      .listPredictions(owner, 'pending', 50)
      .then((predictions) => {
        const result =
          predictions.length > 0
            ? `[Prediction Journal] You have ${predictions.length} pending prediction${predictions.length === 1 ? '' : 's'} awaiting review.`
            : undefined;
        cached = { result, timestamp: Date.now() };
      })
      .catch((error) => {
        console.warn('prediction context provider: failed to refresh', error);
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
}
```

Update the barrel export in `src/reflexion/index.ts` to include:
```typescript
export { createPredictionContextProvider } from './context-provider.ts';
```

**Verification:**

Run: `bun run build`
Expected: No type errors

**Commit:** `feat(reflexion): add cached prediction context provider`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for context provider integration and prediction provider

**Verifies:** agent-reflexion.AC5.1, agent-reflexion.AC5.2

**Files:**
- Create: `src/reflexion/context-provider.test.ts`
- Create: `src/agent/context-providers.test.ts`

**Testing:**

**`src/agent/context-providers.test.ts`** — Unit tests for `buildSystemPrompt` with context providers. No DB needed — mock the memory manager.

Tests must verify:
- `buildSystemPrompt` with no context providers returns memory prompt unchanged
- `buildSystemPrompt` with a context provider that returns a string appends it to the prompt
- `buildSystemPrompt` with a context provider that returns `undefined` does not append anything
- `buildSystemPrompt` with multiple providers appends all non-undefined values

**`src/reflexion/context-provider.test.ts`** — Unit tests for `createPredictionContextProvider` using a mock `PredictionStore`. No DB needed.

Tests must verify:
- **agent-reflexion.AC5.1:** Create provider with a mock store that returns 3 pending predictions. Call the provider — first call returns `undefined` (cache not yet primed). Wait briefly for async refresh (`await Bun.sleep(50)`). Call again — returns status line containing "3 pending predictions".
- **agent-reflexion.AC5.2:** Create provider with a mock store that returns empty array. Trigger cache prime. Verify provider returns `undefined`.
- **Cache behaviour:** Create provider, prime the cache. Call the store mock count to verify it was called once. Call provider again within 5 minutes — verify store is NOT called again (cache hit).
- **Error resilience:** Create provider with a mock store whose `listPredictions` throws. Verify provider returns `undefined` (doesn't throw) and a warning is logged.

**Verification:**

Run: `bun test src/reflexion/context-provider.test.ts src/agent/context-providers.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: No type errors

**Commit:** `test(reflexion): add context provider tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
