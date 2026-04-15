# Introspection Loop Test Requirements

Maps each acceptance criterion to automated tests or human verification.

Test framework: `bun:test`. Convention: co-located `*.test.ts` files, describe blocks named after ACs (e.g., `describe('introspection-loop.AC1.2: ...')`).

---

## AC1: Introspection event fires periodically with correct context

### introspection-loop.AC1.1: Introspection cron fires at configured offset from impulse interval

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection.test.ts` |
| Phase | 1 (Task 3) |
| Description | `buildIntrospectionCron` produces correct offset cron expressions. Verifies `buildIntrospectionCron(15, 3)` returns `'3/15 * * * *'`, `buildIntrospectionCron(30, 5)` returns `'5/30 * * * *'`, and offset wraps correctly (`buildIntrospectionCron(15, 20)` returns `'5/15 * * * *'` since 20 % 15 = 5). |

### introspection-loop.AC1.2: Event contains `[Review]` section with recent subconscious conversation messages

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection.test.ts` |
| Phase | 1 (Task 3) |
| Description | `buildIntrospectionEvent` given an `IntrospectionContext` with sample messages produces an event whose `content` contains `[Review]` and the message text. Verifies message timestamps are rendered and message content appears in the output. |

### introspection-loop.AC1.3: Event contains `[Current State]` section with active interests and last digest content

| Field | Value |
|---|---|
| Test type | Unit + Integration |
| Test files | `src/subconscious/introspection.test.ts`, `src/subconscious/introspection-assembler.test.ts` |
| Phase | 1 (Task 3) + 2 (Task 5) |
| Description | **Unit (Phase 1):** `buildIntrospectionEvent` given an `IntrospectionContext` with an Interest fixture and a `currentDigest` string produces content containing `[Current State]`, the interest name, and `[Last Digest]` with digest text. **Integration (Phase 2):** `assembleIntrospection()` queries the mock `InterestRegistry` with `{ status: 'active' }` and includes interest names in the resulting event. When `getBlockByLabel` returns a digest block, the event's `[Last Digest]` section contains that content. |

### introspection-loop.AC1.4: Event contains `[Act]` section prompting formalization and digest update

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection.test.ts` |
| Phase | 1 (Task 3) |
| Description | `buildIntrospectionEvent` produces content containing `[Act]`, `manage_interest`, `manage_curiosity`, and `memory_write` tool references. |

### introspection-loop.AC1.5: Messages with `role = 'tool'` are excluded from review context

| Field | Value |
|---|---|
| Test type | Unit + Integration |
| Test files | `src/subconscious/introspection.test.ts`, `src/subconscious/introspection-assembler.test.ts` |
| Phase | 1 (Task 3) + 2 (Task 5) |
| Description | **Unit (Phase 1):** The `IntrospectionContext.messages` type union excludes `'tool'`, enforcing this at compile time. Test that the builder correctly renders only assistant/user/system messages. **Integration (Phase 2):** Verify the SQL passed to `persistence.query()` contains `role != 'tool'` by capturing the query string from the mock. |

### introspection-loop.AC1.6: Empty conversation window produces event with empty review section, not an error

| Field | Value |
|---|---|
| Test type | Unit + Integration |
| Test files | `src/subconscious/introspection.test.ts`, `src/subconscious/introspection-assembler.test.ts` |
| Phase | 1 (Task 3) + 2 (Task 5) |
| Description | **Unit (Phase 1):** `buildIntrospectionEvent` with an empty `messages` array produces content containing "No recent conversation to review." and does not throw. **Integration (Phase 2):** When `persistence.query()` returns zero rows, `assembleIntrospection()` still returns a valid `ExternalEvent` containing the empty-review text. |

---

## AC2: Context provider surfaces digest in system prompt

### introspection-loop.AC2.1: `[Unformalised Observations]` section appears in system prompt when digest block exists

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection-context.test.ts` |
| Phase | 3 (Task 3) |
| Description | Create a mock `MemoryStore` where `getBlockByLabel('introspection-digest')` returns a block with content. Call the provider, allow background refresh to complete (`await Bun.sleep(10)`), call again. Verify the returned string contains `[Unformalised Observations]` and the block content. |

### introspection-loop.AC2.2: Both main agent and subconscious agent receive the section

| Field | Value |
|---|---|
| Test type | Human verification |
| Phase | 4 (Task 3) |
| Justification | This criterion is about wiring in `src/index.ts` -- the same `createIntrospectionContextProvider` instance is added to both agents' `contextProviders` arrays. There is no unit-testable seam for this; it requires inspecting the composition root code. The individual context provider is fully tested in AC2.1. |
| Verification approach | Code review of `src/index.ts` confirming `introspectionContextProvider` appears in both the main agent's and subconscious agent's `contextProviders` arrays. Optionally verified via `bun run start` and inspecting system prompts in both agent conversations. |

