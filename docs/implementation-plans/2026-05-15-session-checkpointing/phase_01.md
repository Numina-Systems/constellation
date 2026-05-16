# Session Checkpointing Implementation Plan

**Goal:** Define the `SessionCheckpoint` type and pure serialization/deserialization functions with Zod validation.

**Architecture:** Functional Core module with Zod-validated types and pure transformation functions. No I/O — just data serialization and schema enforcement. Follows the same pattern as `src/recall/types.ts` and `src/compaction/types.ts`.

**Tech Stack:** Bun, TypeScript 5.7+, PostgreSQL, Zod

**Scope:** Phase 1 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### session-checkpointing.AC2: Checkpoint Content
- **session-checkpointing.AC2.1 Success:** Checkpoint includes full conversation message history (message IDs, not content — content is in the messages table)
- **session-checkpointing.AC2.2 Success:** Checkpoint includes all working memory block labels and content
- **session-checkpointing.AC2.3 Success:** Checkpoint includes pending prediction journal entries (predictions awaiting review)
- **session-checkpointing.AC2.4 Success:** Checkpoint includes active interest state from the subconscious module (interest labels, engagement scores)
- **session-checkpointing.AC2.5 Success:** Checkpoint includes compaction metadata (last compacted message index, summary count)
- **session-checkpointing.AC2.6 Success:** Checkpoint includes recall cache (last decomposition result, if any)
- **session-checkpointing.AC2.7 Success:** Checkpoint includes current turn number and tool round count
- **session-checkpointing.AC2.8 Edge:** Checkpoint with empty working memory / no predictions / no interests serializes cleanly (empty arrays, not null)

### session-checkpointing.AC5: Storage and Migration (partial — Zod validation only)
- **session-checkpointing.AC5.3 Success:** `checkpoint_data` JSONB is validated with a Zod schema on read (defensive deserialization)
- **session-checkpointing.AC5.4 Edge:** Corrupted `checkpoint_data` JSONB fails validation with a clear error rather than crashing the agent

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Checkpoint types and Zod schema

**Verifies:** session-checkpointing.AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7

**Files:**
- Create: `src/agent/checkpoint-types.ts`

**Implementation:**

Create `src/agent/checkpoint-types.ts` with pattern annotation `// pattern: Functional Core`.

Define the following types and Zod schemas:

1. `CheckpointTrigger` — union type: `'explicit' | 'pre_compaction' | 'shutdown' | 'interval'`

2. `CheckpointVersion` — literal `1` (starting version for future format migration)

3. `SessionCheckpointSchema` — Zod schema for the full checkpoint object:
   ```typescript
   const SessionCheckpointSchema = z.object({
     version: z.literal(1),
     id: z.string().uuid(),
     conversationId: z.string().min(1),
     owner: z.string().min(1),
     trigger: z.enum(['explicit', 'pre_compaction', 'shutdown', 'interval']),
     turnNumber: z.number().int().nonnegative(),
     toolRound: z.number().int().nonnegative(),
     messageIds: z.array(z.string()),
     workingMemory: z.array(z.object({
       label: z.string(),
       content: z.string(),
     })),
     pendingPredictions: z.array(z.object({
       id: z.string(),
       prediction: z.string(),
       createdAt: z.string(),
     })),
     activeInterests: z.array(z.object({
       label: z.string(),
       engagementScore: z.number(),
     })),
     compactionMetadata: z.object({
       lastCompactedIndex: z.number().int(),
       summaryCount: z.number().int().nonnegative(),
     }),
     recallCache: z.object({
       decomposition: z.object({
         queries: z.array(z.string()),
         entities: z.array(z.string()),
       }).nullable(),
       fragmentCount: z.number().int().nonnegative(),
     }).nullable(),
     createdAt: z.string(),
   });
   ```

4. `SessionCheckpoint` — inferred type from the Zod schema: `type SessionCheckpoint = z.infer<typeof SessionCheckpointSchema>`

5. `AgentCheckpointState` — the input type for collecting state before serialization. This is what the agent provides, before IDs and timestamps are assigned:
   ```typescript
   type AgentCheckpointState = {
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
       readonly engagementScore: number;
     }>;
     readonly compactionMetadata: {
       readonly lastCompactedIndex: number;
       readonly summaryCount: number;
     };
     readonly recallCache: {
       readonly decomposition: { queries: ReadonlyArray<string>; entities: ReadonlyArray<string> } | null;
       readonly fragmentCount: number;
     } | null;
   };
   ```

