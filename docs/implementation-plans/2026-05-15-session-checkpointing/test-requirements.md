# Session Checkpointing — Test Requirements

## Automated Test Coverage

### session-checkpointing.AC1: Checkpoint Creation

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC1.1 | unit | `src/agent/checkpoint-triggers.test.ts` | Simulate `checkpoint` tool call via mock agent; assert `checkpointStore.save` called with `trigger: 'explicit'` and response includes the checkpoint ID |
| AC1.2 | unit | `src/agent/checkpoint-triggers.test.ts` | Create agent with compactor and checkpoint deps; trigger compaction by exceeding context budget; assert checkpoint saved with `trigger: 'pre_compaction'` before `compress()` runs |
| AC1.3 | unit | `src/agent/checkpoint-triggers.test.ts` | Call the shutdown checkpoint callback directly; assert checkpoint saved with `trigger: 'shutdown'` via `checkpointStore.save` |
| AC1.4 | unit | `src/agent/checkpoint-triggers.test.ts` | Create agent with `checkpoint_interval: 2`; process 4 messages; assert checkpoints with `trigger: 'interval'` saved after turns 2 and 4 |
| AC1.5 | unit | `src/agent/checkpoint-triggers.test.ts` | Create agent with `checkpoint_interval: 0`; process 4 messages; assert no interval-triggered checkpoints created |
| AC1.6 | unit | `src/agent/checkpoint-create.test.ts` | Stub `checkpointStore.save` to throw; call `performCheckpoint()`; assert returns `null` without propagating exception |

### session-checkpointing.AC2: Checkpoint Content

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC2.1 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with `messageIds: ['msg-1', 'msg-2', 'msg-3']`; deserialize; assert `messageIds` matches exactly |
| AC2.2 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with working memory blocks `[{label: 'goals', content: 'Be helpful'}]`; deserialize; assert `workingMemory` matches |
| AC2.3 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with pending predictions including `predictionText`, `domain`, `confidence`, `createdAt`; deserialize; assert `pendingPredictions` matches |
| AC2.4 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with active interests including `name`, `engagementScore`, `status`, `lastEngagedAt`; deserialize; assert `activeInterests` matches |
| AC2.5 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with `compactionMeta: { lastCompactedIndex: 42, summaryCount: 3 }`; deserialize; assert `compactionMeta` matches |
| AC2.6 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with populated `recallCache` (decomposition + fragmentCount) and with `recallCache: null`; deserialize both; assert values match |
| AC2.7 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with `turnNumber: 15`, `toolRound: 3`; deserialize; assert both fields match |
| AC2.8 | unit | `src/agent/checkpoint-serializer.test.ts` | Serialize with all arrays empty and `recallCache: null`; deserialize; assert all arrays are `[]` (not null/undefined) and `recallCache` is `null` |

### session-checkpointing.AC3: Restoration Fidelity

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC3.1 | integration | `src/agent/checkpoint-restore.test.ts` | Seed DB with messages; create checkpoint; call `restoreFromCheckpoint()`; verify message ID coverage via verification query against messages table |
| AC3.2 | integration | `src/agent/checkpoint-restore.test.ts` | Seed DB with working memory; create checkpoint; add new block and modify existing block in DB; restore; assert working memory matches checkpoint state (new block removed, original content restored) |
| AC3.3 | integration | `src/agent/checkpoint-restore.test.ts` | Create checkpoint with pending prediction; delete prediction from DB; call `restoreFromCheckpoint()`; assert no exception thrown (discrepancy logged, not fatal) |
| AC3.4 | integration | `src/agent/checkpoint-restore.test.ts` | Seed DB with interests; create checkpoint; change engagement score in DB; restore; assert score reverted to checkpoint value. Also: delete interest from DB, restore, assert no exception |
| AC3.5 | integration | `src/agent/checkpoint-restore.test.ts` | Create checkpoint with `compactionMeta: { lastCompactedIndex: 42, summaryCount: 3 }`; restore; assert `RestorationResult.compactionMeta` matches |
| AC3.6 | integration | `src/agent/checkpoint-restore.test.ts` | Create checkpoint referencing a conversation with messages; delete all messages; call `restoreFromCheckpoint()`; assert thrown error contains "no messages" |
| AC3.7 | integration | `src/agent/checkpoint-restore.test.ts` | Seed DB; create checkpoint; call `restoreFromCheckpoint()` twice; assert working memory, interests, and returned metadata are identical after both calls |

