# Introspection Loop Implementation Plan - Phase 4: Composition & Wiring

**Goal:** Wire introspection into the daemon lifecycle — assembler creation, cron registration, source instructions, context provider registration, and event handler

**Architecture:** Follows the established composition patterns in `src/index.ts` — impulse assembler creation (line 857), cron registration (line 1143), task handler dispatch (line 1040), activity-gated suppression (line 86), and context provider injection (lines 815, 848).

**Tech Stack:** TypeScript, Bun

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements:

### introspection-loop.AC1: Introspection event fires periodically with correct context
- **introspection-loop.AC1.1 Success:** Introspection cron fires at configured offset from impulse interval

### introspection-loop.AC2: Context provider surfaces digest in system prompt
- **introspection-loop.AC2.1 Success:** `[Unformalised Observations]` section appears in system prompt when digest block exists
- **introspection-loop.AC2.2 Success:** Both main agent and subconscious agent receive the section

### introspection-loop.AC3: No schema migrations required
- **introspection-loop.AC3.1 Success:** Digest stored as `readwrite` working-tier memory block via existing `memory.write()`
- **introspection-loop.AC3.2 Success:** Conversation messages queried via existing `PersistenceProvider.query()` with no new tables or columns

### introspection-loop.AC4: Time-windowed review scope
- **introspection-loop.AC4.3 Edge:** Introspection suppressed during sleep hours when activity module is enabled

---

**Note:** This phase is infrastructure/wiring — verified operationally via `bun run build`, not by tests. The individual components (event builder, assembler, context provider) are tested in Phases 1-3.

<!-- START_TASK_1 -->
### Task 1: Add introspection imports to src/index.ts

**Files:**
- Modify: `src/index.ts` (import section, near existing subconscious imports)

**Implementation:**

Find the existing subconscious imports in `src/index.ts` (around line 75, where `createImpulseAssembler`, `buildImpulseCron`, `createSubconsciousContextProvider` are imported). Add the new introspection imports alongside them:

```typescript
import {
  createImpulseAssembler,
  buildImpulseCron,
  createSubconsciousContextProvider,
  createIntrospectionAssembler,
  buildIntrospectionCron,
  createIntrospectionContextProvider,
} from '@/subconscious';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** No individual commit — all Phase 4 wiring changes will be committed together in Task 5.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add introspection to SUPPRESS_DURING_SLEEP and source instructions

**Verifies:** introspection-loop.AC4.3

**Files:**
- Modify: `src/index.ts:86` (SUPPRESS_DURING_SLEEP)
- Modify: `src/index.ts:824-828` (subconsciousSourceInstructions)

**Implementation:**

Add `'subconscious-introspection'` to the `SUPPRESS_DURING_SLEEP` array at line 86:

```typescript
export const SUPPRESS_DURING_SLEEP = ['review-predictions', 'subconscious-impulse', 'subconscious-introspection'] as const;
```

Add the introspection source instructions entry to the `subconsciousSourceInstructions` map at line 824-828:

```typescript
const subconsciousSourceInstructions = new Map<string, string>([
  ['subconscious:impulse', 'You are the subconscious mind — an autonomous inner process that explores interests, reflects on experiences, and builds knowledge independently. You are not responding to a human. Act on your own curiosity.'],
  ['subconscious:morning-agenda', 'You are the subconscious mind reviewing your interests at the start of a new day. Plan what to explore.'],
  ['subconscious:wrap-up', 'You are the subconscious mind reflecting on the day. Consolidate what you learned and prepare for tomorrow.'],
  ['subconscious:introspection', 'You are the subconscious mind reviewing your recent observations. Decide which are worth formalizing into tracked interests or curiosity threads, and write the rest into your digest for later reflection. Be selective — not every observation needs to become an interest.'],
]);
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** No individual commit — all Phase 4 wiring changes will be committed together in Task 5.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create introspection assembler and context provider

**Verifies:** introspection-loop.AC2.1, introspection-loop.AC2.2

**Files:**
- Modify: `src/index.ts` (after impulse assembler creation at line 864, and context provider registration)

**Implementation:**

**Step 1: Create introspection context provider.**

Find the line containing `createSubconsciousContextProvider(interestRegistry, AGENT_OWNER)` (approximately line 571). Immediately after it, create the introspection context provider:

```typescript
const introspectionContextProvider = createIntrospectionContextProvider(memoryStore, AGENT_OWNER);
```

Note: this uses `memoryStore` (created near `createPostgresMemoryStore(persistence)`), not `memory` (MemoryManager).

**Step 2: Register introspection context provider for BOTH agents.**

**Note: Line numbers below are approximate — earlier tasks in this phase modify the same file, so lines will shift. Use the contextual anchors to locate the correct insertion points.**

