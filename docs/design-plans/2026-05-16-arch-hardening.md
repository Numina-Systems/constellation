# Architectural Hardening Design

## Summary

Constellation's agent loop maintains state across multiple systems — PostgreSQL for conversation history and scheduled tasks, an in-process `MemoryManager` for working memory, and a persistent PTY shell session — and the current checkpoint restore operation modifies all of them in sequence without atomicity guarantees. A partial failure leaves the agent in an inconsistent state: some systems reflect the checkpoint, others still reflect the prior state. This design hardens six points across the persistence, agent, and shell subsystems to eliminate that class of bug and reduce a handful of other sharp edges that have accumulated as the codebase has grown.

The central mechanism is making `PersistenceProvider` transaction-aware via `AsyncLocalStorage`, which lets deeply nested call stacks participate in the same database transaction without explicit plumbing. On top of that, checkpoint restore is restructured into three ordered tiers — pure validation, database writes, then in-memory writes — so that any failure at any tier either never started or triggers a clean rollback. The remaining fixes are smaller in scope but follow the same pattern of replacing ad hoc code with proper abstractions: raw SQL for message queries becomes a typed `MessageStore`; generic `Error` throws in the shell and checkpoint subsystems become structured `ConstellationError` subclasses; a redundant database round-trip per agent turn is eliminated; and the shell's completion markers are made per-invocation so that stale output from a previous command cannot falsely signal that the current command has finished.

## Definition of Done

Six architectural hardening fixes ship as a cohesive change that eliminates the Frankenstein-state risk in checkpoint restoration, removes redundant I/O per turn, enforces persistence abstraction boundaries, brings all new subsystems into the structured error hierarchy, and makes the shell tool a robust system primitive:

1. **Checkpoint restore is fully atomic** — DB operations wrapped in a single Postgres transaction with a dry-run validation phase for MemoryManager that checks existence, write permissions, and block limits before committing. Any failure rolls back everything.

2. **Nested transaction support via savepoints** — `withTransaction` detects if a transaction is already active and uses `SAVEPOINT`/`ROLLBACK TO`/`RELEASE` for nested logical units. This enables the atomic restore to call services that internally use transactions.

3. **History is loaded once per turn** — `processMessage()` passes the already-loaded history ref to `updateCheckpointStateAndTriggerInterval()` instead of re-querying.

4. **MessageStore interface exists** — new `src/persistence/message-store.ts` created via factory pattern (`createMessageStore(persistence)`) following CheckpointStore conventions; exposes `count(conversationId)`, `listIds(conversationId)`, `getLatest(conversationId)`. `checkpoint-restore.ts` uses it instead of raw SQL.

5. **Structured errors adopted** — `checkpoint-restore.ts` uses `AgentError` with `CHECKPOINT_FAILED` code + `traceError()` calls; `shell/session.ts` migrates to a new `ShellError` within the ConstellationError hierarchy.

6. **Shell markers use per-command nonces** — `execute()` generates an 8-char hex nonce per invocation, sets PS1 with that nonce, and `waitForMarker` matches only the current nonce.

**Out of scope:** Shell concurrency/thread-safety, command sanitisation at the tool boundary, broader persistence refactoring beyond MessageStore.

## Acceptance Criteria

### arch-hardening.AC1: Checkpoint restore is fully atomic
- **arch-hardening.AC1.1 Success:** Full restore completes — predictions, interests, and memory all reflect checkpoint state
- **arch-hardening.AC1.2 Failure:** Pre-flight rejects invalid label — no DB or memory state modified
- **arch-hardening.AC1.3 Failure:** Pre-flight rejects oversized block — no DB or memory state modified
- **arch-hardening.AC1.4 Failure:** Pre-flight rejects block count exceeding limit — no DB or memory state modified
- **arch-hardening.AC1.5 Failure:** DB write fails mid-Tier-1 — all Tier 1 writes rolled back, memory untouched
- **arch-hardening.AC1.6 Failure:** Memory write fails in Tier 2 — DB rolled back, memory best-effort cleared to blank state