### introspection-loop.AC2.3: Context provider returns `undefined` when no digest block exists (first run)

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection-context.test.ts` |
| Phase | 3 (Task 3) |
| Description | Mock `getBlockByLabel` returns `null`. Provider returns `undefined` after refresh completes. Additional edge cases: empty string content returns `undefined`, whitespace-only content returns `undefined`. |

### introspection-loop.AC2.4: Stale digest from previous daemon run is surfaced on restart (continuity preserved)

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/subconscious/introspection-context.test.ts` |
| Phase | 3 (Task 3) |
| Description | Mock `getBlockByLabel` returns a block with content (simulating a persisted digest from a previous run). Create the provider, call once (triggers async refresh), wait for refresh to complete, call again. Verify the stale content appears in the returned string. This simulates daemon restart: the block exists in the database before the provider is first called. |

---

## AC3: No schema migrations required

### introspection-loop.AC3.1: Digest stored as `readwrite` working-tier memory block via existing `memory.write()`

| Field | Value |
|---|---|
| Test type | Human verification |
| Phase | 3 (design-level) + 4 (wiring) |
| Justification | This criterion is satisfied by design: the subconscious agent uses the existing `memory_write` tool (which defaults to working tier with `readwrite` permission) to write the `introspection-digest` block. There is no new storage code to test -- the existing `memory_write` tool and `MemoryManager.write()` are already tested in their own modules. The introspection system only reads the block via `getBlockByLabel`. |
| Verification approach | Code review confirming: (1) the `[Act]` section in `buildIntrospectionEvent` instructs the agent to use `memory_write` with label `"introspection-digest"`, and (2) the context provider reads via `getBlockByLabel` (tested in AC2.1). No new migration files exist in `src/persistence/migrations/`. |

### introspection-loop.AC3.2: Conversation messages queried via existing `PersistenceProvider.query()` with no new tables or columns

| Field | Value |
|---|---|
| Test type | Integration |
| Test file | `src/subconscious/introspection-assembler.test.ts` |
| Phase | 2 (Task 5) |
| Description | Capture the SQL string passed to `persistence.query()` from the mock. Verify it queries the existing `messages` table with `conversation_id = $1`, `role != 'tool'`, and `created_at >= $2`. Verify params include `subconsciousConversationId` and a lookback timestamp. Confirm no DDL or new table references. |

---

## AC4: Time-windowed review scope

### introspection-loop.AC4.1: Only messages within configured `introspection_lookback_hours` are included in review

| Field | Value |
|---|---|
| Test type | Unit + Integration |
| Test files | `src/subconscious/introspection.test.ts`, `src/subconscious/introspection-assembler.test.ts` |
| Phase | 1 (Task 3) + 2 (Task 5) |
| Description | **Unit (Phase 1):** `buildIntrospectionEvent` faithfully renders timestamps from messages it receives (the builder formats, it does not filter). **Integration (Phase 2):** Verify `persistence.query()` receives a `since` parameter approximately equal to `Date.now() - lookbackHours * 3600_000`. The assembler enforces the time window at the SQL layer. |

### introspection-loop.AC4.2: Config validates `introspection_lookback_hours` (min 1, max 72) and `introspection_offset_minutes` (min 1, max 30)

| Field | Value |
|---|---|
| Test type | Unit |
| Test file | `src/config/schema.test.ts` |
| Phase | 2 (Task 2) |
| Description | Zod schema validation tests using `.safeParse()`. Verifies: (1) defaults -- parsing `{ enabled: false }` produces `introspection_offset_minutes: 3` and `introspection_lookback_hours: 24`. (2) Min bounds -- `introspection_offset_minutes: 0` and `introspection_lookback_hours: 0` both fail. (3) Max bounds -- `introspection_offset_minutes: 31` and `introspection_lookback_hours: 73` both fail. (4) Valid custom values -- `introspection_offset_minutes: 5` and `introspection_lookback_hours: 48` both parse successfully. |

### introspection-loop.AC4.3: Introspection suppressed during sleep hours when activity module is enabled

| Field | Value |
|---|---|
| Test type | Human verification |
| Phase | 4 (Task 2) |
| Justification | Sleep suppression is handled by the existing `SUPPRESS_DURING_SLEEP` array and activity-gated dispatch in `src/index.ts`. Testing this requires either a running daemon with an activity module or mocking the entire scheduler dispatch pipeline, which is outside the scope of the introspection feature's unit tests. The mechanism is already tested by the existing impulse suppression tests (if any) or verified operationally. |
| Verification approach | Code review confirming `'subconscious-introspection'` is included in the `SUPPRESS_DURING_SLEEP` array in `src/index.ts`. Optionally verified by running the daemon during configured sleep hours and confirming the introspection task does not fire. |

---

## Test File Summary

| Test file | ACs covered | Phase |
|---|---|---|
| `src/subconscious/introspection.test.ts` | AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC4.1 | 1 |
| `src/subconscious/introspection-assembler.test.ts` | AC1.3, AC1.5, AC1.6, AC3.2, AC4.1 | 2 |
| `src/config/schema.test.ts` | AC4.2 | 2 |
| `src/subconscious/introspection-context.test.ts` | AC2.1, AC2.3, AC2.4, AC3.1 | 3 |

## Human Verification Summary

| AC | Reason | Phase |
|---|---|---|
| AC2.2 | Wiring concern in composition root; no unit-testable seam | 4 |
| AC3.1 | Satisfied by existing `memory_write` tool defaults; no new code to test | 3/4 |
| AC4.3 | Sleep suppression uses existing activity-gated dispatch; tested operationally | 4 |
