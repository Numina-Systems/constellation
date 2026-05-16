# Session Checkpointing Design

## Summary

Constellation's conversation persistence is append-only: messages are written to PostgreSQL as they occur, but the full agent state — working memory blocks, pending prediction journals, active interest state, compaction metadata, recall cache, and in-flight tool round context — is not captured as a coherent snapshot. If the daemon crashes, is restarted, or the operator wants to pause and resume a conversation later, all of this ephemeral state is lost. The conversation messages survive, but the agent's "mental state" does not.

This feature adds event-log checkpointing: the ability to serialize the full agent state to a `session_checkpoints` PostgreSQL table and restore it later. Checkpoints are triggered explicitly (user command), automatically (pre-compaction, pre-shutdown, configurable turn interval), and pruned to keep storage bounded. On startup, the agent can resume from a specific checkpoint, reconstructing its full state as if the conversation had never been interrupted.

Ported from Pattern's event-log checkpointing design, adapted for Constellation's PostgreSQL persistence, `AgentDependencies` composition, and existing memory/reflexion/subconscious subsystems.

## Definition of Done

1. A `SessionCheckpoint` type captures the full recoverable agent state: conversation messages, working memory blocks, pending predictions, active interests, compaction metadata, recall cache, and tool round state.
2. Checkpoints are serialized to PostgreSQL as JSONB in a new `session_checkpoints` table.
3. Checkpoints are created on explicit command, pre-compaction, graceful shutdown, and optionally every N turns.
4. Restoration from a checkpoint reconstructs agent state with full fidelity — the agent behaves as if the conversation was never interrupted.
5. Old checkpoints are pruned to keep the last N per conversation (configurable, default 5).
6. A new append-only migration creates the `session_checkpoints` table.

## Acceptance Criteria

### session-checkpointing.AC1: Checkpoint Creation
- **session-checkpointing.AC1.1 Success:** Explicit `/checkpoint` command creates a checkpoint and confirms with the checkpoint ID
- **session-checkpointing.AC1.2 Success:** Pre-compaction checkpoint is created automatically before compaction runs
- **session-checkpointing.AC1.3 Success:** Graceful shutdown (SIGTERM/SIGINT) creates a checkpoint before exit
- **session-checkpointing.AC1.4 Success:** Turn-interval checkpoint fires every N turns when `checkpoint_interval` is configured (e.g., every 10 turns)
- **session-checkpointing.AC1.5 Edge:** Turn-interval of 0 disables interval-based checkpointing (only explicit/pre-compaction/shutdown triggers remain)
- **session-checkpointing.AC1.6 Edge:** Checkpoint creation failure (DB error) does not block the agent loop — warning is logged, operation continues

### session-checkpointing.AC2: Checkpoint Content
- **session-checkpointing.AC2.1 Success:** Checkpoint includes full conversation message history (message IDs, not content — content is in the messages table)
- **session-checkpointing.AC2.2 Success:** Checkpoint includes all working memory block labels and content
- **session-checkpointing.AC2.3 Success:** Checkpoint includes pending prediction journal entries (predictions awaiting review)
- **session-checkpointing.AC2.4 Success:** Checkpoint includes active interest state from the subconscious module (interest labels, decay values)
- **session-checkpointing.AC2.5 Success:** Checkpoint includes compaction metadata (last compacted message index, summary count)
- **session-checkpointing.AC2.6 Success:** Checkpoint includes recall cache (last decomposition result, if any)
- **session-checkpointing.AC2.7 Success:** Checkpoint includes current turn number and tool round count
- **session-checkpointing.AC2.8 Edge:** Checkpoint with empty working memory / no predictions / no interests serializes cleanly (empty arrays, not null)

