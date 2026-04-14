# Subconscious Implementation Plan — Phase 6: Bidirectional Integration

**Goal:** Human conversations seed curiosity threads, subconscious discoveries surface in human conversations. Wake/sleep transition impulses and exploration log recording.

**Architecture:** Morning agenda and wrap-up impulse builders in `src/subconscious/impulse.ts` (extending Phase 4), transition-triggered dispatch via scheduled tasks in composition root, exploration log entries written by impulse handler after each cycle.

**Tech Stack:** TypeScript (Bun), bun:test

**Scope:** 7 phases from original design (phase 6 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC4: Both agents can interact with interests and see each other's activity
- **subconscious.AC4.7 Success:** A topic from human conversation appears as a seeded interest after the next impulse cycle
- **subconscious.AC4.8 Success:** Main agent can reference subconscious discoveries naturally during human conversation

### subconscious.AC5: Interests emerge without prescribed topics
- **subconscious.AC5.1 Success:** Wake transition triggers a morning agenda impulse
- **subconscious.AC5.2 Success:** Sleep transition triggers a wrap-up reflection impulse
- **subconscious.AC5.3 Success:** Exploration log records each impulse cycle's actions and tools used

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Morning agenda and wrap-up impulse builders

**Verifies:** None directly (tested in Task 3)

**Files:**
- Modify: `src/subconscious/impulse.ts` — add `buildMorningAgendaEvent` and `buildWrapUpEvent`

**Implementation:**

Add two new pure builder functions to `src/subconscious/impulse.ts`:

**`buildMorningAgendaEvent(context: Readonly<ImpulseContext>): ExternalEvent`**

Morning agenda prompt — sent on wake transition, before queue drain:

```
[Morning Agenda]
Good morning. Here's what you've been working on and what's ahead.

[Active Interests]
{formatted interests with scores, or "You have no active interests." if empty}

[Recent Explorations]
{formatted recent exploration entries, or "No recent explorations." if empty}

[Recent Activity]
{formatted traces}

Review your interests and explorations. Decide:
1. Which interests to continue pursuing today
2. Whether any interests should be parked or abandoned
3. What new questions have emerged

Use manage_interest and manage_curiosity to plan your day.
```

Return as `ExternalEvent` with `source: 'subconscious:morning-agenda'` and `metadata: { taskType: 'morning-agenda', impulseType: 'transition' }`.

**`buildWrapUpEvent(context: Readonly<ImpulseContext>): ExternalEvent`**

Wrap-up prompt — sent on sleep transition, before going dormant:

```
[Wrap Up]
End of day. Reflect on what happened today and prepare for tomorrow.

[Active Interests]
{formatted interests}

[Recent Explorations]
{formatted explorations}

[Recent Activity]
{formatted traces}

Reflect on today's work:
1. What did you learn?
2. What curiosity threads should you pick up tomorrow?
3. Are there any interests that have run their course?
4. Write any insights to memory for future reference.

Use manage_interest and manage_curiosity to update your state before sleep.
```

Return as `ExternalEvent` with `source: 'subconscious:wrap-up'` and `metadata: { taskType: 'wrap-up', impulseType: 'transition' }`.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add morning agenda and wrap-up impulse builders`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire transition impulses in composition root

**Verifies:** None directly (tested in Task 3)

**Files:**
- Modify: `src/subconscious/impulse-assembler.ts` — add morning and wrap-up assembler methods
- Modify: `src/index.ts` — dispatch transition impulses to subconscious agent

**Implementation:**

**Update impulse-assembler.ts:**

The `ImpulseAssembler` type and factory already return an object with `assembleImpulse()`, `assembleMorningAgenda()`, and `assembleWrapUp()` methods (Phase 4 created the type with stubs for the latter two). Replace the stubs with real implementations:

- `assembleMorningAgenda()`: Same context fetch as `assembleImpulse()` (via shared `fetchContext()` helper), but calls `buildMorningAgendaEvent(context)` instead.
- `assembleWrapUp()`: Same context fetch, calls `buildWrapUpEvent(context)`.

Extract the shared context-fetching logic into a private `async function fetchContext(): Promise<ImpulseContext>` to avoid duplication across the three methods.

**Update index.ts:**

In the wake transition handler (the `handleTransition` function, `transition-to-wake` case), BEFORE calling the wake handler (which drains the queue):

```typescript
if (task.name === 'transition-to-wake') {
  // Dispatch morning agenda to subconscious before queue drain
  if (subconsciousAgent && impulseAssembler) {
    try {
      const morningEvent = await impulseAssembler.assembleMorningAgenda();
      await subconsciousAgent.processEvent(morningEvent);
    } catch (error) {
      console.error('[subconscious] morning agenda error:', error);
    }
  }
  await wakeHandler();
}
```

In the sleep transition handler (`transition-to-sleep` case), BEFORE transitioning to sleep:

```typescript
if (task.name === 'transition-to-sleep') {
  // Dispatch wrap-up to subconscious before sleep
  if (subconsciousAgent && impulseAssembler) {
    try {
      const wrapUpEvent = await impulseAssembler.assembleWrapUp();
      await subconsciousAgent.processEvent(wrapUpEvent);
    } catch (error) {
      console.error('[subconscious] wrap-up error:', error);
    }
  }
  await am.transitionTo('sleeping');
}
```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): wire transition impulses to subconscious agent`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Transition impulse and exploration log tests

**Verifies:** subconscious.AC5.1, subconscious.AC5.2, subconscious.AC5.3

**Files:**
- Modify: `src/subconscious/impulse.test.ts` — add transition builder and exploration log context tests

**Testing:**

**subconscious.AC5.1:** Wake transition triggers a morning agenda impulse
- `describe('subconscious.AC5.1: Morning agenda impulse')`:
  - `it('buildMorningAgendaEvent produces event with morning-agenda source')` — call with sample data, verify `source` is `'subconscious:morning-agenda'`, `metadata.taskType` is `'morning-agenda'`.
  - `it('morning agenda prompt includes interest review instructions')` — verify content contains "Review your interests" and planning instructions.
  - `it('morning agenda includes active interests')` — pass interests, verify they appear in output.

**subconscious.AC5.2:** Sleep transition triggers a wrap-up reflection impulse
- `describe('subconscious.AC5.2: Wrap-up reflection impulse')`:
  - `it('buildWrapUpEvent produces event with wrap-up source')` — call with sample data, verify `source` is `'subconscious:wrap-up'`, `metadata.taskType` is `'wrap-up'`.
  - `it('wrap-up prompt includes reflection questions')` — verify content contains "What did you learn?" and reflection instructions.

**subconscious.AC5.3:** Exploration log records each impulse cycle's actions and tools used

Note: The registry-level `logExploration()` and `listExplorationLog()` methods are already tested in Phase 1 Task 5. These tests verify the exploration log is correctly **populated during impulse cycles** — a higher-level concern.

- `describe('subconscious.AC5.3: Exploration log in impulse context')`:
  - `it('impulse prompt includes exploration log entries when present')` — call `buildImpulseEvent()` with exploration log entries, verify the `[Recent Explorations]` section in the output contains the entries. This is a pure function test.
  - `it('impulse prompt handles empty exploration log gracefully')` — call with empty explorations, verify "No recent explorations." appears.
  - `it('exploration log entries include tools_used as JSONB array')` — use real DB, log an entry with `tools_used: ['web_search', 'memory_write']`, retrieve via `listExplorationLog()`, verify the array is preserved through serialization.

**Verification:**
Run: `bun test src/subconscious/impulse.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add transition impulse and exploration log tests`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Seeding interests from human conversation

**Verifies:** subconscious.AC4.7

**Files:**
- No new code needed for this AC

**Implementation:**

AC4.7 states: "A topic from human conversation appears as a seeded interest after the next impulse cycle."

This is inherently satisfied by the existing architecture:

1. The main agent writes to shared memory during human conversation (via `memory_write` tool)
2. The impulse assembler (Phase 4) queries recent memories: `deps.memory.read('recent interests explorations discoveries', 5)`
3. The impulse prompt includes these memories under `[Recent Memories]`
4. The subconscious agent sees conversation topics and can create interests with `source: 'seeded'` using `manage_interest`

No new code is needed — the cross-pollination happens passively through shared memory. The `source` field distinguishes `'seeded'` (from human conversation) vs `'emergent'` (from autonomous exploration) vs `'external'` (from external events).

**Verification:**

This is verified by the impulse builder tests (Phase 4, Task 3) which confirm that recent memories are included in the impulse prompt. The actual seeding behaviour is an emergent property of the LLM's response to the prompt — it cannot be tested deterministically without an integration test with a real model.

Write a focused integration note for the test-requirements phase:
- **Human verification needed:** Start a human conversation about a topic, wait for the next impulse cycle, verify the subconscious creates a seeded interest related to the topic.

**Commit:** No commit needed — documentation only.

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Main agent referencing subconscious discoveries

**Verifies:** subconscious.AC4.8

**Files:**
- No new code needed for this AC

**Implementation:**

AC4.8 states: "Main agent can reference subconscious discoveries naturally during human conversation."

This is satisfied by two mechanisms already implemented:

1. **Context provider (Phase 5):** The `[Inner Life]` section is injected into the main agent's system prompt every turn, giving it ambient awareness of active interests and recent explorations.

2. **Shared memory:** The subconscious writes discoveries to shared memory via `memory_write`. The main agent can retrieve these via `memory_read` or they may surface via the existing hybrid search when relevant to the conversation.

No new code is needed — this is an emergent property of the shared infrastructure.

**Verification:**

Verified by Phase 5 context provider tests (AC4.5, AC4.6) which confirm the `[Inner Life]` section is injected. The actual referencing behaviour is an emergent property of the LLM.

Write a focused integration note for the test-requirements phase:
- **Human verification needed:** After the subconscious has explored a topic, start a human conversation about that topic. Verify the main agent references subconscious discoveries (from `[Inner Life]` section or via memory search).

**Commit:** No commit needed — documentation only.

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
