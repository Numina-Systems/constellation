# Session Checkpointing Implementation Plan — Phase 1

**Goal:** Define the `SessionCheckpoint` type and pure serialization/deserialization functions with Zod validation.

**Architecture:** Functional Core module with types defined locally (following `snapshot.ts` and `cache-diagnostics.ts` pattern). Zod schema validates checkpoint data on deserialization. Serializer collects agent state into a flat checkpoint structure. No I/O — pure data transformation.

**Tech Stack:** Bun (TypeScript), Zod

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC2: Checkpoint Content
- **session-checkpointing.AC2.1 Success:** Checkpoint includes full conversation message history (message IDs, not content — content is in the messages table)
- **session-checkpointing.AC2.2 Success:** Checkpoint includes all working memory block labels and content
- **session-checkpointing.AC2.3 Success:** Checkpoint includes pending prediction journal entries (predictions awaiting review)
- **session-checkpointing.AC2.4 Success:** Checkpoint includes active interest state from the subconscious module (interest labels, decay values)
- **session-checkpointing.AC2.5 Success:** Checkpoint includes compaction metadata (last compacted message index, summary count)
- **session-checkpointing.AC2.6 Success:** Checkpoint includes recall cache (last decomposition result, if any)
- **session-checkpointing.AC2.7 Success:** Checkpoint includes current turn number and tool round count
- **session-checkpointing.AC2.8 Edge:** Checkpoint with empty working memory / no predictions / no interests serializes cleanly (empty arrays, not null)

### session-checkpointing.AC5: Storage and Migration (partial)
- **session-checkpointing.AC5.3 Success:** `checkpoint_data` JSONB is validated with a Zod schema on read (defensive deserialization)
- **session-checkpointing.AC5.4 Edge:** Corrupted `checkpoint_data` JSONB fails validation with a clear error rather than crashing the agent

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Checkpoint types and Zod schema

**Verifies:** None (type scaffolding)

**Files:**
- Create: `src/agent/checkpoint-types.ts`

**Implementation:**

Create the module with type definitions and Zod schema. Follow the pattern from `src/agent/cache-diagnostics.ts` where types are defined locally rather than in `types.ts`.

The file annotation is `// pattern: Functional Core`.

Define the following types:

**`CheckpointTrigger`** — String literal union: `'explicit' | 'pre_compaction' | 'shutdown' | 'interval'`

**`CheckpointWorkingMemory`** — Snapshot of a working memory block:
```typescript
type CheckpointWorkingMemory = {
  readonly label: string;
  readonly content: string;
};
```

**`CheckpointPrediction`** — Snapshot of a pending prediction. Field names match `Prediction` from `src/reflexion/types.ts:8-19`:
```typescript
type CheckpointPrediction = {
  readonly id: string;
  readonly predictionText: string;
  readonly domain: string | null;
  readonly confidence: number | null;
  readonly createdAt: string;
};
```
Note: `createdAt` is serialized as ISO string (not `Date`) since JSONB doesn't have native Date support.

**`CheckpointInterest`** — Snapshot of an active interest. Field names match `Interest` from `src/subconscious/types.ts:13-23`:
```typescript
type CheckpointInterest = {
  readonly id: string;
  readonly name: string;
  readonly engagementScore: number;
  readonly status: 'active' | 'dormant' | 'abandoned';
  readonly lastEngagedAt: string;
};
```

**`CheckpointCompactionMeta`** — Compaction position metadata:
```typescript
type CheckpointCompactionMeta = {
  readonly lastCompactedIndex: number;
  readonly summaryCount: number;
};
```

**`CheckpointRecallCache`** — Last recall decomposition. Mirrors `DecompositionResult` from `src/recall/types.ts:11-14`:
```typescript
type CheckpointRecallCache = {
  readonly decomposition: {
    readonly queries: ReadonlyArray<string>;
    readonly entities: ReadonlyArray<string>;
  } | null;
  readonly fragmentCount: number;
};
```

**`SessionCheckpoint`** — The full checkpoint:
```typescript
type SessionCheckpoint = {
  readonly version: 1;
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<CheckpointWorkingMemory>;
  readonly pendingPredictions: ReadonlyArray<CheckpointPrediction>;
  readonly activeInterests: ReadonlyArray<CheckpointInterest>;
  readonly compactionMeta: CheckpointCompactionMeta;
  readonly recallCache: CheckpointRecallCache | null;
  readonly createdAt: string;
};
```
Note: Includes `version: 1` field per the design's "Additional Considerations" section for future format migration.