Find the main agent's `contextProviders` array (in the `createAgent()` call that uses `mainConversationId`, look for the spread `[...contextProviders, predictionContextProvider, schedulingContextProvider, subconsciousContextProvider]`). Add `introspectionContextProvider`:

```typescript
contextProviders: [...contextProviders, predictionContextProvider, schedulingContextProvider, subconsciousContextProvider, introspectionContextProvider],
```

Find the subconscious agent's `contextProviders` array (in the `createAgent()` call that uses `config.subconscious.inner_conversation_id`, look for `[...contextProviders, predictionContextProvider]`). Add `introspectionContextProvider`:

```typescript
contextProviders: [...contextProviders, predictionContextProvider, introspectionContextProvider],
```

This ensures AC2.2 — both agents receive the `[Unformalised Observations]` section.

**Step 3: Create introspection assembler.**

Find the impulse assembler creation (look for `createImpulseAssembler({`). After its closing, add the introspection assembler:

```typescript
const introspectionAssembler = subconsciousAgent && config.subconscious?.inner_conversation_id
  ? createIntrospectionAssembler({
      persistence,
      interestRegistry,
      memoryStore,
      owner: AGENT_OWNER,
      subconsciousConversationId: config.subconscious.inner_conversation_id,
      lookbackHours: config.subconscious?.introspection_lookback_hours ?? 24,
    })
  : undefined;
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** No individual commit — all Phase 4 wiring changes will be committed together in Task 5.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add introspection task handler

**Verifies:** introspection-loop.AC1.1

**Files:**
- Modify: `src/index.ts:1040-1058` (handleSystemSchedulerTaskWithActivity)

**Implementation:**

Add an `else if` branch for `'subconscious-introspection'` in the `handleSystemSchedulerTaskWithActivity` function, after the existing `subconscious-impulse` handler (line 1054). Follow the exact same async dispatch pattern:

```typescript
} else if (task.name === 'subconscious-introspection' && subconsciousAgent && introspectionAssembler) {
  (async () => {
    try {
      const event = await introspectionAssembler.assembleIntrospection();
      await subconsciousAgent.processEvent(event);
    } catch (error) {
      console.error('introspection event processing error:', error);
    }
  })().catch((error) => {
    console.error('introspection task error:', error);
  });
} else {
```

Note: No post-housekeeping needed for introspection (unlike impulse which runs `runPostImpulseHousekeeping()`). The introspection event just prompts the agent to formalize observations and update the digest.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** No individual commit — all Phase 4 wiring changes will be committed together in Task 5.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Register introspection cron task

**Verifies:** introspection-loop.AC1.1

**Files:**
- Modify: `src/index.ts` (after impulse task registration at line 1164)

**Implementation:**

Add introspection task registration after the impulse task registration block (find the line `console.log('impulse task already scheduled')`). Note: the scheduler method is `schedule()` as used in the existing impulse registration code, despite the design plan referencing `scheduler.createTask()`.

```typescript
// Register introspection task if subconscious is enabled and not already scheduled
if (subconsciousAgent && introspectionAssembler && config.subconscious?.impulse_interval_minutes) {
  const impulseMinutes = config.subconscious.impulse_interval_minutes;
  const offsetMinutes = config.subconscious.introspection_offset_minutes ?? 3;
  const introspectionCron = buildIntrospectionCron(impulseMinutes, offsetMinutes);

  const existingIntrospectionTasks = await persistence.query<{ id: string }>(
    `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
    ['system', 'subconscious-introspection'],
  );

  if (existingIntrospectionTasks.length === 0) {
    await systemScheduler.schedule({
      id: crypto.randomUUID(),
      name: 'subconscious-introspection',
      schedule: introspectionCron,
      payload: { taskType: 'introspection' },
    });
    console.log(`introspection task scheduled (cron: ${introspectionCron}, offset: ${offsetMinutes}m from impulse)`);
  } else {
    console.log('introspection task already scheduled');
  }
}
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes, no errors

**Commit:** No individual commit — all Phase 4 wiring changes will be committed together in Task 6.
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Full build verification

**Verifies:** All ACs (integration verification)

**Files:** None (verification only)

**Implementation:**

Run full type-check and test suite to verify everything compiles and existing tests still pass:

```bash
bun run build
bun test
```

Expected:
- Type-check passes with zero errors
- All existing tests pass (1031+ passing, same 17 DB-dependent failures as baseline)
- No regressions

**Commit:** `feat(index): wire introspection loop into daemon lifecycle`

This single commit covers all Phase 4 changes (Tasks 1-5): imports, source instructions, sleep suppression, assembler/context provider creation, task handler, and cron registration.
<!-- END_TASK_6 -->
