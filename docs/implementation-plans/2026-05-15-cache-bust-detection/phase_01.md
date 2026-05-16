# Cache-Bust Detection Implementation Plan — Phase 1

**Goal:** Implement core dimension hashing and comparison logic for cache-sensitive dimensions.

**Architecture:** Functional Core module using `Bun.hash()` for fast non-cryptographic hashing. Factory function `createCacheDiagnostics()` returns a stateful object that tracks previous turn hashes and detects changes. No I/O — pure in-memory state mutation.

**Tech Stack:** Bun (TypeScript), `Bun.hash()` for hashing

**Scope:** 3 phases from original design (phase 1 of 3)

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-bust-detection.AC1: Dimension Snapshotting
- **cache-bust-detection.AC1.1 Success:** System prompt content is hashed and stored before each model call
- **cache-bust-detection.AC1.2 Success:** Tool definitions (serialized) are hashed and stored before each model call
- **cache-bust-detection.AC1.3 Success:** Message prefix (all messages except the last) is hashed and stored
- **cache-bust-detection.AC1.4 Success:** Beta headers (if any) are hashed and stored
- **cache-bust-detection.AC1.5 Edge:** First turn has no previous snapshot — no comparison is performed, no warning emitted

### cache-bust-detection.AC2: Change Detection
- **cache-bust-detection.AC2.1 Success:** System prompt content change between turns triggers a warning with dimension name `"system_prompt"`
- **cache-bust-detection.AC2.2 Success:** Tool definition change triggers a warning with dimension name `"tool_definitions"`
- **cache-bust-detection.AC2.3 Success:** Message prefix mutation (reordering, editing, deletion) triggers a warning with dimension name `"message_prefix"`
- **cache-bust-detection.AC2.4 Success:** Warning includes a diff summary: which dimension changed and an approximate content delta size (character count difference)
- **cache-bust-detection.AC2.5 Success:** Multiple dimensions changing in the same turn produce one warning per dimension, not one aggregate warning

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Types and factory skeleton

**Verifies:** None (type scaffolding)

**Files:**
- Create: `src/agent/cache-diagnostics.ts`

**Implementation:**

Create the module with type definitions and an empty factory function. Types defined in this file (not `types.ts`), following the pattern used by `src/agent/snapshot.ts` which defines `SnapshotMode`, `SnapshotResult`, `SnapshotState` locally.

```typescript
// pattern: Functional Core

export type CacheDimension =
  | 'system_prompt'
  | 'tool_definitions'
  | 'message_prefix'
  | 'beta_headers';

export type CacheBustEvent = {
  readonly dimension: CacheDimension;
  readonly previousSize: number;
  readonly currentSize: number;
  readonly delta: number;
  readonly turn: number;
};

export type SuppressionFlags = {
  readonly compactionOccurred?: boolean;
  readonly toolsChanged?: boolean;
  readonly isFirstTurn?: boolean;
};

type DimensionSnapshot = {
  readonly hash: bigint;
  readonly size: number;
};

type MessagePrefixState = {
  readonly messageHashes: ReadonlyArray<bigint>;
  readonly prefixLength: number;
  readonly totalSize: number;
};

export type CacheDiagnostics = {
  checkForCacheBust(
    systemPrompt: string,
    tools: ReadonlyArray<unknown>,
    messages: ReadonlyArray<unknown>,
    betaHeaders: ReadonlyArray<string> | undefined,
    turn: number,
    flags: SuppressionFlags,
  ): ReadonlyArray<CacheBustEvent>;
  reset(): void;
};
```

The factory skeleton (export as named export):

```typescript
export function createCacheDiagnostics(): CacheDiagnostics {
  let previousHashes: Map<CacheDimension, DimensionSnapshot> | null = null;
  let previousPrefixState: MessagePrefixState | null = null;

  return {
    checkForCacheBust(systemPrompt, tools, messages, betaHeaders, turn, flags) {
      return [];
    },
    reset() {
      previousHashes = null;
      previousPrefixState = null;
    },
  };
}
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): add cache-diagnostics types and factory skeleton`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Dimension hashing and comparison logic

**Verifies:** cache-bust-detection.AC1.1, cache-bust-detection.AC1.2, cache-bust-detection.AC1.3, cache-bust-detection.AC1.4, cache-bust-detection.AC1.5, cache-bust-detection.AC2.1, cache-bust-detection.AC2.2, cache-bust-detection.AC2.3, cache-bust-detection.AC2.4, cache-bust-detection.AC2.5

**Files:**
- Modify: `src/agent/cache-diagnostics.ts`

**Implementation:**

Fill in the `checkForCacheBust` method with dimension hashing and comparison. Add these internal helpers above the factory function:

**`hashContent(value: string): DimensionSnapshot`** — Hashes a string using `Bun.hash()` (returns `bigint` natively, same pattern as `src/agent/snapshot.ts:35-40`). Returns `{ hash: BigInt(Bun.hash(value)), size: value.length }`.

**`serializeTools(tools: ReadonlyArray<unknown>): string`** — Creates a stable serialization by sorting tools by `name` property before `JSON.stringify`. Use `Array.from(tools).sort(...)` to avoid mutating the input. Cast elements to `{ name?: string }` for the sort comparator.