### session-checkpointing.AC3: Restoration Fidelity
- **session-checkpointing.AC3.1 Success:** Restored agent sees the same conversation history as when checkpointed
- **session-checkpointing.AC3.2 Success:** Restored agent's working memory matches the checkpoint state (not the current DB state if it diverged)
- **session-checkpointing.AC3.3 Success:** Restored agent's pending predictions are present and reviewable
- **session-checkpointing.AC3.4 Success:** Restored agent's active interests resume with their checkpointed decay values
- **session-checkpointing.AC3.5 Success:** Compaction metadata is restored so the next compaction check uses the correct baseline
- **session-checkpointing.AC3.6 Failure:** Restoring a checkpoint for a conversation that has been deleted fails with a clear error (not a silent empty state)
- **session-checkpointing.AC3.7 Edge:** Restoring the same checkpoint twice produces identical state each time (idempotent)

### session-checkpointing.AC4: Pruning
- **session-checkpointing.AC4.1 Success:** After creating a new checkpoint, old checkpoints beyond the retention limit are deleted
- **session-checkpointing.AC4.2 Success:** Retention limit is configurable via `checkpoint_retention` (default 5)
- **session-checkpointing.AC4.3 Success:** Pruning deletes by `created_at` ascending (oldest first)
- **session-checkpointing.AC4.4 Edge:** Conversations with fewer checkpoints than the retention limit are unaffected by pruning

### session-checkpointing.AC5: Storage and Migration
- **session-checkpointing.AC5.1 Success:** New `session_checkpoints` table is created via append-only migration
- **session-checkpointing.AC5.2 Success:** Table schema: `id` (UUID PK), `conversation_id` (text, indexed), `owner` (text), `trigger` (text — 'explicit', 'pre_compaction', 'shutdown', 'interval'), `checkpoint_data` (JSONB), `created_at` (timestamptz, default now())
- **session-checkpointing.AC5.3 Success:** `checkpoint_data` JSONB is validated with a Zod schema on read (defensive deserialization)
- **session-checkpointing.AC5.4 Edge:** Corrupted `checkpoint_data` JSONB fails validation with a clear error rather than crashing the agent

### session-checkpointing.AC6: Resume Startup
- **session-checkpointing.AC6.1 Success:** `--resume <checkpoint_id>` CLI flag loads the specified checkpoint on startup
- **session-checkpointing.AC6.2 Success:** `resume_checkpoint` config option provides the same functionality via config.toml
- **session-checkpointing.AC6.3 Success:** If no checkpoint ID is provided but `auto_resume` is true, the most recent checkpoint for the configured owner is loaded
- **session-checkpointing.AC6.4 Failure:** Invalid or missing checkpoint ID produces a clear startup error and the daemon does not start

## Glossary

- **SessionCheckpoint**: The serializable type capturing full recoverable agent state at a point in time.
- **Checkpoint trigger**: The event that causes a checkpoint to be created — explicit command, pre-compaction, shutdown, or turn interval.
- **Restoration**: The process of deserializing a checkpoint and reconstructing agent state from it.
- **Pruning**: Deleting old checkpoints beyond the retention limit to bound storage.
- **Working memory blocks**: The `working` tier of the three-tier memory system. Mutable blocks that the agent updates during conversation. Persisted to DB but also held in the agent's active state.
- **Prediction journal**: Entries from `src/reflexion/` where the agent records predictions about outcomes and later reviews them. Pending predictions are those awaiting review.
- **Active interests**: State from `src/subconscious/` tracking the agent's current curiosity threads, engagement levels, and decay values.
- **Compaction metadata**: Internal state tracking which messages have been compacted and how many summaries have been generated. Needed to avoid re-compacting already-compacted messages.
- **Recall cache**: The last `RecallResult` from the reflexive recall pipeline, cached to avoid redundant decomposition within a turn.
- **Tool round state**: The current position within the tool-use loop (round number, pending tool calls). Less critical for restoration but useful for debugging.
- **JSONB**: PostgreSQL's binary JSON type. Efficient for storage and querying of structured data.
- **Append-only migration**: A new `.sql` file in `src/persistence/migrations/` that creates new tables/columns without modifying existing ones.

