# Human Test Plan: Architectural Hardening

## Overview

This test plan covers manual verification of the architectural hardening implementation across 6 phases: nested transactions, MessageStore, error hierarchy, atomic checkpoint restore, redundant query elimination, and per-invocation shell nonces.

## Prerequisites

- PostgreSQL running with pgvector (`docker compose up -d`)
- Bun installed
- `bun run migrate` executed
- REPL accessible via `bun run start`

## Test Scenarios

### Phase 1: Nested Transactions (AC2)

- [ ] **AC2.1 Manual**: Start the daemon, trigger a tool that writes to DB. Verify the write persists after the tool completes. Kill the process mid-transaction (Ctrl+C during a long tool execution) and verify no partial writes.

- [ ] **AC2.2-2.3 Manual**: Trigger checkpoint creation which calls nested persistence operations (e.g., interest updates inside transaction). Verify all state is consistent — no partially-written checkpoints.

### Phase 2: MessageStore (AC4)

- [ ] **AC4 Manual**: Start a conversation with several messages. Use the REPL to verify `messageStore.count()` matches expected message count. Verify `getLatest(id, 3)` returns the last 3 messages in reverse chronological order.

### Phase 3: Error Hierarchy (AC5)

- [ ] **AC5.3-5.4 Manual**: Trigger a shell error (e.g., execute with a killed shell session). Verify the error output includes the `suggestion` field and identifies itself as subsystem `'shell'`.

- [ ] **AC5.1-5.2 Manual**: Attempt to restore from a corrupted/nonexistent checkpoint. Verify the error includes `conversationId` and `checkpointId` in its output, and that an operation trace is recorded in the DB.

### Phase 4: Atomic Checkpoint Restore (AC1)

- [ ] **AC1.1 Manual**: Create a checkpoint via the REPL. Modify working memory. Restore from the checkpoint. Verify memory returns to checkpoint state.

- [ ] **AC1.5-1.6 Manual**: Verify that if the database becomes unavailable during restore (e.g., stop PostgreSQL container), the system handles the failure gracefully — no partial state, error is traced.

### Phase 5: Single History Load (AC3)

- [ ] **AC3.1 Manual**: Enable PostgreSQL query logging (`log_statement = 'all'`). Send a message. Grep the logs for `SELECT ... FROM messages WHERE conversation_id ... ORDER BY created_at ASC`. Verify it appears exactly once per turn, not twice.

- [ ] **AC3.2 Manual**: After a multi-turn conversation, inspect checkpoint state (via REPL or DB query on `checkpoints` table). Verify `message_ids` array includes IDs for all messages in the conversation including the most recent.

### Phase 6: Per-Invocation Shell Nonces (AC6)

- [ ] **AC6.1 Manual**: Execute two shell commands in sequence via the agent. Inspect the shell session's terminal output (enable debug logging). Verify each command uses a different PS1 marker containing a hex nonce.

- [ ] **AC6.4 Manual**: Execute a command that outputs text resembling a shell marker (e.g., `echo "[___CSML___0]> "`). Verify the agent does NOT treat this as command completion. The next command should execute normally.

- [ ] **AC6.2 Manual**: Run a long-running command that produces a lot of output. Verify the correct output is captured and no false completion occurs even when output accidentally contains marker-like patterns.

## Regression Checks

- [ ] Full test suite passes: `bun test` (expect pre-existing 6-7 failures in compaction/search integration tests requiring Ollama)
- [ ] Type check passes: `bun run build`
- [ ] REPL starts successfully: `bun run start`
- [ ] Multi-turn conversation works end-to-end (memory writes, tool use, compaction)
- [ ] Shell tool executes commands correctly (exit codes, output, CWD tracking)