**`computeMessagePrefixState(messages: ReadonlyArray<unknown>): MessagePrefixState`** — Takes all messages except the last (the prefix). Hashes each message individually with `BigInt(Bun.hash(JSON.stringify(msg)))`. Returns `{ messageHashes, prefixLength, totalSize }` where `totalSize` is the sum of each serialized message's length.

**`serializeBetaHeaders(headers: ReadonlyArray<string> | undefined): string`** — If undefined or empty, returns empty string. Otherwise sorts the array and joins with `,`.

**Comparison logic inside `checkForCacheBust`:**

1. Compute current hashes for `system_prompt`, `tool_definitions`, `beta_headers` using the helpers above.
2. Compute current `MessagePrefixState`.
3. If `previousHashes` is null (first call): store all current state, return empty array.
4. Otherwise, for each scalar dimension (`system_prompt`, `tool_definitions`, `beta_headers`):
   - Compare current hash against previous hash.
   - If different, create a `CacheBustEvent` with the dimension name, previous size, current size, and delta (`currentSize - previousSize`).
5. For `message_prefix`:
   - Get the overlap length: `Math.min(previousPrefixState.prefixLength, currentPrefixState.prefixLength)`.
   - Compare message hashes for indices `0..overlap-1`.
   - If any hash in the overlapping range differs, OR if `currentPrefixState.prefixLength < previousPrefixState.prefixLength` (messages were deleted), produce a `CacheBustEvent`.
   - Merely appending new messages (current prefix longer, overlap matches) is NOT a cache bust.
   - For the event's `previousSize`/`currentSize`, use the **full prefix `totalSize`** (not overlapping-only). `previousSize` is the previous prefix's total serialized size, `currentSize` is the current prefix's total serialized size. This matches the design's "approximate content delta size (character count difference)" language and correctly reflects the magnitude of change even for deletions.
6. Collect all events into an array. Store current hashes/state. Return events.

Note: Suppression flags are NOT applied in Phase 1. The `flags` parameter is accepted but ignored — suppression is Phase 2.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): implement dimension hashing and comparison in cache-diagnostics`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for dimension hashing and change detection

**Verifies:** cache-bust-detection.AC1.1, cache-bust-detection.AC1.2, cache-bust-detection.AC1.3, cache-bust-detection.AC1.4, cache-bust-detection.AC1.5, cache-bust-detection.AC2.1, cache-bust-detection.AC2.2, cache-bust-detection.AC2.3, cache-bust-detection.AC2.4, cache-bust-detection.AC2.5

**Files:**
- Create: `src/agent/cache-diagnostics.test.ts`

**Testing:**

Follow project patterns from `src/agent/snapshot.test.ts` — organize by AC numbers in `describe` blocks. Use `bun:test` imports (`describe`, `test`, `expect`, `beforeEach`). Annotate file with `// pattern: Functional Core`.

Create a fresh `CacheDiagnostics` instance in `beforeEach` for test isolation. Use `SuppressionFlags` with all flags `undefined`/`false` for Phase 1 tests (suppression is Phase 2).

Tests must verify each AC:

- **cache-bust-detection.AC1.1:** Call `checkForCacheBust` with a system prompt, then call again with same prompt — no event for `system_prompt`. Change the prompt — event IS produced.
- **cache-bust-detection.AC1.2:** Same pattern for tools — identical tools (same content) produce no event, changed tools produce an event.
- **cache-bust-detection.AC1.3:** Identical message prefix produces no event. Mutated prefix (edit existing message) produces an event. Merely appending a new message (prefix grows by one) does NOT produce an event.
- **cache-bust-detection.AC1.4:** Identical beta headers produce no event, changed headers produce an event. Test with `undefined` beta headers.
- **cache-bust-detection.AC1.5:** First call returns empty array regardless of input content.
- **cache-bust-detection.AC2.1:** Event has `dimension: 'system_prompt'` when system prompt changes.
- **cache-bust-detection.AC2.2:** Event has `dimension: 'tool_definitions'` when tools change.
- **cache-bust-detection.AC2.3:** Event has `dimension: 'message_prefix'` when a message in the prefix is edited, reordered, or deleted.
- **cache-bust-detection.AC2.4:** Event includes correct `previousSize`, `currentSize`, and `delta` reflecting character count differences.
- **cache-bust-detection.AC2.5:** Change both system prompt and tools simultaneously — verify two separate events returned, one per dimension.

Additional edge case tests:
- `reset()` clears state — after reset, next call behaves like first turn (no events).
- Tool ordering stability — tools in different array order but same names produce no event (sorted before hashing).
- Empty system prompt transitions (empty to non-empty, non-empty to empty).
- Empty messages array (no prefix to compare).
- Message deletion in prefix (prefix shrinks) produces event.

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add unit tests for cache-diagnostics dimension hashing and change detection`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Add exports to agent module barrel

**Verifies:** None (module wiring)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add exports for the cache-diagnostics module to `src/agent/index.ts`, following the existing pattern which separates type exports from implementation exports (see existing lines like `export type { SnapshotMode, ... } from './snapshot.ts'` and `export { createSnapshotState } from './snapshot.ts'`):

```typescript
export type { CacheDiagnostics, CacheDimension, CacheBustEvent, SuppressionFlags } from './cache-diagnostics.ts';
export { createCacheDiagnostics } from './cache-diagnostics.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): export cache-diagnostics from agent module barrel`

<!-- END_TASK_4 -->
