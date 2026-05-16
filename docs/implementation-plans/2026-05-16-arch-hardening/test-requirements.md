# Test Requirements: Architectural Hardening

Maps each acceptance criterion to specific test cases. All tests run via `bun test`.

---

## arch-hardening.AC1: Checkpoint restore is fully atomic

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC1.1 | Full restore completes -- predictions, interests, and memory all reflect checkpoint state | Integration | `src/agent/checkpoint-restore.test.ts` | After successful restore, query predictions, interests, and working memory blocks to confirm all match checkpoint snapshot |
| AC1.2 | Pre-flight rejects invalid label -- no DB or memory state modified | Unit | `src/agent/checkpoint-restore.test.ts` | Pass a checkpoint with a label violating `^[a-z][a-z0-9_-]*$`; assert throws `AgentError('CHECKPOINT_FAILED')`; assert DB and memory unchanged |
| AC1.3 | Pre-flight rejects oversized block -- no DB or memory state modified | Unit | `src/agent/checkpoint-restore.test.ts` | Pass a checkpoint with block content exceeding `MAX_BLOCK_CONTENT_LENGTH`; assert throws; assert no side effects |
| AC1.4 | Pre-flight rejects block count exceeding limit -- no DB or memory state modified | Unit | `src/agent/checkpoint-restore.test.ts` | Pass a checkpoint with blocks > `MAX_WORKING_BLOCKS`; assert throws; assert no side effects |
| AC1.5 | DB write fails mid-Tier-1 -- all Tier 1 writes rolled back, memory untouched | Integration | `src/agent/checkpoint-restore.test.ts` | Mock a DB failure (e.g., prediction store throws mid-write); assert transaction rolled back (no partial writes visible); assert memory unchanged |
| AC1.6 | Memory write fails in Tier 2 -- DB rolled back, memory best-effort cleared to blank state | Integration | `src/agent/checkpoint-restore.test.ts` | Mock memory write failure; assert DB transaction rolled back; assert `clearWorkingMemory` was called (best-effort cleanup) |

---

## arch-hardening.AC2: Nested transaction support via savepoints

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC2.1 | Top-level `withTransaction` issues BEGIN/COMMIT | Integration | `src/persistence/tx-nesting.test.ts` | Spy on PoolClient; confirm BEGIN sent at start, COMMIT sent on success |
| AC2.2 | Nested `withTransaction` issues SAVEPOINT/RELEASE (no BEGIN) | Integration | `src/persistence/tx-nesting.test.ts` | Call `withTransaction` inside another `withTransaction`; confirm SAVEPOINT issued, no nested BEGIN; RELEASE on success |
| AC2.3 | Deeply nested transactions (depth > 2) use unique savepoint names | Integration | `src/persistence/tx-nesting.test.ts` | Triple-nest `withTransaction`; confirm savepoint names are distinct (e.g., `sp_1`, `sp_2`) |
| AC2.4 | Nested error + rethrow rolls back savepoint and propagates to root ROLLBACK | Integration | `src/persistence/tx-nesting.test.ts` | Throw inside nested `withTransaction`, let it propagate; confirm ROLLBACK TO SAVEPOINT then root ROLLBACK |
| AC2.5 | Nested error + catch rolls back savepoint but parent transaction remains committable | Integration | `src/persistence/tx-nesting.test.ts` | Throw inside nested `withTransaction`, catch in parent; confirm ROLLBACK TO SAVEPOINT; parent can still COMMIT successfully |

---

## arch-hardening.AC3: History loaded once per turn

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC3.1 | `loadConversationHistory` called exactly once per `processMessage` invocation | Integration | `src/agent/agent.test.ts` | Spy on `loadConversationHistory`; run `processMessage` through a multi-tool-call turn; assert spy called exactly once |
| AC3.2 | Checkpoint state includes message IDs from locally-appended messages (not just initial load) | Unit | `src/agent/agent.test.ts` | After persisting assistant + tool messages within a turn, verify checkpoint state's message ID list includes those new IDs |
| AC3.3 | Mid-turn checkpoint (triggered by tool) captures all messages persisted up to that point | Integration | `src/agent/agent.test.ts` | Trigger a checkpoint mid-turn (via tool invocation); verify checkpoint includes all messages persisted so far in the turn |

---

