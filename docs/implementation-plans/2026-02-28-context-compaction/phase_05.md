# Context Compaction Implementation Plan — Phase 5

**Goal:** Register the `compact_context` built-in tool and add special-case handling in the agent loop for mid-turn compaction with history rebuild.

**Architecture:** New tool definition file `src/tool/builtin/compaction.ts` following the `createMemoryTools` pattern. The agent loop gets a special-case branch (like `execute_code`) that calls `compactor.compress()`, replaces the in-memory history, and reports stats back as the tool result.

**Tech Stack:** TypeScript, Tool registry pattern, Agent loop special-case dispatch

**Scope:** 7 phases from original design (phase 5 of 7)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### context-compaction.AC5: `compact_context` tool enables agent-initiated compaction
- **context-compaction.AC5.1 Success:** Agent can call `compact_context` with no parameters
- **context-compaction.AC5.2 Success:** Tool returns compression stats (messages compressed, batches created, token reduction)
- **context-compaction.AC5.3 Success:** After `compact_context` executes, subsequent tool calls in the same round see compressed context
- **context-compaction.AC5.4 Edge:** Calling `compact_context` when history is already below budget is a no-op (returns stats showing 0 compression)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create compact_context tool definition

**Files:**
- Create: `src/tool/builtin/compaction.ts`

**Implementation:**

Create `src/tool/builtin/compaction.ts` with `// pattern: Imperative Shell` annotation.

Define a factory function:
```typescript
function createCompactContextTool(): Tool
```

The tool definition:
- `name`: `'compact_context'`
- `description`: `'Compress conversation history to free up context space.'`
- `parameters`: empty array (no parameters needed)

The handler is a placeholder that returns a message indicating the tool should be handled as a special case by the agent loop (same pattern concept as `execute_code`, whose actual execution is done in the agent loop, not by the registry).

The handler should return:
```typescript
{ success: true, output: 'compact_context is handled as a special case by the agent loop.' }
```

This handler will never actually be called via `registry.dispatch()` because the agent loop intercepts `compact_context` before dispatch (Task 2). It exists so the tool can be registered and its definition included in model requests.

Export `createCompactContextTool`.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(tool): add compact_context tool definition`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register compact_context tool in composition root

**Files:**
- Modify: `src/index.ts:258-263`

**Implementation:**

After the existing tool registrations (line 263, `registry.register(createExecuteCodeTool())`), add:

```typescript
registry.register(createCompactContextTool());
```

Import `createCompactContextTool` from `@/tool/builtin/compaction`.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat: register compact_context tool in composition root`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Add special-case compact_context handling in agent loop

**Files:**
- Modify: `src/agent/agent.ts` (tool dispatch section, starting around line 105)

**Implementation:**

In the tool dispatch loop (starting around line 105 of agent.ts), add a special-case branch for `compact_context` alongside the existing `execute_code` special case.

The existing pattern (simplified):
```typescript
for (const toolUse of toolUseBlocks) {
  let toolResult: string;
  if (toolUse.name === 'execute_code') {
    // special case: code execution
  } else {
    // regular tool dispatch
  }
  // persist tool result, add to history
}
```

Add a new branch:
```typescript
if (toolUse.name === 'compact_context') {
  // Special case: context compaction
  const compactionResult = await deps.compactor.compress(history, id);
  history = Array.from(compactionResult.history);

  toolResult = JSON.stringify({
    messagesCompressed: compactionResult.messagesCompressed,
    batchesCreated: compactionResult.batchesCreated,
    tokensEstimateBefore: compactionResult.tokensEstimateBefore,
    tokensEstimateAfter: compactionResult.tokensEstimateAfter,
  });
}
```

**Key detail:** After `compact_context` runs, the local `history` array is replaced with the compacted result. This means subsequent tool calls in the same round will see the compressed context. The next iteration of the tool loop will use the updated `history` to build the model request.

**Note:** This task depends on the `Compactor` being available in agent dependencies. This is wired in Phase 6. For now, add the `compact_context` handling code but expect a type error on `deps.compactor` — it will be resolved in Phase 6 when `AgentDependencies` is updated. To keep Phase 5 compilable, check `if ('compactor' in deps && deps.compactor)` as a guard. When the guard fails (compactor not available), return a tool error result: `toolResult = JSON.stringify({ success: false, output: 'Compaction not yet configured' })` — this ensures the agent gets a meaningful response rather than a silent no-op.

**Verification:**

```bash
bun run build
```

Expected: Type-checks pass.

**Commit:** `feat(agent): add compact_context special-case dispatch`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for compact_context tool definition

**Verifies:** context-compaction.AC5.1

**Files:**
- Create: `src/tool/builtin/compaction.test.ts`

**Testing:**

Tests must verify:
- context-compaction.AC5.1: Tool definition has name `compact_context`, empty parameters array, and a non-empty description.
- The factory function returns a valid `Tool` object with both `definition` and `handler` properties.

Follow project testing patterns (colocated test file, `bun:test`).

**Verification:**

```bash
bun test src/tool/builtin/compaction.test.ts
```

Expected: All tests pass.

**Commit:** `test(tool): add compact_context tool definition tests`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for compact_context agent loop dispatch

**Verifies:** context-compaction.AC5.2, context-compaction.AC5.3, context-compaction.AC5.4

**Files:**
- Modify: `src/agent/agent.test.ts` (add test suite)

**Testing:**

Add a new `describe` block in `src/agent/agent.test.ts` for compact_context dispatch.

Create a mock `Compactor` following the project's hand-written mock factory pattern:
```typescript
function createMockCompactor(result: CompactionResult): Compactor {
  return {
    async compress() { return result; },
  };
}
```

Tests must verify:

- **context-compaction.AC5.2:** When agent calls `compact_context`, tool result contains JSON with `messagesCompressed`, `batchesCreated`, `tokensEstimateBefore`, `tokensEstimateAfter`.

- **context-compaction.AC5.3:** After compact_context executes, the agent loop uses the compressed history for subsequent model calls. Verify by checking that the model receives shorter history on the next tool round call.

- **context-compaction.AC5.4:** When compactor returns a result with 0 stats (no compression needed), the tool result shows zeros and history is unchanged.

These tests use the existing mock setup from agent.test.ts (mock model provider that returns tool_use blocks, mock persistence, etc.). Configure the mock model to first return a `compact_context` tool call, then return an end_turn response.

**Verification:**

```bash
bun test src/agent/agent.test.ts
```

Expected: All existing + new tests pass.

**Commit:** `test(agent): add compact_context dispatch tests`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
