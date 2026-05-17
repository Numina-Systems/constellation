# Diary Injection Implementation Plan — Phase 1: Store Interface Extension

**Goal:** Add `getBlocksByLabelPrefix()` to the MemoryStore port interface and PostgreSQL adapter.

**Architecture:** Extends the existing port/adapter pattern in `src/memory/`. Adds a new query method to the `MemoryStore` interface (port) and implements it in `postgres-store.ts` (adapter) using a parameterized `LIKE` query. Integration tests verify prefix matching, tier filtering, and edge cases against a real PostgreSQL database.

**Tech Stack:** TypeScript, PostgreSQL, Bun test

**Scope:** 3 phases from original design (phase 1 of 3)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### diary-injection.AC5: Store prefix retrieval
- **diary-injection.AC5.1 Success:** `getBlocksByLabelPrefix('agent', 'diary:', 'working')` returns all diary-labelled working-tier blocks
- **diary-injection.AC5.2 Failure:** Blocks with label `diary-notes:foo` (not matching `diary:` prefix) are excluded
- **diary-injection.AC5.3 Failure:** Diary-labelled blocks in core or archival tiers are excluded when tier filter is specified
- **diary-injection.AC5.4 Edge:** No matching blocks returns empty array

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add `getBlocksByLabelPrefix` to MemoryStore interface

**Verifies:** None (type-level change, verified by compiler)

**Files:**
- Modify: `src/memory/store.ts:17-60` (add method to MemoryStore interface)

**Implementation:**

Add the following method signature to the `MemoryStore` interface in `src/memory/store.ts`, after the existing `getBlockByLabel` method:

```typescript
getBlocksByLabelPrefix(
  owner: string,
  prefix: string,
  tier?: MemoryTier,
): Promise<ReadonlyArray<MemoryBlock>>;
```

**Verification:**

Run: `bun run build`
Expected: Type error in `postgres-store.ts` because the adapter doesn't implement the new method yet. This confirms the interface change is recognized.

**Commit:** `feat(memory): add getBlocksByLabelPrefix to MemoryStore interface`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `getBlocksByLabelPrefix` in PostgreSQL adapter

**Verifies:** diary-injection.AC5.1, diary-injection.AC5.2, diary-injection.AC5.3, diary-injection.AC5.4

**Files:**
- Modify: `src/memory/postgres-store.ts` (add implementation after `getBlockByLabel`)

**Implementation:**

Add the method implementation inside the `createPostgresMemoryStore` factory function's returned object literal, following the same pattern as `getBlocksByTier` and `getBlockByLabel`:

```typescript
async getBlocksByLabelPrefix(
  owner: string,
  prefix: string,
  tier?: MemoryTier,
): Promise<ReadonlyArray<MemoryBlock>> {
  const escapedPrefix = prefix.replace(/[%_]/g, '\\$&');

  if (tier) {
    const rows = await persistence.query<MemoryBlockRow>(
      `SELECT * FROM memory_blocks WHERE owner = $1 AND label LIKE $2 AND tier = $3 ORDER BY label ASC`,
      [owner, `${escapedPrefix}%`, tier],
    );
    return rows.map(parseMemoryBlock);
  }

  const rows = await persistence.query<MemoryBlockRow>(
    `SELECT * FROM memory_blocks WHERE owner = $1 AND label LIKE $2 ORDER BY label ASC`,
    [owner, `${escapedPrefix}%`],
  );
  return rows.map(parseMemoryBlock);
},
```

Key details:
- Escapes `%` and `_` in the prefix to prevent SQL wildcard injection
- Optional `tier` parameter: when provided, adds tier filter to WHERE clause
- Orders by `label ASC` (lexicographic) so date-based labels sort chronologically
- Uses existing `parseMemoryBlock` row mapper and `MemoryBlockRow` type already in the file
- Uses `persistence.query<MemoryBlockRow>()` — same parameterized query pattern as all other methods

**Verification:**

Run: `bun run build`
Expected: Compiles without errors (interface now satisfied).

**Commit:** `feat(memory): implement getBlocksByLabelPrefix in postgres adapter`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Integration tests for `getBlocksByLabelPrefix`

**Verifies:** diary-injection.AC5.1, diary-injection.AC5.2, diary-injection.AC5.3, diary-injection.AC5.4

**Files:**
- Create: `src/memory/postgres-store.test.ts`

**Testing:**

Tests must verify each AC listed above. Follow existing test patterns from `src/persistence/message-store.test.ts`:
- `beforeAll`: create persistence provider, connect, run migrations, truncate
- `afterEach`: truncate `memory_blocks` table
- `afterAll`: disconnect
- Use `persistence.query()` to insert test data directly

Test cases:

- **diary-injection.AC5.1:** Insert blocks labelled `diary:2026-05-16`, `diary:2026-05-17` in working tier with owner `'test-agent'`. Call `getBlocksByLabelPrefix('test-agent', 'diary:', 'working')`. Assert both blocks returned.

- **diary-injection.AC5.2:** Insert blocks labelled `diary:2026-05-17` AND `diary-notes:foo` in working tier. Call `getBlocksByLabelPrefix('test-agent', 'diary:', 'working')`. Assert only the `diary:2026-05-17` block is returned, NOT `diary-notes:foo`.

- **diary-injection.AC5.3:** Insert blocks labelled `diary:2026-05-17` in core tier AND working tier. Call `getBlocksByLabelPrefix('test-agent', 'diary:', 'working')`. Assert only the working-tier block is returned.

- **diary-injection.AC5.4:** Call `getBlocksByLabelPrefix('test-agent', 'diary:', 'working')` with no matching blocks in database. Assert empty array returned.

- **Additional: label ordering.** Insert `diary:2026-05-17`, `diary:2026-05-16`, `diary:2026-05-17-evening`. Assert results are ordered by label ASC: `diary:2026-05-16`, `diary:2026-05-17`, `diary:2026-05-17-evening`.

- **Additional: owner isolation.** Insert diary blocks for two different owners. Assert querying one owner returns only their blocks.

- **Additional: no tier filter.** Insert diary blocks across multiple tiers. Call `getBlocksByLabelPrefix('test-agent', 'diary:')` without tier parameter. Assert all matching blocks across all tiers are returned.

- **Additional: prefix escaping.** Insert a block with label `diary:100%_done`. Call `getBlocksByLabelPrefix('test-agent', 'diary:100%')`. Assert it matches correctly without treating `%` as a wildcard.

**Verification:**

Run: `bun test src/memory/postgres-store.test.ts`
Expected: All tests pass.

**Commit:** `test(memory): add integration tests for getBlocksByLabelPrefix`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