### session-checkpointing.AC4: Pruning

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC4.1 | integration | `src/persistence/checkpoint-store.test.ts` | Save 5 checkpoints for one conversation; call `prune(conversationId, 3)`; assert returns 2 deleted and 3 newest remain loadable |
| AC4.2 | integration | `src/persistence/checkpoint-store.test.ts` | Verify `retainCount` parameter controls retention (test with values 1, 3, 5); assert correct number of checkpoints retained each time |
| AC4.3 | integration | `src/persistence/checkpoint-store.test.ts` | Save 5 checkpoints with sequential timestamps; prune to 3; assert the 2 oldest (by `created_at`) are deleted while the 3 newest survive |
| AC4.4 | integration | `src/persistence/checkpoint-store.test.ts` | Save 2 checkpoints; call `prune(conversationId, 5)`; assert returns 0 deleted and both checkpoints remain loadable |

### session-checkpointing.AC5: Storage and Migration

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC5.1 | integration | `src/persistence/checkpoint-store.test.ts` | Migration runs via `persistence.runMigrations()` in `beforeAll`; table existence verified implicitly by successful INSERT/SELECT in all store tests |
| AC5.2 | integration | `src/persistence/checkpoint-store.test.ts` | Save a checkpoint and load it; assert all denormalized columns (`id`, `conversation_id`, `owner`, `trigger`, `created_at`) populated correctly alongside `checkpoint_data` JSONB |
| AC5.3 | unit | `src/agent/checkpoint-serializer.test.ts` | Deserialize valid data through `JSON.parse(JSON.stringify(...))` (simulating JSONB round-trip); assert Zod validation passes and returns typed `SessionCheckpoint` |
| AC5.4 | unit | `src/agent/checkpoint-serializer.test.ts` | Attempt to deserialize corrupted inputs: missing field, wrong type, unknown version (`version: 99`), null, string, partial object, `workingMemory: null`; assert each throws with descriptive error |

### session-checkpointing.AC6: Resume Startup

| Criterion | Type | Test File | Description |
|-----------|------|-----------|-------------|
| AC6.3 | integration | `src/agent/checkpoint-restore.test.ts` | Save multiple checkpoints for the same owner; call `checkpointStore.loadLatest(owner)`; assert most recent checkpoint returned and restoration succeeds |
| AC6.4 | integration | `src/agent/checkpoint-restore.test.ts` | Call `checkpointStore.load()` with nonexistent UUID; assert returns `null` (composition root translates to `process.exit(1)`) |

## Human Verification Required

| Criterion | Why Manual | Verification Approach |
|-----------|------------|----------------------|
| AC1.1 (partial) | The REPL confirmation message format ("Checkpoint created: <uuid>") requires visual inspection of live tool output rendering | Start daemon, issue `/checkpoint` in the REPL, verify output includes a UUID checkpoint ID. Query `session_checkpoints` table to confirm the row exists with `trigger = 'explicit'`. |
| AC1.3 (partial) | OS signal handling (SIGTERM/SIGINT) interacts with process lifecycle and shutdown timing; automated tests risk race conditions and flakiness | Start daemon, send `SIGTERM` via `kill -TERM <pid>`, query `session_checkpoints` for a row with `trigger = 'shutdown'` and `created_at` within the last few seconds. |
| AC6.1 | CLI flag parsing (`--resume <id>`) requires spawning the full daemon process with arguments; the composition root startup sequence is not unit-testable in isolation | Create a checkpoint via the REPL, stop the daemon, restart with `bun run start -- --resume <id>`, verify logs show "resuming from checkpoint" and agent state matches the checkpoint. |
| AC6.2 | Config-driven resume (`resume_checkpoint` in config.toml) requires full daemon startup with config file parsing; same composition root concern as AC6.1 | Set `resume_checkpoint = "<id>"` in `config.toml`, start the daemon, verify restoration occurs via log output and agent state inspection. |
| AC6.4 (partial) | The `process.exit(1)` behaviour on invalid/missing checkpoint ID is a composition root concern that cannot be tested without spawning a subprocess | Run `bun run start -- --resume nonexistent-uuid`, verify process exits with code 1 and stderr contains "checkpoint ... not found". |