### arch-hardening.AC2: Nested transaction support via savepoints
- **arch-hardening.AC2.1 Success:** Top-level `withTransaction` issues BEGIN/COMMIT
- **arch-hardening.AC2.2 Success:** Nested `withTransaction` issues SAVEPOINT/RELEASE (no BEGIN)
- **arch-hardening.AC2.3 Success:** Deeply nested transactions (depth > 2) use unique savepoint names
- **arch-hardening.AC2.4 Failure:** Nested error + rethrow rolls back savepoint and propagates to root ROLLBACK
- **arch-hardening.AC2.5 Failure:** Nested error + catch rolls back savepoint but parent transaction remains committable

### arch-hardening.AC3: History loaded once per turn
- **arch-hardening.AC3.1 Success:** `loadConversationHistory` called exactly once per `processMessage` invocation
- **arch-hardening.AC3.2 Success:** Checkpoint state includes message IDs from locally-appended messages (not just initial load)
- **arch-hardening.AC3.3 Edge:** Mid-turn checkpoint (triggered by tool) captures all messages persisted up to that point

### arch-hardening.AC4: MessageStore interface
- **arch-hardening.AC4.1 Success:** `count()` returns accurate message count for a conversation
- **arch-hardening.AC4.2 Success:** `listIds()` returns all message IDs ordered by creation time
- **arch-hardening.AC4.3 Success:** `getLatest()` returns the N most recent messages as `ConversationMessage[]`

### arch-hardening.AC5: Structured errors adopted
- **arch-hardening.AC5.1 Success:** `checkpoint-restore.ts` throws `AgentError('CHECKPOINT_FAILED')` with `conversationId` and `checkpointId` in context
- **arch-hardening.AC5.2 Success:** `traceError()` called in checkpoint-restore catch blocks
- **arch-hardening.AC5.3 Success:** `ShellError` extends `ConstellationError` with subsystem `'shell'`
- **arch-hardening.AC5.4 Success:** All four shell error codes produce errors with actionable `suggestion` field
- **arch-hardening.AC5.5 Failure:** No generic `Error` or `ShellCreationError` thrown in either file

### arch-hardening.AC6: Per-command shell nonces
- **arch-hardening.AC6.1 Success:** Each `execute()` call generates a unique 8-char hex nonce
- **arch-hardening.AC6.2 Success:** `waitForMarker` only matches the nonce from the current invocation
- **arch-hardening.AC6.3 Success:** CWD extraction uses nonce-scoped markers
- **arch-hardening.AC6.4 Edge:** Output from a previous command containing the base marker prefix does not trigger false completion

## Glossary

- **AsyncLocalStorage**: Node.js / Bun built-in that stores a value scoped to an async call chain. Used here to propagate the active database transaction client to any nested code without passing it as a parameter.
- **Savepoint**: A named marker inside a PostgreSQL transaction. Code can roll back to a savepoint without aborting the surrounding transaction, enabling recoverable sub-operations within a larger atomic unit.
- **PersistenceProvider**: Constellation's internal abstraction over the PostgreSQL connection pool. Exposes `query()` and `withTransaction()`. All database access goes through this interface.
- **MessageStore**: A new typed store (following the existing `CheckpointStore` convention) that encapsulates message-related SQL queries behind a stable interface.
- **CheckpointStore**: An existing persistence store in `src/persistence/` that snapshots and restores agent state. `MessageStore` follows the same factory pattern.
- **MemoryManager**: The in-process service managing Constellation's three-tier memory system (core, working, archival). Unlike database writes, memory writes are not transactional, which is why the Atomic Handoff Pattern addresses them separately.
- **ConstellationError**: The base structured error class for the project. Subclasses carry a `code`, `subsystem`, `context` object, and optional `suggestion` string.
- **AgentError / ShellError**: Subsystem-specific `ConstellationError` subclasses for the agent loop and shell session respectively. `ShellError` is new in this design.
- **traceError()**: A utility that records a caught error as an operation trace in the reflexion subsystem, providing a persistent audit trail of failures.
- **Atomic Handoff Pattern**: The three-tier ordering used in the restructured checkpoint restore: (0) pure validation, (1) database writes inside a transaction, (2) in-memory writes last — minimising the unprotected window.
- **Frankenstein-state**: Partial-restore inconsistency where some subsystems reflect the checkpoint and others still reflect prior state.
- **PTY (Pseudo-Terminal)**: The mechanism used by Constellation's shell session to run a persistent, stateful shell subprocess that preserves state across invocations.
- **PS1**: The shell prompt variable. Set to a known marker so the code can detect when a command has finished executing.
- **Nonce**: A single-use random value. Here, an 8-character hex string generated per `execute()` call and embedded in both the PS1 prompt and the CWD marker.
- **Factory pattern**: The project convention of exporting `createFoo(deps): FooInterface` instead of a class.
- **Barrel export**: An `index.ts` that re-exports everything from a module's files, giving consumers a single import path.
- **Composition root**: `src/index.ts` — the single place where all stores and providers are instantiated and wired together.

