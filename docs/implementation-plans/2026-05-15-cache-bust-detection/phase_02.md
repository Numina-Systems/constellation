# Cache-Bust Detection Implementation Plan

**Goal:** Add suppression logic so that expected cache busts (compaction, tool registration changes, first turn) do not produce false positive warnings.

**Architecture:** Extends the existing `checkForCacheBust()` function with a suppression matrix that maps dimension/flag combinations to suppressed events. Suppressed changes still update stored hashes so subsequent turns compare against the post-change state. No new files — all changes are within the existing `cache-diagnostics.ts` module.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 2 of 3

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
### Task 1: Suppression matrix

**Verifies:** cache-bust-detection.AC3.1, cache-bust-detection.AC3.2, cache-bust-detection.AC3.3, cache-bust-detection.AC3.4

**Files:**
- Modify: `src/agent/cache-diagnostics.ts`

**Implementation:**

Add an internal suppression matrix as a constant inside `cache-diagnostics.ts`:

```typescript
const SUPPRESSION_MATRIX: Record<CacheDimension, ReadonlyArray<keyof SuppressionFlags>> = {
  system_prompt: ['compactionOccurred', 'isFirstTurn'],
  tool_definitions: ['toolsChanged', 'isFirstTurn'],
  message_prefix: ['compactionOccurred', 'isFirstTurn'],
  beta_headers: ['isFirstTurn'],
};
```

Modify the comparison logic inside `checkForCacheBust()`. After computing events from hash comparison but before returning them, filter out any event whose dimension is suppressed by an active flag. The logic:

```typescript
function isSuppressed(dimension: CacheDimension, flags: SuppressionFlags): boolean {
  const suppressors = SUPPRESSION_MATRIX[dimension];
  return suppressors.some((flag) => flags[flag] === true);
}
```

Events that are suppressed are dropped from the returned array but the stored hashes are still updated (this already happens because hash updates occur before filtering).

**Important ordering within `checkForCacheBust()`:**
1. Compute current hashes for all dimensions
2. Compare current hashes against stored hashes, collecting raw events
3. Update stored hashes with current values
4. Filter raw events through suppression matrix
5. Return unsuppressed events

This ensures that suppressed changes still update the stored state (step 3 happens before step 4).

**Note on `isFirstTurn`:** Phase 1 already returns no events when `previousDimensions` is null (first call). The `isFirstTurn` flag provides a second layer of suppression for cases where the caller explicitly signals first-turn status. Both mechanisms should coexist — if `previousDimensions` is null, no events are generated regardless of flags. If `previousDimensions` exists but `isFirstTurn` is true (edge case: caller miscounts turns), all events are still suppressed.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): add suppression matrix to cache-diagnostics`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Suppression tests

**Verifies:** cache-bust-detection.AC3.1, cache-bust-detection.AC3.2, cache-bust-detection.AC3.3, cache-bust-detection.AC3.4, cache-bust-detection.AC3.5

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Implementation:**

Add a new `describe('AC3: False Positive Suppression')` block to the existing test file. Each test calls `checkForCacheBust()` twice: first to establish baseline hashes, then with changed inputs and appropriate suppression flags.

```
describe('AC3: False Positive Suppression', () => {
  // AC3.1: compactionOccurred suppresses message_prefix
  test('compactionOccurred suppresses message_prefix events')
  // Setup: call with messages [A, B, C], then call with modified messages [A', B', C']
  //        and flags { compactionOccurred: true }
  // Assert: no message_prefix event returned

  // AC3.2: compactionOccurred suppresses system_prompt
  test('compactionOccurred suppresses system_prompt events')
  // Setup: call with system "v1", then call with system "v2"
  //        and flags { compactionOccurred: true }
  // Assert: no system_prompt event returned

  // AC3.3: isFirstTurn suppresses all dimensions
  test('isFirstTurn suppresses all events')
  // Setup: call once to establish baseline, then call with all dimensions changed
  //        and flags { isFirstTurn: true }
  // Assert: empty events array

  // AC3.4: toolsChanged suppresses tool_definitions
  test('toolsChanged suppresses tool_definitions events')
  // Setup: call with tools [A, B], then call with tools [A, B, C]
  //        and flags { toolsChanged: true }
  // Assert: no tool_definitions event returned

  // AC3.5: No-op compaction produces no warnings
  test('compaction flag with unchanged messages produces no events')
  // Setup: call with messages [A, B, C], then call with same messages
  //        and flags { compactionOccurred: true }
  // Assert: empty events array (no change detected, suppression irrelevant)

  // Suppressed changes still update stored hashes
  test('suppressed changes update stored hashes for subsequent turns')
  // Setup:
  //   1. call with system "v1" (baseline)
  //   2. call with system "v2" and { compactionOccurred: true } (suppressed)
  //   3. call with system "v2" and {} (no flags)
  // Assert: third call returns no events (comparing v2 vs v2, not v1 vs v2)

  // Partial suppression: only matching dimensions are suppressed
  test('compactionOccurred does not suppress tool_definitions')
  // Setup: call once, then change both system_prompt and tool_definitions
  //        with flags { compactionOccurred: true }
  // Assert: system_prompt suppressed, tool_definitions event still returned
})
```

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass (both Phase 1 and Phase 2 tests)

**Commit:** `test(agent): add suppression logic tests for cache-bust detection`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