## Architecture

Session checkpointing captures the agent's full ephemeral state as a JSONB snapshot in PostgreSQL. The snapshot is a serialization of everything the agent "knows" beyond what's in the messages table — memory state, prediction state, interest state, and operational metadata.

### Components

**CheckpointSerializer** (`src/agent/checkpoint-serializer.ts`, Functional Core) — Pure functions that serialize agent state to and from `SessionCheckpoint`. `serializeCheckpoint(state)` collects state from multiple subsystems into a single serializable object. `deserializeCheckpoint(data)` validates JSONB data with Zod and returns typed state. No I/O — just data transformation.

**CheckpointStore** (`src/persistence/checkpoint-store.ts`, Imperative Shell) — PostgreSQL adapter for checkpoint CRUD. `saveCheckpoint(checkpoint)` inserts a new row. `loadCheckpoint(id)` retrieves and deserializes a specific checkpoint. `loadLatest(owner)` retrieves the most recent checkpoint for an owner. `pruneCheckpoints(conversationId, retainCount)` deletes old checkpoints beyond the retention limit. Uses the existing `PersistenceAdapter` connection pool.

**Checkpoint triggers** (integrated into `src/agent/agent.ts` and `src/index.ts`, Imperative Shell) — Four trigger points:
1. Explicit: `/checkpoint` command registered as a built-in tool
2. Pre-compaction: checkpoint created before `compress()` is called
3. Shutdown: checkpoint created in SIGTERM/SIGINT handler
4. Interval: checkpoint created every N turns (configurable)

**Restoration** (integrated into `src/index.ts`, Imperative Shell) — On startup, if a checkpoint ID is provided (CLI flag or config), load the checkpoint and use it to initialize agent state instead of starting fresh.

### Contracts

```typescript
// src/agent/checkpoint-types.ts

type CheckpointTrigger = 'explicit' | 'pre_compaction' | 'shutdown' | 'interval';

type SessionCheckpoint = {
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<{
    readonly label: string;
    readonly content: string;
  }>;
  readonly pendingPredictions: ReadonlyArray<{
    readonly id: string;
    readonly prediction: string;
    readonly createdAt: string;
  }>;
  readonly activeInterests: ReadonlyArray<{
    readonly label: string;
    readonly engagement: number;
    readonly decayRate: number;
  }>;
  readonly compactionMetadata: {
    readonly lastCompactedIndex: number;
    readonly summaryCount: number;
  };
  readonly recallCache: {
    readonly decomposition: { queries: string[]; entities: string[] } | null;
    readonly fragmentCount: number;
  } | null;
  readonly createdAt: string;
};
```

```typescript
// src/agent/checkpoint-serializer.ts

function serializeCheckpoint(
  conversationId: string,
  owner: string,
  trigger: CheckpointTrigger,
  state: AgentCheckpointState,
): SessionCheckpoint;

function deserializeCheckpoint(
  data: unknown,
): SessionCheckpoint;  // throws on validation failure
```

```typescript
// src/persistence/checkpoint-store.ts

type CheckpointStore = {
  save(checkpoint: SessionCheckpoint): Promise<void>;
  load(id: string): Promise<SessionCheckpoint | null>;
  loadLatest(owner: string): Promise<SessionCheckpoint | null>;
  prune(conversationId: string, retainCount: number): Promise<number>;  // returns deleted count
};

function createCheckpointStore(pool: PgPool): CheckpointStore;
```

### Data Flow: Checkpoint Creation

```
Trigger fires (explicit / pre-compaction / shutdown / interval)
    │
    ├── Collect agent state
    │   ├── conversationId, owner, turnNumber, toolRound
    │   ├── messageIds from conversation history
    │   ├── working memory blocks from memory system
    │   ├── pending predictions from reflexion module
    │   ├── active interests from subconscious module
    │   ├── compaction metadata from compactor state
    │   └── recall cache from recall context state
    │
    ├── serializeCheckpoint(...)
    │
    ├── checkpointStore.save(checkpoint)
    │
    └── checkpointStore.prune(conversationId, retainCount)
```