Export `SessionCheckpointSchema`, `SessionCheckpoint`, `CheckpointTrigger`, `AgentCheckpointState`, and `CHECKPOINT_VERSION` (constant `1 as const`).

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(checkpoint): add session checkpoint types and Zod schema`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Serialization and deserialization functions

**Verifies:** session-checkpointing.AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7, AC2.8, AC5.3, AC5.4

**Files:**
- Create: `src/agent/checkpoint-serializer.ts`
- Test: `src/agent/checkpoint-serializer.test.ts` (unit)

**Implementation:**

Create `src/agent/checkpoint-serializer.ts` with pattern annotation `// pattern: Functional Core`.

Export two pure functions:

1. `serializeCheckpoint(id: string, createdAt: string, conversationId: string, owner: string, trigger: CheckpointTrigger, state: AgentCheckpointState): SessionCheckpoint`
   - Accepts `id` (UUID) and `createdAt` (ISO string) as parameters — the caller generates these, keeping the function truly pure and deterministic for testing
   - Sets `version` to `CHECKPOINT_VERSION`
   - Copies all fields from `state` into the checkpoint object
   - Ensures all array fields are plain arrays (not readonly — Zod expects mutable arrays). Use `Array.from()` or spread to convert `ReadonlyArray` to `Array`.
   - Returns the fully-formed `SessionCheckpoint`

2. `deserializeCheckpoint(data: unknown): SessionCheckpoint`
   - Passes `data` through `SessionCheckpointSchema.parse()`
   - On success, returns the validated `SessionCheckpoint`
   - On failure, Zod throws `ZodError` — let it propagate. The caller (store layer) catches and handles.
   - This is the defensive deserialization boundary: any JSONB from PostgreSQL goes through this function before being used.

**Testing:**

Create `src/agent/checkpoint-serializer.test.ts` with the following test cases:

1. **Round-trip test (AC2.1-AC2.7):** Create an `AgentCheckpointState` with all fields populated (messageIds, workingMemory, pendingPredictions, activeInterests, compactionMetadata, recallCache). Call `serializeCheckpoint()`. Call `deserializeCheckpoint()` on the result. Assert all fields match (ignoring `id` and `createdAt` which are generated).

2. **Empty collections test (AC2.8):** Create an `AgentCheckpointState` with empty arrays for messageIds, workingMemory, pendingPredictions, activeInterests, null recallCache, and zero-value compactionMetadata. Serialize and deserialize. Assert all arrays are `[]` (not null/undefined). Assert `recallCache` is `null`.

3. **Corrupted data test (AC5.4):** Call `deserializeCheckpoint()` with `{ version: 1, garbage: true }`. Assert it throws a `ZodError`.

4. **Missing version test (AC5.4):** Call `deserializeCheckpoint()` with a complete-looking object but `version: 2`. Assert it throws (unknown version).

5. **Wrong type test (AC5.4):** Call `deserializeCheckpoint()` with `"not an object"`. Assert it throws.

6. **Null fields test (AC5.4):** Call `deserializeCheckpoint()` with an otherwise valid object but `workingMemory: null`. Assert it throws (expects array, not null).

7. **serializeCheckpoint uses provided id and createdAt:** Call `serializeCheckpoint()` with a known UUID and ISO string. Assert `id` and `createdAt` on the returned checkpoint match the provided values exactly (pure function — no internal generation).

Mock approach: No mocks needed — these are pure function tests. Build test state objects inline.

**Verification:**
Run: `bun test src/agent/checkpoint-serializer.test.ts`
Expected: All tests pass

**Commit:** `feat(checkpoint): implement checkpoint serialization with Zod validation`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts` (add checkpoint exports to existing barrel)

**Implementation:**

Add the following exports to the existing `src/agent/index.ts` barrel file:

```typescript
export type { SessionCheckpoint, CheckpointTrigger, AgentCheckpointState } from './checkpoint-types.js';
export { SessionCheckpointSchema, CHECKPOINT_VERSION } from './checkpoint-types.js';
export { serializeCheckpoint, deserializeCheckpoint } from './checkpoint-serializer.js';
```

If `src/agent/index.ts` does not exist, create it with the above exports plus re-exports of existing agent public API (`createAgent`, `Agent`, `AgentConfig`, `AgentDependencies`, `ConversationMessage`, `ExternalEvent`, `ContextProvider`).

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(checkpoint): export checkpoint types and serializer from agent barrel`
<!-- END_TASK_3 -->