## Architecture

Six targeted fixes across the persistence, agent, and shell subsystems. The central architectural decision is making `PersistenceProvider` transaction-aware via `AsyncLocalStorage`, which unlocks composable atomicity for the checkpoint restore and all future multi-step operations.

### Transparent Nested Transactions

A module-level `AsyncLocalStorage<TxContext>` holds `{ client: PoolClient, depth: number }` for the active transaction. Two methods change behavior:

- **`query()`** checks the store. If a transaction context exists, routes the query through the transaction's dedicated client. Otherwise uses the pool directly.
- **`withTransaction()`** checks the store. If no context exists: acquires a client, sends `BEGIN`, runs the callback inside `txContext.run(...)`. If a context already exists: increments depth, issues `SAVEPOINT sp_{depth}`, runs the callback, then `RELEASE SAVEPOINT` on success or `ROLLBACK TO SAVEPOINT` on error.

Error semantics:
- Nested failure + rethrow → savepoint rolled back, error propagates to root `withTransaction` which issues `ROLLBACK` (full abort)
- Nested failure + catch → savepoint rolled back, parent transaction remains healthy (recoverable sub-operation)

The `PersistenceProvider` interface signature is unchanged. All existing callers gain automatic transaction participation.

### Atomic Handoff Pattern (Checkpoint Restore)

`restoreFromCheckpoint()` restructured into three tiers:

**Tier 0 — Pre-flight Validation:** Pure logical checks against MemoryManager constraints (label validity, block size limits, working block count). Throws `MemoryError` before any state is modified.

**Tier 1 — DB Writes (inside `withTransaction`):** Verify conversation via `MessageStore`, restore predictions via `PredictionStore`, restore interests via `InterestRegistry`. All undoable via `ROLLBACK`.

**Tier 2 — Memory Writes (inside same transaction, last):** Clear working memory, write all checkpoint blocks. Performed last to minimise the unprotected window between memory success and `COMMIT`. On failure: best-effort `clearWorkingMemory().catch(() => {})` then rethrow to trigger DB rollback.

Residual edge case (COMMIT fails after memory writes): handled by idempotent label-based overwrites on retry.

### MessageStore

New persistence store following CheckpointStore factory conventions:

```typescript
type MessageStore = {
  count(conversationId: string): Promise<number>;
  listIds(conversationId: string): Promise<string[]>;
  getLatest(conversationId: string, limit: number): Promise<ConversationMessage[]>;
};
```

Factory: `createMessageStore(persistence: PersistenceProvider): MessageStore`

Transaction-aware automatically via AsyncLocalStorage. Replaces raw SQL in `checkpoint-restore.ts`.

### History Loading

`updateCheckpointStateAndTriggerInterval()` gains a `currentHistory: ConversationMessage[]` parameter. After persisting each message (assistant response, tool use, tool result), the returned message is pushed onto the local array. History is updated on every persistence event within the tool loop — ensures partial turn state is captured if checkpoint triggers mid-turn.

