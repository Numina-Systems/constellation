# Subconscious Implementation Plan — Phase 7: Emergent Interest Development

**Goal:** The agent develops its own interests from scratch without prescribed topics. Cold-start handling, active interest cap enforcement during impulse cycles, and duplicate curiosity thread prevention.

**Architecture:** Extends impulse handler (Phase 4) with post-impulse housekeeping: apply engagement decay and enforce active interest cap after each impulse cycle. Cold-start prompt already built into `buildImpulseEvent()`. Duplicate detection already built into `manage_curiosity` tool.

**Tech Stack:** TypeScript (Bun), bun:test

**Scope:** 7 phases from original design (phase 7 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC5: Interests emerge without prescribed topics
- **subconscious.AC5.4 Success:** Starting from zero interests, the agent creates its first interests autonomously on first impulse
- **subconscious.AC5.5 Failure:** No interests are hardcoded or prescribed at startup — the registry starts empty

### subconscious.AC3: Interest registry tracks what the agent cares about
- **subconscious.AC3.4 Success:** Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached
- **subconscious.AC3.5 Failure:** Duplicate curiosity threads (same question within same interest) are detected and the existing thread is resumed instead

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Post-impulse housekeeping — decay and cap enforcement

**Verifies:** None directly (tested in Task 3)

**Files:**
- Modify: `src/index.ts` — add post-impulse housekeeping after subconscious processes event

**Implementation:**

In `src/index.ts`, in the impulse handler (the `'subconscious-impulse'` case from Phase 4), after dispatching the impulse event to the subconscious agent, add housekeeping:

```typescript
if (task.name === 'subconscious-impulse' && subconsciousAgent) {
  const event = await assembleImpulse();
  await subconsciousAgent.processEvent(event);

  // Post-impulse housekeeping
  try {
    const halfLife = config.subconscious?.engagement_half_life_days ?? 7;
    const maxActive = config.subconscious?.max_active_interests ?? 10;

    // Apply engagement decay to all active interests
    const decayedCount = await interestRegistry.applyEngagementDecay(AGENT_OWNER, halfLife);

    // Enforce active interest cap — dormant lowest-scoring if over cap
    const dormanted = await interestRegistry.enforceActiveInterestCap(AGENT_OWNER, maxActive);

    if (dormanted.length > 0) {
      console.log(`[subconscious] ${dormanted.length} interest(s) transitioned to dormant (cap: ${maxActive})`);
    }
  } catch (error) {
    console.error('[subconscious] housekeeping error:', error);
  }
}
```

This runs after every impulse cycle:
1. **Engagement decay:** Reduces scores based on time since last engagement. Uses half-life formula from Phase 1's `applyEngagementDecay()`.
2. **Cap enforcement:** If active interests exceed `max_active_interests`, the lowest-scoring ones become dormant.

Both operations are idempotent and safe to run repeatedly. Errors are logged but never block the impulse cycle.

**Also add the same housekeeping after morning agenda and wrap-up impulses** (in the transition handlers from Phase 6). This ensures decay and cap enforcement happen after every subconscious activity, not just regular impulses.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add post-impulse engagement decay and cap enforcement`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify cold start and empty registry

**Verifies:** None directly (tested in Task 3)

**Files:**
- No new code needed

**Implementation:**

The cold-start behaviour is already implemented:

1. **Empty registry at startup (AC5.5):** The `interests` table starts empty. No seed data, no migration inserts, no startup logic creates interests. Verified by: the migration in Phase 1 only creates tables with no INSERT statements.

2. **Cold-start prompt (AC5.4):** The `buildImpulseEvent()` function from Phase 4 already handles empty interests:
   - When `interests.length === 0`, `formatInterests()` returns "You have no interests yet. What are you curious about?"
   - This prompt naturally leads the LLM to create interests using `manage_interest` with `action: 'create'`

3. **Duplicate detection (AC3.5):** The `manage_curiosity` tool (Phase 2) already calls `findDuplicateCuriosityThread()` before creating. If a duplicate is found, it returns the existing thread with a message indicating it was resumed.

No additional code is needed — these are all verified by testing the existing implementations in context.

**Verification:**
Run: `bun run build`
Expected: No changes needed

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: End-to-end emergent interest tests

**Verifies:** subconscious.AC5.4, subconscious.AC5.5, subconscious.AC3.4

**Files:**
- Create: `src/subconscious/emergent.test.ts`

**Testing:**

These tests verify the end-to-end behaviour of the emergent interest system using the real database.

**subconscious.AC5.5:** No interests are hardcoded or prescribed at startup — the registry starts empty
- `describe('subconscious.AC5.5: Empty registry at startup')`:
  - `it('interest registry starts with zero interests')` — create interest registry with fresh database (after TRUNCATE), call `listInterests(owner)`, verify empty array.
  - `it('migration does not seed any interests')` — run migrations on clean database, query `interests` table directly, verify zero rows.

**subconscious.AC5.4:** Starting from zero interests, the agent creates its first interests autonomously on first impulse
- `describe('subconscious.AC5.4: Cold-start impulse prompt')`:
  - `it('impulse with empty interests produces cold-start prompt')` — call `buildImpulseEvent()` with empty interests, verify content contains "You have no interests yet. What are you curious about?"
  - `it('impulse with empty interests still includes Reflect/Generate/Act sections')` — verify all three sections present even in cold-start.

**subconscious.AC3.4:** Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached

Note: The registry-level `enforceActiveInterestCap()` and `applyEngagementDecay()` methods are already unit-tested in Phase 1 Task 6. These tests focus on the **post-impulse housekeeping wiring** — verifying that decay + cap enforcement runs correctly as part of the impulse cycle.

- `describe('subconscious.AC3.4: Post-impulse housekeeping wiring')`:
  - `it('post-impulse housekeeping applies decay then enforces cap in correct order')` — create 5 active interests with varying scores and backdated `last_engaged_at`. Simulate the housekeeping sequence: call `applyEngagementDecay()` then `enforceActiveInterestCap()` (same order as composition root). Verify that decay runs first (scores reduced), then cap is enforced on the decayed scores (not original scores). This confirms ordering matters.
  - `it('housekeeping is safe to call when no interests exist')` — call decay and cap enforcement on owner with no interests, verify no errors and zero results.

**Verification:**
Run: `bun test src/subconscious/emergent.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add emergent interest development tests`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Duplicate curiosity thread end-to-end test

**Verifies:** subconscious.AC3.5

**Files:**
- Modify: `src/subconscious/emergent.test.ts` — add duplicate detection tests

**Testing:**

**subconscious.AC3.5:** Duplicate curiosity threads (same question within same interest) are detected and the existing thread is resumed instead
- `describe('subconscious.AC3.5: Duplicate curiosity thread detection')`:
  - `it('manage_curiosity create action detects duplicate and returns existing thread')` — create interest, create curiosity thread with question "How does X work?", then call manage_curiosity tool handler with same question, verify output indicates thread was resumed (not created anew), verify only 1 thread exists in DB.
  - `it('case-insensitive duplicate detection')` — create thread with "How does X work?", call manage_curiosity with "how does x work?", verify duplicate detected.
  - `it('resolved threads are not considered duplicates')` — create thread, resolve it, create new thread with same question, verify new thread is created (resolved threads excluded from duplicate search).
  - `it('different questions are not duplicates')` — create thread with "How does X work?", call with "How does Y work?", verify new thread created.

These tests use the real database and call the actual tool handler (from `createSubconsciousTools`) with a real interest registry — not mocks. This verifies the full chain: tool handler → `findDuplicateCuriosityThread()` → PostgreSQL query.

**Verification:**
Run: `bun test src/subconscious/emergent.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add duplicate curiosity thread detection tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