**`AgentCheckpointState`** — Input to the serializer (what the agent provides):
```typescript
type AgentCheckpointState = {
  readonly turnNumber: number;
  readonly toolRound: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly workingMemory: ReadonlyArray<CheckpointWorkingMemory>;
  readonly pendingPredictions: ReadonlyArray<CheckpointPrediction>;
  readonly activeInterests: ReadonlyArray<CheckpointInterest>;
  readonly compactionMeta: CheckpointCompactionMeta;
  readonly recallCache: CheckpointRecallCache | null;
};
```

**Zod schema** — `SessionCheckpointSchema`:
Define a Zod schema that validates the `SessionCheckpoint` structure. Use `z.object()` with appropriate validators for each field. For the `version` field, use `z.literal(1)` to reject unknown versions with a clear error. For `trigger`, use `z.enum(['explicit', 'pre_compaction', 'shutdown', 'interval'])`. For `id`, use `z.string().uuid()`. For `conversationId` and `owner`, use `z.string().min(1)`. For `turnNumber` and `toolRound`, use `z.number().int().nonnegative()`. For arrays, use `z.array()`. For `decomposition`, use `z.object().nullable()`. For `recallCache`, use `z.object().nullable()`. For `domain` and `confidence` in predictions, use `.nullable()`.

Export the schema, all types, and a `CHECKPOINT_VERSION` constant (`1 as const`).

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): add checkpoint types and Zod schema`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Serialization and deserialization functions

**Verifies:** session-checkpointing.AC2.1, session-checkpointing.AC2.2, session-checkpointing.AC2.3, session-checkpointing.AC2.4, session-checkpointing.AC2.5, session-checkpointing.AC2.6, session-checkpointing.AC2.7, session-checkpointing.AC2.8, session-checkpointing.AC5.3, session-checkpointing.AC5.4

**Files:**
- Create: `src/agent/checkpoint-serializer.ts`

**Implementation:**

Create the module with two pure functions. Annotate with `// pattern: Functional Core`.

Import `SessionCheckpointSchema`, `SessionCheckpoint`, `AgentCheckpointState`, `CheckpointTrigger`, and `CHECKPOINT_VERSION` from `./checkpoint-types.ts`.

**`serializeCheckpoint`** — Accepts options object (following house style for 3+ parameters):
```typescript
type SerializeCheckpointOptions = {
  readonly id: string;
  readonly conversationId: string;
  readonly owner: string;
  readonly trigger: CheckpointTrigger;
  readonly state: AgentCheckpointState;
  readonly createdAt: string;
};
```

Returns `SessionCheckpoint`. Sets `version` to `CHECKPOINT_VERSION`. Spreads all fields from `state` into the result alongside the metadata fields. The `id` and `createdAt` are provided by the caller (the Imperative Shell generates the UUID and timestamp), keeping this function pure and deterministic for testing.

Arrays from `AgentCheckpointState` use `ReadonlyArray<T>` but Zod's output uses `Array<T>`. Use `Array.from()` to convert readonly arrays to mutable arrays for the checkpoint object.

**`deserializeCheckpoint`** — Accepts `data: unknown`. Returns `SessionCheckpoint`. Uses `SessionCheckpointSchema.safeParse(data)`. On success, returns the parsed data. On failure, throws an `Error` with a message that includes the Zod validation issues formatted as a readable string. Use `result.error.issues.map(i => \`${i.path.join('.')}: ${i.message}\`).join('; ')` for formatting. Prefix the error message with `"checkpoint validation failed: "`.

Export both functions and the `SerializeCheckpointOptions` type as named exports.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): implement checkpoint serializer and deserializer`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for serialization round-trip and validation

**Verifies:** session-checkpointing.AC2.1, session-checkpointing.AC2.2, session-checkpointing.AC2.3, session-checkpointing.AC2.4, session-checkpointing.AC2.5, session-checkpointing.AC2.6, session-checkpointing.AC2.7, session-checkpointing.AC2.8, session-checkpointing.AC5.3, session-checkpointing.AC5.4

**Files:**
- Create: `src/agent/checkpoint-serializer.test.ts`

**Testing:**

Use `bun:test` imports (`describe`, `test`, `expect`, `beforeEach`). Do NOT annotate test files with `// pattern:` — test files are exempt from FCIS classification. Follow patterns from `src/agent/cache-diagnostics.test.ts`.

