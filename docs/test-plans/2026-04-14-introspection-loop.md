# Introspection Loop — Human Test Plan

## Prerequisites
- PostgreSQL running (`docker compose up -d`)
- Migrations applied (`bun run migrate`)
- Config file has `[subconscious]` section with `enabled = true`
- `bun test` passes (94 tests, 0 failures)

## Phase 1: Code Review Verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/subconscious/introspection.ts` and find the `[Act]` section template | Contains instruction to use `memory_write` with label `"introspection-digest"` -- this is how the digest gets persisted via existing tool, no new storage code |
| 2 | Open `src/subconscious/introspection-context.ts` and find the `getBlockByLabel` call | Reads `introspection-digest` label -- confirms read path uses existing memory infrastructure |
| 3 | Verify no new migration files exist in `src/persistence/migrations/` beyond pre-existing ones | No new `.sql` files added by this feature (AC3.1) |

## Phase 2: Composition Root Wiring (AC2.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/index.ts` | File opens without error |
| 2 | Search for `createIntrospectionContextProvider` | A single instance is created and assigned (e.g., `const introspectionContextProvider = createIntrospectionContextProvider(...)`) |
| 3 | Find the main agent's `contextProviders` array | `introspectionContextProvider` is included as an element |
| 4 | Find the subconscious agent's `contextProviders` array | The same `introspectionContextProvider` instance is included as an element |

## Phase 3: Sleep Suppression Wiring (AC4.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `src/index.ts` | File opens without error |
| 2 | Search for `SUPPRESS_DURING_SLEEP` (or the array that controls sleep-hour suppression) | Array exists and is used by the activity-gated dispatch logic |
| 3 | Verify `'subconscious-introspection'` appears in the suppression array | The introspection task name is present alongside other suppressed tasks like the impulse |

## Phase 4: End-to-End -- Daemon Startup with No Prior Digest

**Purpose:** Verify the full loop works on a clean database -- introspection event fires, agent processes it, digest is written, and context provider picks it up.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure no `introspection-digest` memory block exists (`SELECT * FROM memory_blocks WHERE label = 'introspection-digest'` returns 0 rows) | Clean state confirmed |
| 2 | Start daemon with `bun run start` | REPL starts, scheduler registers introspection cron task |
| 3 | Wait for the introspection cron to fire (check logs for `subconscious:introspection`) | Event is dispatched to the subconscious agent conversation |
| 4 | Observe the subconscious agent's response | Agent receives an event with `[Review]` (may say "No recent conversation"), `[Current State]`, `[Last Digest]` ("first introspection"), and `[Act]` sections |
| 5 | Verify agent calls `memory_write` with label `introspection-digest` | A new memory block is created in the `memory_blocks` table with that label |
| 6 | Wait for the context provider TTL to expire (~2 minutes) or restart the daemon | On next agent turn (main or subconscious), system prompt contains `[Unformalised Observations]` with the digest content |

## Phase 5: End-to-End -- Daemon Restart Continuity (AC2.4)

**Purpose:** Verify that a digest written in a previous session survives daemon restart.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Confirm an `introspection-digest` block exists from Phase 4 | Block exists in database |
| 2 | Stop the daemon (Ctrl+C) | Daemon shuts down cleanly |
| 3 | Restart daemon with `bun run start` | REPL starts |
| 4 | Trigger any agent turn (send a message) and observe system prompt | `[Unformalised Observations]` section appears with the content from the previous session's digest |

## Phase 6: End-to-End -- Introspection During Sleep (AC4.3)

**Purpose:** Verify introspection does not fire during configured sleep hours.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure activity module with sleep hours that include the current time | Activity module reports "sleeping" state |
| 2 | Wait for the introspection cron interval to pass | No `subconscious:introspection` event is dispatched (check logs) |
| 3 | Advance past sleep hours (or reconfigure to wake) | Next cron tick fires the introspection event normally |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC2.2: Both agents receive digest section | Composition root wiring -- no unit-testable seam exists for verifying both agent configurations receive the same provider instance | Phase 2 steps 1-4: inspect `src/index.ts` for `introspectionContextProvider` in both agents' `contextProviders` arrays |
| AC3.1: Digest stored via existing `memory_write` | Design-level criterion -- the introspection system instructs the agent to use an existing tool, no new storage code to test | Phase 1 steps 1-3: verify `[Act]` template references `memory_write` with `introspection-digest` label, and no new migrations exist |
| AC4.3: Suppressed during sleep hours | Sleep suppression uses existing activity-gated dispatch; requires running daemon or mocking the full scheduler pipeline | Phase 3 steps 1-3: verify task name in suppression array; Phase 6 for operational validation |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1: Cron offset | `introspection.test.ts` -- 3 tests | -- |
| AC1.2: Review section | `introspection.test.ts` -- 2 tests | -- |
| AC1.3: Current State | `introspection.test.ts` -- 4 tests + `introspection-assembler.test.ts` -- 4 tests | -- |
| AC1.4: Act section | `introspection.test.ts` -- 1 test | -- |
| AC1.5: Tool exclusion | `introspection.test.ts` -- 1 test + `introspection-assembler.test.ts` -- SQL capture | -- |
| AC1.6: Empty window | `introspection.test.ts` -- 1 test + `introspection-assembler.test.ts` -- 1 test | -- |
| AC2.1: Digest in prompt | `introspection-context.test.ts` -- 2 tests | -- |
| AC2.2: Both agents receive | -- | Phase 2 (code review of `src/index.ts`) |
| AC2.3: Undefined when empty | `introspection-context.test.ts` -- 3 tests | -- |
| AC2.4: Stale digest continuity | `introspection-context.test.ts` -- 1 test | Phase 5 (operational) |
| AC3.1: No new migrations | -- | Phase 1 (code review) |
| AC3.2: Existing tables only | `introspection-assembler.test.ts` -- 3 tests | -- |
| AC4.1: Time window | `introspection.test.ts` -- 1 test + `introspection-assembler.test.ts` -- 1 test | -- |
| AC4.2: Config bounds | `schema.test.ts` -- 7 tests | -- |
| AC4.3: Sleep suppression | -- | Phase 3 (code review) + Phase 6 (operational) |
