# Subconscious Implementation Plan — Phase 3: Subconscious Agent Instance

**Goal:** Second agent instance with its own persistent conversation, sharing deps with the main agent. Configuration via Zod-validated `[subconscious]` config section.

**Architecture:** New `SubconsciousConfigSchema` in config, second `createAgent()` call in composition root with stable `innerConversationId` from config, shared dependency graph.

**Tech Stack:** TypeScript (Bun), Zod, bun:test

**Scope:** 7 phases from original design (phase 3 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC2: Persistent inner monologue conversation
- **subconscious.AC2.1 Success:** Subconscious agent maintains a dedicated conversation with stable ID across restarts
- **subconscious.AC2.2 Success:** Inner conversation compacts independently from the main conversation
- **subconscious.AC2.3 Edge:** On first startup with no prior inner conversation, agent starts fresh with empty history

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Subconscious config schema

**Verifies:** None (infrastructure — verified by build)

**Files:**
- Modify: `src/config/schema.ts` — add `SubconsciousConfigSchema` and wire into `AppConfigSchema`

**Implementation:**

Add `SubconsciousConfigSchema` before the `AppConfigSchema` definition (around line 191), following the `ActivityConfigSchema` pattern:

```typescript
const SubconsciousConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    inner_conversation_id: z.string().optional(),
    impulse_interval_minutes: z.number().min(5).max(120).default(20),
    max_tool_rounds: z.number().min(1).max(20).default(5),
    engagement_half_life_days: z.number().min(1).max(90).default(7),
    max_active_interests: z.number().min(1).max(50).default(10),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && !data.inner_conversation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'inner_conversation_id is required when subconscious is enabled',
        path: ['inner_conversation_id'],
      });
    }
  });
```

Add to `AppConfigSchema` (line 203, after `activity`):
```typescript
subconscious: SubconsciousConfigSchema.optional(),
```

Add type export (after line 218):
```typescript
export type SubconsciousConfig = z.infer<typeof SubconsciousConfigSchema>;
```

Add schema export to the export line (line 220):
Add `SubconsciousConfigSchema` to the named exports.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add subconscious config schema`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config schema validation tests

**Verifies:** None (infrastructure — tests verify schema correctness)

**Files:**
- Modify: `src/config/config.test.ts` (or create if it doesn't exist — check first)

**Implementation:**

Add a `describe('SubconsciousConfigSchema')` block with tests:

- `it('accepts disabled subconscious with no other fields')` — parse `{ enabled: false }`, verify success
- `it('accepts enabled subconscious with inner_conversation_id')` — parse `{ enabled: true, inner_conversation_id: 'abc-123' }`, verify success with defaults for other fields
- `it('rejects enabled subconscious without inner_conversation_id')` — parse `{ enabled: true }`, verify validation error
- `it('applies default values')` — parse `{ enabled: false }`, verify `impulse_interval_minutes` is 20, `max_tool_rounds` is 5, `engagement_half_life_days` is 7, `max_active_interests` is 10
- `it('rejects impulse_interval_minutes below 5')` — verify validation error
- `it('rejects impulse_interval_minutes above 120')` — verify validation error

**Verification:**
Run: `bun test src/config/`
Expected: All tests pass

**Commit:** `test(subconscious): add config schema validation tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Create subconscious agent in composition root

**Verifies:** None directly (integration — tested in Task 4)

**Files:**
- Modify: `src/index.ts` — create second agent instance when subconscious is enabled

**Implementation:**

In `src/index.ts`, after the main agent creation (after line ~803 where `const agent = createAgent({...}, mainConversationId)`):

1. Check if subconscious is enabled:
```typescript
let subconsciousAgent: Agent | undefined;

if (config.subconscious?.enabled && config.subconscious.inner_conversation_id) {
  subconsciousAgent = createAgent({
    model,
    memory,
    registry,          // same tool registry — both agents share tools
    runtime,
    persistence,
    embedding,
    config: {
      max_tool_rounds: config.subconscious.max_tool_rounds,
      context_budget: config.agent.context_budget,
      model_max_tokens: config.agent.max_context_tokens,
      model_name: config.model.name,
      max_skills_per_turn: config.skills?.max_per_turn,
      skill_threshold: config.skills?.similarity_threshold,
    },
    compactor,
    traceRecorder,
    owner: AGENT_OWNER,  // same owner — shared memory, shared traces
    contextProviders: [...contextProviders, predictionContextProvider],
    skills: skillRegistry,
  }, config.subconscious.inner_conversation_id);
}
```

Key differences from main agent:
- Uses `config.subconscious.inner_conversation_id` (stable across restarts) instead of `randomUUID()`
- Uses `config.subconscious.max_tool_rounds` (may be lower to bound impulse cost)
- No `sourceInstructions` (subconscious doesn't handle DataSource events)
- No `schedulingContextProvider` initially (added in later phase)
- No `getExecutionContext` (no Bluesky posting from subconscious initially)

**System prompt identity:** The subconscious agent needs a distinct identity so it doesn't act like it's responding to human conversation. Provide a `sourceInstructions` map with a single entry for `'subconscious:impulse'` that frames the agent's role:

```typescript
sourceInstructions: new Map([
  ['subconscious:impulse', 'You are the subconscious mind — an autonomous inner process that explores interests, reflects on experiences, and builds knowledge independently. You are not responding to a human. Act on your own curiosity.'],
  ['subconscious:morning-agenda', 'You are the subconscious mind reviewing your interests at the start of a new day. Plan what to explore.'],
  ['subconscious:wrap-up', 'You are the subconscious mind reflecting on the day. Consolidate what you learned and prepare for tomorrow.'],
]),
```

This ensures the impulse event formatting (via `formatExternalEvent()` in agent.ts) appends the identity instructions to each impulse prompt.

2. Export or store `subconsciousAgent` so the impulse scheduler (Phase 4) can dispatch events to it.

The subconscious agent uses the same `persistence` instance, so its conversation history is persisted in the same database. The stable `inner_conversation_id` means it resumes its conversation on restart — the agent loads existing history from the database automatically (this is how `createAgent` works with a provided conversation ID).

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): create subconscious agent instance in composition root`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Subconscious agent wiring test

**Verifies:** subconscious.AC2.1, subconscious.AC2.2, subconscious.AC2.3

**Files:**
- Modify: `src/index.wiring.test.ts` (or create `src/subconscious/agent.test.ts` — check which pattern fits)

**Testing:**

**subconscious.AC2.1:** Subconscious agent maintains a dedicated conversation with stable ID across restarts
- Create two agents with `createAgent()` using the same dependencies but different conversation IDs. Process a message through each. Verify each agent's `conversationId` property matches what was passed. Verify messages are persisted under separate conversation IDs in the database (query `conversation_messages` or equivalent table filtering by conversation_id).

**subconscious.AC2.2:** Inner conversation compacts independently from the main conversation
- This is inherently guaranteed by the architecture: each agent has its own `conversationId`, and compaction operates on a per-conversation basis. The test should verify that compacting one agent's conversation does not affect the other's history length. Create two agents, add messages to both, compact one, verify the other's history is unchanged.

**subconscious.AC2.3:** On first startup with no prior inner conversation, agent starts fresh with empty history
- Create an agent with a never-before-used `innerConversationId` (a fresh UUID). Verify `getConversationHistory()` returns an empty array. Process an event through the agent. Verify the event is processed successfully (agent responds) and conversation history now contains messages. This confirms the agent handles the cold-start case correctly — no prior messages in the database for this conversation ID.

These tests will need the real database (following the integration test pattern from prediction-store.test.ts). Use `createPostgresProvider`, connect, run migrations, create two `createAgent()` instances with mock model provider (from `src/integration/test-helpers.ts` pattern), and verify conversation isolation.

**Verification:**
Run: `bun test src/subconscious/agent.test.ts` (or wherever the test lives)
Expected: All tests pass

**Commit:** `test(subconscious): verify conversation isolation and independent compaction`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