### Structured Errors

Two migrations into the `ConstellationError` hierarchy:

1. `checkpoint-restore.ts`: generic `Error` → `AgentError('CHECKPOINT_FAILED')` with `traceError()` calls. Context includes `conversationId` and `checkpointId`.

2. New `src/errors/shell.ts`: `ShellError` extends `ConstellationError` with `subsystem: 'shell'`. Codes: `SHELL_CREATION_FAILED`, `COMMAND_TIMEOUT`, `MARKER_NOT_FOUND`, `SESSION_CLOSED`. Each includes actionable `suggestion` field.

### Per-Command Shell Nonces

`execute()` generates an 8-char hex nonce per invocation via `crypto.randomBytes(4).toString('hex')`. PS1 set to `[___CSML_${nonce}_\$?]> `. CWD markers become `___CWD_${nonce}_`. Both `markerRegex` and `cwdPattern` are generated per call, scoped entirely within `execute()`. The session-level `promptMarker` config remains as the base prefix.

## Existing Patterns

Investigation confirmed these existing patterns that this design follows:

- **Factory pattern for stores:** `createCheckpointStore(persistence)` returns an interface object with methods. `MessageStore` follows this exactly.
- **One error file per subsystem:** `src/errors/memory.ts`, `src/errors/persistence.ts`, `src/errors/agent.ts`, etc. `ShellError` gets its own `src/errors/shell.ts`.
- **Barrel exports:** `src/errors/index.ts` re-exports all error types by phase. New `ShellError` added to the barrel.
- **ConstellationError hierarchy:** `{Subsystem}Error` class + `{Subsystem}ErrorCode` type union. Constructor takes `(code, message, context?, options?)`.
- **PersistenceProvider interface:** `{ connect, disconnect, runMigrations, query, withTransaction }`. Interface remains unchanged — implementation changes are internal.
- **Composition root in `src/index.ts`:** All stores and providers instantiated here and passed as dependencies.

No divergence from existing patterns. The only new primitive is `AsyncLocalStorage` for transaction context propagation — this is additive, not a pattern change.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Transparent Nested Transactions
**Goal:** Make `PersistenceProvider` transaction-aware via AsyncLocalStorage with savepoint-based nesting

**Components:**
- `AsyncLocalStorage<TxContext>` and `TxContext` type in `src/persistence/postgres.ts`
- Modified `query()` implementation — check store, route to transaction client or pool
- Modified `withTransaction()` implementation — detect nesting, use SAVEPOINT/RELEASE/ROLLBACK TO
- Explicit `RELEASE SAVEPOINT` on nested success
- Isolated test file `src/persistence/tx-nesting.test.ts`

**Dependencies:** None (foundation for all other phases)

**Covers:** `arch-hardening.AC2.1` through `arch-hardening.AC2.5`

**Done when:** Nested transactions use savepoints, errors at any depth roll back correctly, non-transactional queries still use the pool, all nesting tests pass
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: MessageStore Interface
**Goal:** Abstract message queries behind a typed store following CheckpointStore conventions

**Components:**
- `MessageStore` type and `createMessageStore()` factory in `src/persistence/message-store.ts`
- Parameterised SQL for `count`, `listIds`, `getLatest`
- Registration in composition root (`src/index.ts`)
- Tests in `src/persistence/message-store.test.ts`

**Dependencies:** Phase 1 (MessageStore is automatically transaction-aware)

**Covers:** `arch-hardening.AC4.1` through `arch-hardening.AC4.3`

**Done when:** MessageStore methods return correct data, participate in transactions via AsyncLocalStorage, tests pass
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Structured Error Adoption
**Goal:** Migrate checkpoint-restore and shell/session to ConstellationError hierarchy

