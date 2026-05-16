# Session Checkpointing — Human Test Plan

## Prerequisites
- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Migrations applied (`bun run migrate`)
- All automated tests passing (`bun test`)
- A valid `config.toml` with model provider configured

## Phase 1: Explicit Checkpoint via REPL

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | REPL prompt appears, agent is ready |
| 2 | Send a few messages to establish state (e.g., "Hello", "What is your name?") | Agent responds normally |
| 3 | Type `/checkpoint` in the REPL | Output shows "Checkpoint created: <uuid>" where uuid is a valid UUID format (8-4-4-4-12 hex) |
| 4 | Query the database: `SELECT id, trigger, owner, created_at FROM session_checkpoints ORDER BY created_at DESC LIMIT 1;` | Row exists with `trigger = 'explicit'`, `created_at` within the last few seconds, and `id` matches the UUID from step 3 |
| 5 | Query checkpoint data: `SELECT checkpoint_data->'messageIds' as msg_ids, checkpoint_data->'workingMemory' as wm FROM session_checkpoints WHERE id = '<uuid>';` | `msg_ids` is a non-empty JSON array of message IDs; `wm` is a JSON array (may be empty) |

## Phase 2: Shutdown Checkpoint via SIGTERM

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | REPL prompt appears |
| 2 | Send at least one message to establish a conversation | Agent responds normally |
| 3 | Note the daemon's PID (from `ps aux \| grep constellation` or the startup log) | PID identified |
| 4 | In a separate terminal, send SIGTERM: `kill -TERM <pid>` | Daemon shuts down gracefully (no crash output) |
| 5 | Query the database: `SELECT id, trigger, created_at FROM session_checkpoints WHERE trigger = 'shutdown' ORDER BY created_at DESC LIMIT 1;` | Row exists with `trigger = 'shutdown'` and `created_at` within seconds of the kill signal |

## Phase 3: Resume via CLI Flag

| Step | Action | Expected |
|------|--------|----------|
| 1 | Get a checkpoint ID from the database: `SELECT id FROM session_checkpoints ORDER BY created_at DESC LIMIT 1;` | Valid checkpoint UUID obtained |
| 2 | Start the daemon with resume flag: `bun run start -- --resume <checkpoint-id>` | Startup logs show "resuming from checkpoint" message, agent state is rehydrated |
| 3 | Verify working memory was restored by asking the agent about its context or checking `SELECT * FROM memory_blocks WHERE tier = 'working';` | Memory blocks match those captured in the checkpoint |
| 4 | Verify the conversation continues from where it left off (history should include messages from before the checkpoint) | Agent has awareness of prior conversation context |

## Phase 4: Resume via Config

| Step | Action | Expected |
|------|--------|----------|
| 1 | Get a checkpoint ID from the database | Valid checkpoint UUID obtained |
| 2 | Add `resume_checkpoint = "<checkpoint-id>"` to `config.toml` under the agent section | Config file saved |
| 3 | Start the daemon: `bun run start` | Startup logs show restoration from the configured checkpoint |
| 4 | Remove the `resume_checkpoint` line from `config.toml` after verification | Config cleaned up |

## Phase 5: Invalid Resume Exits

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run: `bun run start -- --resume 00000000-0000-0000-0000-000000000000` | Process exits with code 1; stderr contains message about checkpoint not found |
| 2 | Run: `bun run start -- --resume not-a-uuid` | Process exits with code 1; stderr contains message about invalid or missing checkpoint |

## End-to-End: Full Checkpoint Lifecycle

**Purpose:** Validates the complete create-persist-restore cycle across a daemon restart, ensuring no state is lost.

1. Start the daemon with `checkpoint_interval: 2` in config
2. Send 4 messages, observing agent responses. Note the conversation topic
3. Query `session_checkpoints` — expect at least 2 interval-triggered checkpoints (after turns 2 and 4)
4. Create an explicit checkpoint via `/checkpoint` — note the returned UUID
5. Stop the daemon with SIGTERM — expect a shutdown checkpoint row
6. Query `session_checkpoints` — expect at least 4 rows (2 interval + 1 explicit + 1 shutdown)
7. Restart the daemon with `--resume <explicit-checkpoint-uuid>`
8. Verify the agent remembers the conversation context and working memory from step 2
9. Send a follow-up message referencing the earlier conversation — the agent should respond coherently

## End-to-End: Pruning Under Load

**Purpose:** Validates that checkpoint retention limits are enforced over many turns.

1. Set `checkpoint_interval: 1` and `checkpoint_retention: 3` in config
2. Start the daemon and send 10 messages
3. Query `SELECT COUNT(*) FROM session_checkpoints WHERE conversation_id = '<conv-id>';`
4. Expected: exactly 3 checkpoints remain (the 3 most recent)
5. Verify the remaining checkpoints are the newest by checking `created_at` ordering

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `checkpoint-triggers.test.ts` "explicit checkpoint tool" | Phase 1 |
| AC1.2 | `checkpoint-triggers.test.ts` "pre-compaction checkpoint" | — |
| AC1.3 | `checkpoint-triggers.test.ts` "shutdown checkpoint" | Phase 2 |
| AC1.4 | `checkpoint-triggers.test.ts` "turn-interval checkpoint" | — |
| AC1.5 | `checkpoint-triggers.test.ts` "interval disabled" | — |
| AC1.6 | `checkpoint-triggers.test.ts` + `checkpoint-create.test.ts` "failure tolerance" | — |
| AC2.1–AC2.8 | `checkpoint-serializer.test.ts` (all serialization tests) | — |
| AC3.1–AC3.7 | `checkpoint-restore.test.ts` (all restoration tests) | — |
| AC4.1–AC4.4 | `checkpoint-store.test.ts` (all pruning tests) | — |
| AC5.1 | `checkpoint-store.test.ts` (implicit via migrations) | — |
| AC5.2 | `checkpoint-store.test.ts` "save and load round-trip" | — |
| AC5.3 | `checkpoint-serializer.test.ts` "Zod validation" | — |
| AC5.4 | `checkpoint-serializer.test.ts` "corrupted JSONB" | — |
| AC6.1 | — | Phase 3 |
| AC6.2 | — | Phase 4 |
| AC6.3 | `checkpoint-restore.test.ts` "auto-resume round-trip" | — |
| AC6.4 | `checkpoint-store.test.ts` "load nonexistent returns null" | Phase 5 |
