# Batch-Anchored Snapshots Implementation Plan

**Goal:** Implement per-provider content hashing and snapshot mode detection (full/delta/noop).
**Architecture:** Functional Core module with a stateful factory function that tracks per-provider content hashes across calls. Uses `Bun.hash()` (wyhash) for fast non-cryptographic hashing. Returns snapshot results indicating whether to send all dynamic context, only changed sections, or nothing.
**Tech Stack:** Bun, TypeScript 5.7+, Anthropic SDK
**Scope:** Phase 1 of 4
**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### batch-anchored-snapshots.AC3: Snapshot Modes
- **batch-anchored-snapshots.AC3.1 Success:** First turn of a conversation produces a Full snapshot (all dynamic context included)
- **batch-anchored-snapshots.AC3.2 Success:** Turn immediately after compaction produces a Full snapshot
- **batch-anchored-snapshots.AC3.3 Success:** Subsequent turns produce a Delta snapshot containing only sections whose content hash changed
- **batch-anchored-snapshots.AC3.4 Success:** Turn where no dynamic content changed produces no attachment (no-op)
- **batch-anchored-snapshots.AC3.5 Edge:** Single provider changing while others stay constant produces a delta with only that provider's section

### batch-anchored-snapshots.AC4: Content Hashing
- **batch-anchored-snapshots.AC4.1 Success:** Content hash uses a fast non-cryptographic hash (Bun's native `Bun.hash()` or equivalent)
- **batch-anchored-snapshots.AC4.2 Success:** Hash is computed per-provider, not on the aggregate output
- **batch-anchored-snapshots.AC4.3 Success:** Identical content across turns produces identical hashes (deterministic)
- **batch-anchored-snapshots.AC4.4 Edge:** Empty string and `undefined` produce distinct hash values (no collision on absence vs empty)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Snapshot types and factory

**Verifies:** batch-anchored-snapshots.AC4.1, batch-anchored-snapshots.AC4.2, batch-anchored-snapshots.AC4.4

**Files:**
- Create: `src/agent/snapshot.ts`

**Implementation:**

Create `src/agent/snapshot.ts` with the following exports:

1. Types:

```typescript
// pattern: Functional Core

type SnapshotMode = 'full' | 'delta' | 'noop';

type SnapshotResult = {
  readonly mode: SnapshotMode;
  readonly content: string | null;
  readonly hashes: ReadonlyMap<string, bigint>;
  readonly changedProviders: ReadonlyArray<string>;
};

type SnapshotState = {
  computeSnapshot(
    providers: ReadonlyMap<string, () => string | undefined>,
    forceFullSnapshot: boolean,
  ): SnapshotResult;
  reset(): void;
};
```

Note: `hashes` uses `bigint` because `Bun.hash()` returns `bigint`.

2. `hashProviderOutput(value: string | undefined): bigint` — Internal helper. Hashes a provider's output using `Bun.hash()`. For `undefined`, uses a sentinel value (e.g., `Bun.hash('__SNAPSHOT_UNDEFINED_SENTINEL__')`) that is distinct from `Bun.hash('')` to satisfy AC4.4. Both are deterministic (AC4.3).

3. `formatSnapshotContent(sections: ReadonlyArray<{ name: string; content: string }>): string` — Internal helper. Formats provider sections into a single string with `## Section Name` headers separated by double newlines.

4. `createSnapshotState(): SnapshotState` — Factory function. Internal state: `previousHashes: Map<string, bigint>` and `isFirstCall: boolean` (starts `true`).

   `computeSnapshot(providers, forceFullSnapshot)` logic:
   - Evaluate each provider in the map, collecting `{ name, output, hash }` tuples
   - If `isFirstCall` or `forceFullSnapshot`:
     - Set `isFirstCall = false`
     - Store all hashes in `previousHashes`
     - Collect all providers that returned non-undefined output
     - If any content exists, return `{ mode: 'full', content: formatSnapshotContent(...), hashes, changedProviders: [all names with content] }`
     - If all providers returned `undefined`, return `{ mode: 'full', content: null, hashes, changedProviders: [] }`
   - Otherwise (subsequent call):
     - Compare each provider's hash against `previousHashes`
     - Update `previousHashes` with new hashes
     - Collect providers whose hash changed AND whose output is non-undefined into `changedSections`
     - If no hashes changed, return `{ mode: 'noop', content: null, hashes, changedProviders: [] }`
     - Otherwise, return `{ mode: 'delta', content: formatSnapshotContent(changedSections), hashes, changedProviders: [changed names] }`

   `reset()` logic:
   - Clear `previousHashes`
   - Set `isFirstCall = true`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): add snapshot state types and factory for content hashing`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Snapshot state unit tests

**Verifies:** batch-anchored-snapshots.AC3.1, batch-anchored-snapshots.AC3.2, batch-anchored-snapshots.AC3.3, batch-anchored-snapshots.AC3.4, batch-anchored-snapshots.AC3.5, batch-anchored-snapshots.AC4.1, batch-anchored-snapshots.AC4.2, batch-anchored-snapshots.AC4.3, batch-anchored-snapshots.AC4.4

**Files:**
- Create: `src/agent/snapshot.test.ts`

**Implementation:**

Test file with `describe` blocks organized by AC:

**`describe('AC3: Snapshot Modes')`:**

- **AC3.1 — first call is always full:** Create `SnapshotState`, call `computeSnapshot` with two providers that return content. Assert `mode === 'full'`, `content` includes both providers' output, `changedProviders` contains both names.

- **AC3.2 — reset forces full:** Call `computeSnapshot` once (first call, full). Call again with same content (noop). Call `reset()`. Call `computeSnapshot` again with same content. Assert `mode === 'full'` on the third call.

- **AC3.3 — subsequent calls with changes produce delta:** Call `computeSnapshot` once (full). Mutate one provider's return value. Call again. Assert `mode === 'delta'`, `content` includes only the changed provider, `changedProviders` has length 1.

- **AC3.4 — no changes produce noop:** Call `computeSnapshot` once (full). Call again with identical provider outputs. Assert `mode === 'noop'`, `content === null`, `changedProviders` is empty.

- **AC3.5 — single provider change in delta:** Set up three providers. First call (full). Change only the middle provider. Second call. Assert `mode === 'delta'`, `changedProviders` contains only the changed provider's name, `content` includes only that provider's section.

**`describe('AC4: Content Hashing')`:**

- **AC4.1 — uses Bun.hash:** Verify `hashProviderOutput` (exported for testing or tested via behavior) produces `bigint` values. This is implicitly tested by all mode tests since the factory uses `Bun.hash()` internally.

- **AC4.2 — per-provider hashing:** Set up two providers. Change only one. Verify delta includes only the changed one (already covered by AC3.5, but can have a focused test confirming hashes map has separate entries per provider).

- **AC4.3 — deterministic hashing:** Call `computeSnapshot` with identical content twice in separate `SnapshotState` instances. Assert the `hashes` maps contain identical values for the same provider names.

- **AC4.4 — empty string vs undefined are distinct:** Create two providers: one returns `''`, one returns `undefined`. Call `computeSnapshot` (full). Verify the hashes for the two providers are different values. Then swap: the one that returned `''` now returns `undefined` and vice versa. Call again. Assert `mode === 'delta'` (both changed).

**Additional edge case tests:**

- **All providers return undefined on first call:** Assert `mode === 'full'`, `content === null`.
- **Provider added between calls:** First call with one provider. Second call with two providers (new one added). Assert `mode === 'delta'`, new provider appears in `changedProviders`.
- **Provider removed between calls:** First call with two providers. Second call with one provider. Assert the removed provider's hash is no longer tracked (verify via subsequent call behavior).

Providers in tests are simple closures wrapping mutable variables:
```typescript
let value: string | undefined = 'initial';
const provider = () => value;
// Mutate: value = 'changed';
```

Providers map constructed as `new Map([['recall', provider1], ['memory', provider2]])`.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun test src/agent/snapshot.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add snapshot state unit tests for hashing and mode detection`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export update

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts`

**Implementation:**

Add snapshot exports to the existing agent barrel export:

```typescript
export type { SnapshotMode, SnapshotResult, SnapshotState } from './snapshot.ts';
export { createSnapshotState } from './snapshot.ts';
```

This makes the snapshot types and factory available to the composition root (`src/index.ts`) for Phase 4 integration.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): export snapshot types from agent barrel`
<!-- END_TASK_3 -->
