# Session Checkpointing Test Requirements

Generated from Acceptance Criteria in the design plan.

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| session-checkpointing.AC1.2 | Pre-compaction checkpoint is created automatically before compaction runs | integration | src/agent/checkpoint-restore.test.ts | 3 |
| session-checkpointing.AC1.4 | Turn-interval checkpoint fires every N turns when `checkpoint_interval` is configured | unit | src/agent/checkpoint-restore.test.ts | 3 |
| session-checkpointing.AC1.5 | Turn-interval of 0 disables interval-based checkpointing | unit | src/agent/checkpoint-restore.test.ts | 3 |
| session-checkpointing.AC1.6 | Checkpoint creation failure (DB error) does not block the agent loop — warning is logged | integration | src/agent/checkpoint-restore.test.ts | 3 |
| session-checkpointing.AC2.1 | Checkpoint includes full conversation message history (message IDs, not content) | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.2 | Checkpoint includes all working memory block labels and content | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.3 | Checkpoint includes pending prediction journal entries | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.4 | Checkpoint includes active interest state (labels, decay values) | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.5 | Checkpoint includes compaction metadata (last compacted index, summary count) | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.6 | Checkpoint includes recall cache (last decomposition result) | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.7 | Checkpoint includes current turn number and tool round count | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC2.8 | Checkpoint with empty working memory / no predictions / no interests serializes cleanly (empty arrays, not null) | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC3.1 | Restored agent sees the same conversation history as when checkpointed | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.2 | Restored agent's working memory matches the checkpoint state | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.3 | Restored agent's pending predictions are present and reviewable | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.4 | Restored agent's active interests resume with checkpointed decay values | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.5 | Compaction metadata is restored so next compaction check uses correct baseline | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.6 | Restoring a checkpoint for a deleted conversation fails with a clear error | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC3.7 | Restoring the same checkpoint twice produces identical state (idempotent) | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC4.1 | After creating a new checkpoint, old checkpoints beyond retention limit are deleted | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC4.2 | Retention limit is configurable via `checkpoint_retention` (default 5) | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC4.3 | Pruning deletes by `created_at` ascending (oldest first) | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC4.4 | Conversations with fewer checkpoints than retention limit are unaffected by pruning | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC5.1 | New `session_checkpoints` table is created via append-only migration | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC5.2 | Table schema matches spec (id UUID PK, conversation_id, owner, trigger, checkpoint_data JSONB, created_at) | integration | src/persistence/checkpoint-store.test.ts | 2 |
| session-checkpointing.AC5.3 | `checkpoint_data` JSONB is validated with Zod schema on read | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC5.4 | Corrupted `checkpoint_data` JSONB fails validation with clear error rather than crashing | unit | src/agent/checkpoint-serializer.test.ts | 1 |
| session-checkpointing.AC6.3 | If no checkpoint ID is provided but `auto_resume` is true, most recent checkpoint for owner is loaded | integration | src/agent/checkpoint-restore.test.ts | 4 |
| session-checkpointing.AC6.4 | Invalid or missing checkpoint ID produces a clear startup error and daemon does not start | integration | src/agent/checkpoint-restore.test.ts | 4 |

## Human Verification Required

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| session-checkpointing.AC1.1 | Explicit `/checkpoint` command creates a checkpoint and confirms with checkpoint ID | Requires live REPL interaction with tool dispatch | Start the daemon, issue `/checkpoint` in the REPL, verify confirmation message includes a UUID checkpoint ID. Inspect `session_checkpoints` table to confirm the row exists. |
| session-checkpointing.AC1.3 | Graceful shutdown (SIGTERM/SIGINT) creates a checkpoint before exit | Signal handling and shutdown timing are difficult to test in automated unit tests without race conditions | Start the daemon, send SIGTERM (`kill -TERM <pid>`), then query `session_checkpoints` for a row with `trigger = 'shutdown'` and a `created_at` within the last few seconds. |
| session-checkpointing.AC6.1 | `--resume <checkpoint_id>` CLI flag loads the specified checkpoint on startup | Requires full daemon startup with CLI argument parsing | Create a checkpoint via the REPL, stop the daemon, restart with `--resume <id>`, verify the agent's working memory and conversation state match the checkpoint. |
| session-checkpointing.AC6.2 | `resume_checkpoint` config option provides the same functionality via config.toml | Requires full daemon startup with config file parsing | Set `resume_checkpoint = "<id>"` in config.toml, start the daemon, verify restoration occurs. Check logs for restoration confirmation message. |