## arch-hardening.AC4: MessageStore interface

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC4.1 | `count()` returns accurate message count for a conversation | Integration | `src/persistence/message-store.test.ts` | Insert known number of messages; call `count(conversationId)`; assert matches |
| AC4.2 | `listIds()` returns all message IDs ordered by creation time | Integration | `src/persistence/message-store.test.ts` | Insert messages with known IDs and timestamps; call `listIds`; assert order matches insertion order |
| AC4.3 | `getLatest()` returns the N most recent messages as `ConversationMessage[]` | Integration | `src/persistence/message-store.test.ts` | Insert 5 messages; call `getLatest(conversationId, 3)`; assert returns last 3 in order with correct shape |

---

## arch-hardening.AC5: Structured errors adopted

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC5.1 | `checkpoint-restore.ts` throws `AgentError('CHECKPOINT_FAILED')` with `conversationId` and `checkpointId` in context | Unit | `src/agent/checkpoint-restore.test.ts` | Trigger a checkpoint failure; assert thrown error is `AgentError` with code `CHECKPOINT_FAILED` and context contains both IDs |
| AC5.2 | `traceError()` called in checkpoint-restore catch blocks | Unit | `src/agent/checkpoint-restore.test.ts` | Spy on `traceError`; trigger checkpoint failure; assert spy called with the error |
| AC5.3 | `ShellError` extends `ConstellationError` with subsystem `'shell'` | Unit | `src/errors/shell.test.ts` | Instantiate `ShellError`; assert `instanceof ConstellationError`; assert `subsystem === 'shell'` |
| AC5.4 | All four shell error codes produce errors with actionable `suggestion` field | Unit | `src/errors/shell.test.ts` | Construct `ShellError` for each code (`SHELL_CREATION_FAILED`, `COMMAND_TIMEOUT`, `MARKER_NOT_FOUND`, `SESSION_CLOSED`); assert each has a non-empty `suggestion` string |
| AC5.5 | No generic `Error` or `ShellCreationError` thrown in either file | Unit | `src/errors/shell.test.ts` | Static analysis assertion: grep `checkpoint-restore.ts` and `shell/session.ts` for `throw new Error(` and `ShellCreationError`; assert zero matches. (Alternatively, integration test that exercises all error paths and asserts all are `ConstellationError` subclasses.) |

---

## arch-hardening.AC6: Per-command shell nonces

| Criterion | Text | Type | Test File | Verifies |
|-----------|------|------|-----------|----------|
| AC6.1 | Each `execute()` call generates a unique 8-char hex nonce | Unit | `src/shell/session.test.ts` | Call `execute()` twice; extract nonces from PS1 commands sent to PTY; assert both are 8 hex chars and distinct |
| AC6.2 | `waitForMarker` only matches the nonce from the current invocation | Unit | `src/shell/session.test.ts` | Feed output containing a marker with a stale nonce; assert `waitForMarker` does not resolve; feed correct nonce marker; assert resolves |
| AC6.3 | CWD extraction uses nonce-scoped markers | Unit | `src/shell/session.test.ts` | After `execute()`, verify CWD is extracted using the nonce-bearing `___CWD_{nonce}_` pattern |
| AC6.4 | Output from a previous command containing the base marker prefix does not trigger false completion | Integration | `src/shell/session.test.ts` | Execute a command whose stdout contains the base marker prefix (e.g., `echo "[___CSML_..."`); assert the session does not falsely detect completion; only the nonce-specific marker ends the wait |

---

## Criteria Requiring Human Verification

| Criterion | Justification |
|-----------|---------------|
| AC1.6 (partial) | The "best-effort cleared to blank state" aspect is non-deterministic -- if `clearWorkingMemory` itself fails, the system is in a degraded state. Tests can verify the call is made, but the actual recovery guarantee under double-fault conditions warrants manual review of behaviour in a real database environment. |
| AC5.5 | While a grep-based test catches literal `throw new Error(`, it cannot catch all possible paths (e.g., re-thrown errors from dependencies). A human code review pass of the final diff is warranted to confirm no generic errors leak through indirection. |

---

## Test Execution Summary

| Test File | Criteria Covered | Type |
|-----------|-----------------|------|
| `src/persistence/tx-nesting.test.ts` | AC2.1 - AC2.5 | Integration (requires PostgreSQL) |
| `src/persistence/message-store.test.ts` | AC4.1 - AC4.3 | Integration (requires PostgreSQL) |
| `src/errors/shell.test.ts` | AC5.3, AC5.4, AC5.5 | Unit |
| `src/agent/checkpoint-restore.test.ts` | AC1.1 - AC1.6, AC5.1, AC5.2 | Integration (requires PostgreSQL + mocks) |
| `src/agent/agent.test.ts` | AC3.1 - AC3.3 | Integration (requires mocked dependencies) |
| `src/shell/session.test.ts` | AC6.1 - AC6.4 | Unit/Integration (requires PTY) |