**Components:**
- New `src/errors/shell.ts` — `ShellError` class, `ShellErrorCode` type, actionable suggestions
- Updated `src/errors/index.ts` — barrel export for ShellError
- Updated `src/agent/checkpoint-restore.ts` — `AgentError('CHECKPOINT_FAILED')` + `traceError()` calls
- Updated `src/shell/session.ts` — replace `ShellCreationError` with `ShellError`, add error codes for timeout/marker/closed states
- Tests in `src/errors/shell.test.ts`

**Dependencies:** None (can proceed in parallel with Phase 2 if desired)

**Covers:** `arch-hardening.AC5.1` through `arch-hardening.AC5.5`

**Done when:** No generic `Error` thrown in checkpoint-restore or shell/session, all errors carry structured codes/context/suggestions, trace integration works, tests pass
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Atomic Checkpoint Restore
**Goal:** Restructure `restoreFromCheckpoint()` into the three-tier Atomic Handoff pattern

**Components:**
- Pre-flight validation function (`validateMemoryConstraints`) in `src/agent/checkpoint-restore.ts`
- Restructured `restoreFromCheckpoint()` — Tier 0/1/2 ordering inside `withTransaction`
- `MessageStore` integration replacing raw SQL queries
- Best-effort memory cleanup in Tier 2 catch block
- Updated `RestorationDependencies` type to include `MessageStore`
- Tests in `src/agent/checkpoint-restore.test.ts` covering atomicity scenarios

**Dependencies:** Phase 1 (nested transactions), Phase 2 (MessageStore), Phase 3 (AgentError)

**Covers:** `arch-hardening.AC1.1` through `arch-hardening.AC1.6`

**Done when:** Restore wraps all operations in a transaction, pre-flight catches constraint violations, partial failures roll back DB and best-effort clear memory, tests verify atomicity
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: History Loading Optimisation
**Goal:** Eliminate redundant `loadConversationHistory` call per turn

**Components:**
- Modified `updateCheckpointStateAndTriggerInterval()` signature — accepts `currentHistory` parameter
- Modified `processMessage()` — local append after each message persistence (assistant, tool use, tool result)
- Updated callers of `updateCheckpointStateAndTriggerInterval` to pass history
- Tests verifying history accuracy after local append

**Dependencies:** Phase 2 (uses `messageStore.getLatest` for initial load)

**Covers:** `arch-hardening.AC3.1` through `arch-hardening.AC3.3`

**Done when:** `loadConversationHistory` called once per turn, checkpoint state reflects all persisted messages including mid-turn tool rounds, tests pass
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Per-Command Shell Nonces
**Goal:** Replace static shell markers with per-invocation nonces

**Components:**
- Modified `execute()` in `src/shell/session.ts` — nonce generation, PS1 with nonce, nonce-scoped regex
- Updated CWD marker pattern to include nonce
- Updated output filtering to match nonce-aware patterns
- `promptMarker` config retained as base prefix
- Tests in `src/shell/session.test.ts` covering nonce isolation, buffered output safety

**Dependencies:** Phase 3 (ShellError for marker/timeout errors)

**Covers:** `arch-hardening.AC6.1` through `arch-hardening.AC6.4`

**Done when:** Each execute() uses a unique nonce, waitForMarker only matches current nonce, CWD extraction uses nonce-scoped markers, previous command output cannot trigger false completion, tests pass
<!-- END_PHASE_6 -->

## Additional Considerations

**Transaction-aware query safety:** Inside `query()`, the implementation must always check the AsyncLocalStorage store first. Using `pool.query` accidentally when a transaction is active would execute outside the transaction and see stale data.

**Aborted transaction recovery:** Savepoints prevent the PostgreSQL "current transaction is aborted" error from poisoning the entire transaction. Rolling back to a savepoint repairs the transaction state so the parent can continue.

**Idempotent retry after COMMIT failure:** The residual Frankenstein edge case (memory writes succeed, COMMIT fails) is handled by label-based idempotency in `MemoryManager.write()`. A retry of the full restore will overwrite the orphaned memory blocks rather than creating duplicates.