Organize by AC numbers in `describe` blocks. Create a helper function `createTestState()` that returns a fully-populated `AgentCheckpointState` for test reuse.

Tests must verify each AC:

- **session-checkpointing.AC2.1:** Serialize with `messageIds: ['msg-1', 'msg-2', 'msg-3']`. Deserialize the result. Verify `messageIds` matches exactly.
- **session-checkpointing.AC2.2:** Serialize with working memory blocks `[{label: 'goals', content: 'Be helpful'}]`. Deserialize. Verify `workingMemory` matches.
- **session-checkpointing.AC2.3:** Serialize with pending predictions including `predictionText`, `domain`, `confidence`, `createdAt`. Deserialize. Verify `pendingPredictions` matches.
- **session-checkpointing.AC2.4:** Serialize with active interests including `name`, `engagementScore`, `status`, `lastEngagedAt`. Deserialize. Verify `activeInterests` matches.
- **session-checkpointing.AC2.5:** Serialize with `compactionMeta: { lastCompactedIndex: 42, summaryCount: 3 }`. Deserialize. Verify `compactionMeta` matches.
- **session-checkpointing.AC2.6:** Serialize with `recallCache: { decomposition: { queries: ['q1'], entities: ['e1'] }, fragmentCount: 5 }`. Deserialize. Verify `recallCache` matches. Also test with `recallCache: null`.
- **session-checkpointing.AC2.7:** Serialize with `turnNumber: 15`, `toolRound: 3`. Deserialize. Verify both match.
- **session-checkpointing.AC2.8:** Serialize with `workingMemory: []`, `pendingPredictions: []`, `activeInterests: []`, `messageIds: []`, `recallCache: null`. Deserialize. Verify all are empty arrays (not null or undefined). Verify `recallCache` is `null`.
- **session-checkpointing.AC5.3:** Deserialize valid JSONB data (the output of `serializeCheckpoint` passed through `JSON.parse(JSON.stringify(...))`). Verify it passes Zod validation and returns typed `SessionCheckpoint`. This simulates the PostgreSQL JSONB write/read cycle.
- **session-checkpointing.AC5.4:** Attempt to deserialize various corrupted inputs:
  - Missing required field (`conversationId` omitted) — expect thrown error with path info
  - Wrong type for field (`turnNumber: "not a number"`) — expect thrown error
  - Unknown version (`version: 99`) — expect thrown error mentioning version
  - Completely invalid input (`null`, `"string"`, `42`) — expect thrown error
  - Partial object (some fields present, others missing) — expect thrown error listing missing fields
  - `workingMemory: null` instead of array — expect thrown error

Additional tests:
- **Round-trip fidelity:** `deserializeCheckpoint(JSON.parse(JSON.stringify(serializeCheckpoint(...))))` produces identical output to the original serialization for all data fields. This simulates the full JSONB write/read cycle.
- **`serializeCheckpoint` sets metadata:** Verify `id` matches the provided UUID, `createdAt` matches the provided ISO timestamp, `version` is `1`, `trigger` and `owner` and `conversationId` match inputs.
- **Version field rejection:** Data with `version: 2` fails deserialization with an error mentioning the version literal constraint.

**Verification:**
Run: `bun test src/agent/checkpoint-serializer.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add unit tests for checkpoint serialization and validation`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Add exports to agent module barrel

**Verifies:** None (module wiring)

**Files:**
- Modify: `src/agent/index.ts` (currently 38 lines, add at end)

**Implementation:**

Add exports for the checkpoint types and serializer to `src/agent/index.ts`, following the existing pattern which separates type exports from implementation exports (see existing lines like `export type { SnapshotMode, ... } from './snapshot.ts'` and `export { createSnapshotState } from './snapshot.ts'`):

```typescript
export type {
  SessionCheckpoint,
  CheckpointTrigger,
  AgentCheckpointState,
  CheckpointWorkingMemory,
  CheckpointPrediction,
  CheckpointInterest,
  CheckpointCompactionMeta,
  CheckpointRecallCache,
} from './checkpoint-types.ts';
export { SessionCheckpointSchema, CHECKPOINT_VERSION } from './checkpoint-types.ts';
export type { SerializeCheckpointOptions } from './checkpoint-serializer.ts';
export { serializeCheckpoint, deserializeCheckpoint } from './checkpoint-serializer.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): export checkpoint types and serializer from agent module barrel`

<!-- END_TASK_4 -->