### Data Flow: Restoration

```
Startup with --resume <id> or auto_resume=true
    │
    ├── checkpointStore.load(id) or checkpointStore.loadLatest(owner)
    │
    ├── deserializeCheckpoint(data)  ← Zod validation
    │
    ├── Reconstruct agent state
    │   ├── Load conversation messages by IDs
    │   ├── Set working memory blocks
    │   ├── Restore pending predictions
    │   ├── Restore active interests with decay values
    │   ├── Set compaction metadata baseline
    │   └── Warm recall cache (if present)
    │
    └── Agent loop starts with restored state
```

## Existing Patterns

- **PersistenceAdapter** — `src/persistence/` provides the PostgreSQL connection pool and query utilities. `CheckpointStore` uses the same pool and follows the same adapter pattern.
- **Append-only migrations** — `src/persistence/migrations/` contains numbered `.sql` files. New migration follows the same convention.
- **Zod validation** — Config and persistence types use Zod for runtime validation. Checkpoint deserialization follows the same pattern.
- **Factory functions** — `createCheckpointStore()` returns the interface. No classes.
- **Signal handling** — `src/index.ts` already registers SIGTERM/SIGINT handlers for cleanup. Shutdown checkpointing hooks into the same handlers.
- **Built-in tools** — `src/tool/` contains tool definitions registered with the tool registry. `/checkpoint` follows the same pattern as other built-in commands.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types and Serialization

**Goal:** Define the `SessionCheckpoint` type and pure serialization/deserialization functions with Zod validation.

**Components:**
- `src/agent/checkpoint-types.ts` (Functional Core) — `SessionCheckpoint`, `CheckpointTrigger`, `AgentCheckpointState` types, Zod schema for checkpoint validation
- `src/agent/checkpoint-serializer.ts` (Functional Core) — `serializeCheckpoint()` and `deserializeCheckpoint()` pure functions
- `src/agent/checkpoint-serializer.test.ts` — Unit tests: round-trip serialization (serialize then deserialize produces identical state), empty arrays serialize cleanly, corrupted data fails validation with clear error, missing fields fail validation

**Dependencies:** None

**Covers:** session-checkpointing.AC2 (checkpoint content), session-checkpointing.AC5.3 (Zod validation), session-checkpointing.AC5.4 (corruption handling)

**Done when:** Serialization round-trips cleanly. Zod validation catches corrupted/malformed data. Empty state serializes without nulls. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Database Migration and Store

**Goal:** Create the `session_checkpoints` table and implement the PostgreSQL adapter for checkpoint CRUD and pruning.

**Components:**
- `src/persistence/migrations/NNN_create_session_checkpoints.sql` — Append-only migration: `session_checkpoints` table with `id` (UUID PK), `conversation_id` (text, indexed), `owner` (text, indexed), `trigger` (text), `checkpoint_data` (JSONB), `created_at` (timestamptz default now())
- `src/persistence/checkpoint-store.ts` (Imperative Shell) — `createCheckpointStore()` factory implementing `save`, `load`, `loadLatest`, `prune`
- `src/persistence/checkpoint-store.test.ts` — Integration tests against test database: save and load round-trip, loadLatest returns most recent, prune deletes oldest beyond retention, prune returns deleted count, load nonexistent returns null

**Dependencies:** Phase 1 (uses `SessionCheckpoint` type)

**Covers:** session-checkpointing.AC5 (storage and migration), session-checkpointing.AC4 (pruning)

**Done when:** Migration runs cleanly. Store saves, loads, and prunes checkpoints correctly. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Checkpoint Triggers

