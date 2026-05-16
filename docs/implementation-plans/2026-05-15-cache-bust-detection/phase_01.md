# Cache-Bust Detection Implementation Plan

**Goal:** Implement the core hashing and comparison logic for cache-sensitive dimensions (system prompt, tool definitions, message prefix, beta headers).

**Architecture:** Functional Core module with a stateful `CacheDiagnostics` object that holds previous-turn dimension hashes. Uses `Bun.hash()` for fast non-cryptographic hashing. Message prefix comparison uses per-message hashing of the overlapping subsequence to avoid false positives from normal message appending.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 1 of 3

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

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Types and factory skeleton

**Verifies:** None (type-only, compiler verifies)

**Files:**
- Create: `src/agent/cache-diagnostics.ts`

**Implementation:**

Create `src/agent/cache-diagnostics.ts` with the following types and factory skeleton:

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

The factory function `createCacheDiagnostics()` should be declared but left as a stub that throws — Task 2 fills in the implementation.

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
- Create: `src/agent/cache-diagnostics.test.ts`

**Implementation:**

Implement `createCacheDiagnostics()` in `src/agent/cache-diagnostics.ts`. Internal state:

```typescript
type DimensionSnapshot = {
  hash: bigint;
  size: number;
};

type PrefixSnapshot = {
  messageHashes: ReadonlyArray<bigint>;
  totalSize: number;
};
```

The factory holds two pieces of mutable state:
- `previousDimensions: Map<CacheDimension, DimensionSnapshot> | null` — hashes for system_prompt, tool_definitions, beta_headers
- `previousPrefix: PrefixSnapshot | null` — per-message hashes for the message prefix

**Dimension hashing (internal helpers, not exported):**

1. `hashSystemPrompt(content: string): DimensionSnapshot` — `Bun.hash(content)` returns bigint, size is `content.length`.

2. `hashToolDefinitions(tools: ReadonlyArray<unknown>): DimensionSnapshot` — Sort tools by the `name` property (cast each element to `{ name: string }` for sorting only). `JSON.stringify()` the sorted array. Hash the resulting string. Size is the stringified length.

3. `hashMessagePrefix(messages: ReadonlyArray<unknown>): PrefixSnapshot` — The prefix is all messages except the last. For each message in the prefix, `JSON.stringify()` and hash individually. Store the array of per-message hashes. Size is the sum of all stringified message lengths.

4. `hashBetaHeaders(headers: ReadonlyArray<string> | undefined): DimensionSnapshot | null` — If undefined or empty, return null. Otherwise sort headers, join with `,`, hash. Size is the joined string length.

**Comparison logic inside `checkForCacheBust()`:**

For `system_prompt`, `tool_definitions`, `beta_headers`: compare the current `DimensionSnapshot.hash` against the stored one. If different, emit a `CacheBustEvent` with `previousSize` and `currentSize` from the snapshots, `delta = currentSize - previousSize`.

For `message_prefix`: compare the overlapping subsequence. Let `prevLen` be the length of the previous prefix's `messageHashes` array. Compare each hash at indices `0..prevLen-1` against the current prefix's hashes at the same indices. If any hash differs, emit a `CacheBustEvent`. The `previousSize` is the previous prefix's `totalSize`, `currentSize` is the sum of stringified lengths for only the first `prevLen` messages of the current prefix (the overlapping portion). This avoids a false positive from appended messages.

**Important:** If `previousDimensions` is null (first call), store all hashes and return an empty array — no events on first turn regardless of `isFirstTurn` flag. The `isFirstTurn` flag is for suppression logic in Phase 2 and is ignored in this phase.

After comparison, update all stored hashes/snapshots with the current values.

`reset()` sets both state variables to null.

**Testing:**

Create `src/agent/cache-diagnostics.test.ts` with the following test cases:

```
describe('cache-diagnostics', () => {
  describe('AC1: Dimension Snapshotting', () => {
    // AC1.5: First call stores hashes, returns empty events
    test('first call returns no events')

    // AC1.1-AC1.4: Second identical call returns no events (hashes match)
    test('identical inputs on second call return no events')
  })

  describe('AC2: Change Detection', () => {
    // AC2.1: System prompt change
    test('system prompt change produces event with dimension "system_prompt"')

    // AC2.2: Tool definition change
    test('tool definition change produces event with dimension "tool_definitions"')

    // AC2.3: Message prefix mutation
    test('message prefix mutation produces event with dimension "message_prefix"')

    // AC2.3 (negative): Appended messages do NOT trigger event
    test('appended messages without prefix mutation produce no message_prefix event')

    // AC2.4: Delta calculation
    test('event includes correct previousSize, currentSize, and delta')

    // AC2.5: Multiple changes
    test('multiple dimension changes produce one event per dimension')

    // Beta headers
    test('beta header change produces event with dimension "beta_headers"')
    test('undefined beta headers on both turns produce no event')
  })

  describe('reset', () => {
    test('reset clears state so next call is treated as first')
  })

  describe('tool definition stability', () => {
    // Tool ordering normalization
    test('tools in different order but same content produce no event')
  })
})
```

Each test creates a `CacheDiagnostics` via `createCacheDiagnostics()`, calls `checkForCacheBust()` with known inputs, and asserts on the returned events. Use plain objects for tools and messages. Pass `{}` for suppression flags (no suppression in this phase).

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): implement dimension hashing and comparison for cache-bust detection`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export update

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add cache-diagnostics exports to the agent barrel:

```typescript
export type { CacheDimension, CacheBustEvent, SuppressionFlags, CacheDiagnostics } from './cache-diagnostics.ts';
export { createCacheDiagnostics } from './cache-diagnostics.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): export cache-diagnostics from barrel`
<!-- END_TASK_3 -->
