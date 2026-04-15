# Introspection Loop Implementation Plan - Phase 3: Introspection Context Provider

**Goal:** Context provider that reads the `introspection-digest` memory block and surfaces it as `[Unformalised Observations]` in both agents' system prompts

**Architecture:** Follows the established context provider pattern from `src/subconscious/context.ts` — factory function returns synchronous `ContextProvider`, background async refresh with 2-minute TTL cache, returns `undefined` when no data exists.

**Tech Stack:** TypeScript, Bun, bun:test

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### introspection-loop.AC2: Context provider surfaces digest in system prompt
- **introspection-loop.AC2.1 Success:** `[Unformalised Observations]` section appears in system prompt when digest block exists
- **introspection-loop.AC2.2 Success:** Both main agent and subconscious agent receive the section
- **introspection-loop.AC2.3 Failure:** Context provider returns `undefined` when no digest block exists (first run)
- **introspection-loop.AC2.4 Edge:** Stale digest from previous daemon run is surfaced on restart (continuity preserved)

### introspection-loop.AC3: No schema migrations required
- **introspection-loop.AC3.1 Success:** Digest stored as `readwrite` working-tier memory block via existing `memory.write()`
  - *Note:* AC3.1 is satisfied by design — the existing `memory_write` tool defaults to working tier with readwrite permission. The subconscious agent uses this tool to write the digest block. This is an integration-level concern verified operationally, not via unit tests.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: createIntrospectionContextProvider implementation

**Verifies:** introspection-loop.AC2.1, introspection-loop.AC2.3, introspection-loop.AC2.4

**Files:**
- Create: `src/subconscious/introspection-context.ts`

**Implementation:**

Create `src/subconscious/introspection-context.ts` with `// pattern: Imperative Shell` header.

Follow the exact caching pattern from `context.ts:12-54`:

```typescript
import type { ContextProvider } from '@/agent/types';
import type { MemoryStore } from '@/memory/store';

export function createIntrospectionContextProvider(
  memoryStore: MemoryStore,
  owner: string,
): ContextProvider {
  const CACHE_TTL = 120_000; // 2 minutes
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    memoryStore
      .getBlockByLabel(owner, 'introspection-digest')
      .then((block) => {
        if (!block || !block.content.trim()) {
          cached = { result: undefined, timestamp: Date.now() };
          return;
        }
        cached = {
          result: `[Unformalised Observations]\n${block.content}`,
          timestamp: Date.now(),
        };
      })
      .catch((error) => {
        console.warn('[introspection] context provider refresh failed:', error);
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

Key design notes:
- Uses `MemoryStore.getBlockByLabel(owner, 'introspection-digest')` — direct label lookup, not semantic search
- Returns `undefined` when block doesn't exist (AC2.3 — first run, section not injected)
- Returns `undefined` when block content is empty/whitespace
- On daemon restart, the block persists in the database. First call triggers refresh, which reads the stale block and surfaces it (AC2.4 — continuity preserved)
- AC2.2 (both agents receive the section) is handled by Phase 4 wiring — this provider is registered in both agents' `contextProviders` arrays

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): add introspection context provider`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Barrel export additions

**Files:**
- Modify: `src/subconscious/index.ts`

**Implementation:**

Add the export for the new context provider (the Phase 1 and Phase 2 exports should already be in the barrel from those phases):

```typescript
export { createIntrospectionContextProvider } from './introspection-context.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): export introspection context provider from barrel`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Introspection context provider tests

**Verifies:** introspection-loop.AC2.1, introspection-loop.AC2.3, introspection-loop.AC2.4, introspection-loop.AC3.1

**Files:**
- Create: `src/subconscious/introspection-context.test.ts`

**Testing:**

Create mock `MemoryStore` — only `getBlockByLabel` needs real implementation; other methods can be no-op stubs. The `MemoryStore` interface is at `src/memory/store.ts:17-45`.

Tests must verify:

- **introspection-loop.AC2.1:** When `getBlockByLabel('introspection-digest')` returns a block with content `"Half-formed thought about X"`, the provider eventually returns a string containing `[Unformalised Observations]` and the content. Use `await Bun.sleep(10)` or similar to allow the background refresh to complete, then call the provider again.

- **introspection-loop.AC2.3:** When `getBlockByLabel('introspection-digest')` returns `null`, the provider returns `undefined`. This is the first-run case.

- **introspection-loop.AC2.4:** When `getBlockByLabel` returns a block (simulating a stale digest from a previous daemon run), the provider surfaces it. Create the provider, call it once (triggers refresh), wait for refresh, call again — verify the stale content appears.

- **introspection-loop.AC3.1:** Verify `getBlockByLabel` is called with `(owner, 'introspection-digest')` — capture the call params to confirm label-based lookup.

Additional tests:
- Empty content string: `getBlockByLabel` returns a block with `content: ''` — provider returns `undefined`
- Whitespace-only content: `getBlockByLabel` returns a block with `content: '   '` — provider returns `undefined`
- Cache TTL: Call provider twice rapidly — verify `getBlockByLabel` is only called once (second call uses cache)
- Provider is synchronous: the return type is `string | undefined`, not a Promise

**Verification:**
Run: `bun test src/subconscious/introspection-context.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add introspection context provider tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
