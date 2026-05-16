# Cache-Bust Detection Implementation Plan — Phase 2

**Goal:** Add suppression logic so that expected cache busts (compaction, tool registration changes, first turn) do not produce false positive warnings.

**Architecture:** Extends the Functional Core `checkForCacheBust` method from Phase 1. Suppression is applied after change detection but before event emission. Suppressed changes still update stored hashes so the next unsuppressed turn compares against the post-change state.

**Tech Stack:** Bun (TypeScript)

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-bust-detection.AC3: False Positive Suppression
- **cache-bust-detection.AC3.1 Success:** Turn immediately after compaction does not produce a warning for `message_prefix` changes (compaction rewrites history)
- **cache-bust-detection.AC3.2 Success:** Turn immediately after compaction does not produce a warning for `system_prompt` changes (compaction may trigger full snapshot in batch-anchored-snapshots)
- **cache-bust-detection.AC3.3 Success:** First turn of a conversation produces no warnings
- **cache-bust-detection.AC3.4 Success:** Tool registration/deregistration (e.g., MCP reconnection) does not produce a warning for `tool_definitions` if the change was signalled via a `toolsChanged` flag
- **cache-bust-detection.AC3.5 Edge:** Compaction that doesn't actually change any messages (no-op compaction) correctly produces no warning

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add suppression logic to checkForCacheBust

**Verifies:** cache-bust-detection.AC3.1, cache-bust-detection.AC3.2, cache-bust-detection.AC3.3, cache-bust-detection.AC3.4, cache-bust-detection.AC3.5

**Files:**
- Modify: `src/agent/cache-diagnostics.ts`

**Implementation:**

Modify the `checkForCacheBust` method to apply suppression flags after detecting changes but before adding events to the result array. The suppression matrix from the design plan:

| Dimension | Suppressed when |
|-----------|----------------|
| `system_prompt` | `compactionOccurred` or `isFirstTurn` |
| `tool_definitions` | `toolsChanged` or `isFirstTurn` |
| `message_prefix` | `compactionOccurred` or `isFirstTurn` |
| `beta_headers` | `isFirstTurn` |

Add an internal helper function:

```typescript
function isDimensionSuppressed(
  dimension: CacheDimension,
  flags: SuppressionFlags,
): boolean {
  if (flags.isFirstTurn) return true;

  switch (dimension) {
    case 'system_prompt':
    case 'message_prefix':
      return flags.compactionOccurred === true;
    case 'tool_definitions':
      return flags.toolsChanged === true;
    case 'beta_headers':
      return false;
  }
}
```

In the comparison logic (Phase 1's Task 2), after detecting a change for a dimension, check `isDimensionSuppressed(dimension, flags)`. If suppressed, skip adding the event to the results array — but still update the stored hash to the new value (this is already the case since Phase 1 stores hashes unconditionally).

Note: The `isFirstTurn` flag is distinct from the "first call" behaviour in Phase 1 (AC1.5). Phase 1 handles the case where `previousHashes` is null (no previous snapshot to compare against — inherently no events). The `isFirstTurn` flag is an explicit signal from the caller for additional safety. In practice, `isFirstTurn` will be `true` on the first call AND `previousHashes` will be null, so both paths agree. But the flag also handles edge cases like if `reset()` was called mid-conversation — the caller can signal `isFirstTurn: false` and a post-reset call would still produce no events (because `previousHashes` is null), while a subsequent call WOULD detect changes.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): add suppression logic to cache-diagnostics`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Unit tests for suppression logic

**Verifies:** cache-bust-detection.AC3.1, cache-bust-detection.AC3.2, cache-bust-detection.AC3.3, cache-bust-detection.AC3.4, cache-bust-detection.AC3.5

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Testing:**

Add a new `describe('AC3: False Positive Suppression', ...)` block to the existing test file. Each test sets up a two-call sequence: first call establishes baseline hashes, second call changes content AND passes suppression flags.

Tests must verify each AC:

- **cache-bust-detection.AC3.1:** Call once to establish baseline. Second call changes messages (mutates prefix) with `{ compactionOccurred: true }`. Verify no `message_prefix` event is returned.
- **cache-bust-detection.AC3.2:** Call once to establish baseline. Second call changes system prompt with `{ compactionOccurred: true }`. Verify no `system_prompt` event is returned.
- **cache-bust-detection.AC3.3:** First call with `{ isFirstTurn: true }` — verify no events even though it's the very first call (redundant with AC1.5 but confirms flag path). Also test: establish baseline, then second call changes everything with `{ isFirstTurn: true }` — verify ALL dimensions suppressed.
- **cache-bust-detection.AC3.4:** Call once to establish baseline. Second call changes tools with `{ toolsChanged: true }`. Verify no `tool_definitions` event is returned. Then call a third time with same tools but `{ toolsChanged: false }` — verify still no event (hashes match since they were updated during suppression).
- **cache-bust-detection.AC3.5:** Call once to establish baseline. Second call with identical content (no actual change) but `{ compactionOccurred: true }`. Verify no events — no-op compaction produces no warnings.

Additional tests for suppression correctness:

- **Hash update on suppression:** Establish baseline. Second call changes system prompt with `{ compactionOccurred: true }` (suppressed). Third call with same system prompt as second call, no flags — verify NO event (hashes were updated during suppression, so current matches stored).
- **Hash update on suppression (inverse):** Establish baseline. Second call changes system prompt with `{ compactionOccurred: true }` (suppressed). Third call changes system prompt AGAIN, no flags — verify event IS produced (detects change from the suppressed-but-stored value).
- **Selective suppression:** Establish baseline. Second call changes BOTH system prompt and tool definitions, with `{ compactionOccurred: true }`. Verify `system_prompt` is suppressed but `tool_definitions` event IS returned (compaction doesn't suppress tool changes).
- **Beta headers not suppressed by compaction:** Establish baseline. Second call changes beta headers with `{ compactionOccurred: true }`. Verify `beta_headers` event IS returned (only `isFirstTurn` suppresses beta headers).

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass (both Phase 1 and Phase 2 tests)

**Commit:** `test(agent): add suppression logic tests for cache-diagnostics`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