**Goal:** Wire checkpoint creation into the four trigger points: explicit command, pre-compaction, shutdown, and turn interval.

**Components:**
- `src/tool/checkpoint-tool.ts` (Imperative Shell) — `/checkpoint` tool definition that collects agent state and delegates to checkpoint creation
- `src/agent/agent.ts` — Add pre-compaction checkpoint call before `compress()`. Add turn-interval checkpoint logic (fire every N turns when configured). Expose `createCheckpoint()` method on agent for external triggers.
- `src/index.ts` — Add checkpoint creation to SIGTERM/SIGINT handler (before existing cleanup). Wire checkpoint tool into tool registry.
- `src/config/schema.ts` — Add `checkpoint_interval` (number, default 0 = disabled), `checkpoint_retention` (number, default 5), `auto_resume` (boolean, default false), `resume_checkpoint` (string, optional) to config schema

**Dependencies:** Phases 1, 2

**Covers:** session-checkpointing.AC1 (checkpoint creation), session-checkpointing.AC1.6 (failure tolerance)

**Done when:** All four trigger points create checkpoints. Checkpoint creation failure logs a warning but doesn't block the agent. Turn-interval of 0 disables interval checkpointing. Config fields parsed and validated. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Restoration

**Goal:** Implement checkpoint restoration on startup, reconstructing full agent state from a serialized checkpoint.

**Components:**
- `src/agent/checkpoint-restore.ts` (Imperative Shell) — `restoreFromCheckpoint(checkpoint, deps)` function that reconstructs agent state: loads messages by ID, sets working memory, restores predictions, restores interests, sets compaction baseline, warms recall cache
- `src/index.ts` — On startup, check for `--resume` CLI flag or `resume_checkpoint` config. If `auto_resume` is true and no explicit ID, load latest checkpoint for owner. Call `restoreFromCheckpoint()` before entering agent loop.
- `src/agent/checkpoint-restore.test.ts` — Integration tests: restored messages match checkpoint, working memory matches, predictions are reviewable, interests have correct decay values, compaction baseline is set, missing checkpoint ID fails with clear error, corrupted checkpoint fails with clear error

**Dependencies:** Phase 2 (needs CheckpointStore), Phase 3 (needs checkpoint creation to produce test data)

**Covers:** session-checkpointing.AC3 (restoration fidelity), session-checkpointing.AC6 (resume startup)

**Done when:** Agent restored from checkpoint behaves identically to agent at checkpoint time. Missing or invalid checkpoint IDs produce clear errors. Restoration is idempotent. Build succeeds (`bun run build`). All tests pass.
<!-- END_PHASE_4 -->

## Additional Considerations

**Checkpoint size.** Working memory and prediction journals are typically small (< 100KB total). Conversation message IDs are stored instead of full message content, keeping checkpoint size bounded. The JSONB column should be monitored for bloat if conversations grow very long — the message ID array alone could become large for conversations with thousands of turns.

**Atomicity.** Checkpoint creation should be a single transaction: insert the checkpoint row and prune old checkpoints atomically. If pruning fails, the checkpoint is still saved (pruning is a best-effort cleanup, not a critical operation).

**Shutdown race condition.** The SIGTERM handler has limited time before the process is forcefully killed. Checkpoint serialization and persistence should complete within a few hundred milliseconds. If the DB connection is already closed or the write takes too long, the shutdown checkpoint is best-effort — the agent should not hang waiting for it.

**Version compatibility.** The Zod schema for `checkpoint_data` should include a `version` field (starting at 1) so future changes to the checkpoint format can be detected and migrated. Deserialization should reject unknown versions with a clear error rather than silently dropping fields.

**Relationship to batch-anchored-snapshots.** If batch-anchored-snapshots is implemented, the snapshot state (per-provider content hashes) could also be checkpointed. This is a nice-to-have — the snapshot state is cheap to recompute from scratch, so it's not critical for restoration fidelity.
