# Agent Reflexion Implementation Plan

**Goal:** Instrument the agent loop to write operation traces on every tool dispatch.

**Architecture:** Add optional `traceRecorder` to `AgentDependencies`, wrap existing three-branch tool dispatch with timing and fire-and-forget trace recording.

**Tech Stack:** Bun, TypeScript 5.7+ (strict), bun:test

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-reflexion.AC2: Self-Introspection & Trace Capture
- **agent-reflexion.AC2.1 Success:** Every tool dispatch (regular, execute_code, compact_context) writes a trace with tool name, input, output summary, duration, and success status
- **agent-reflexion.AC2.2 Success:** Failed tool calls record the error message in the trace
- **agent-reflexion.AC2.3 Success:** Output summary is truncated to 500 characters
- **agent-reflexion.AC2.4 Failure:** A trace recorder INSERT failure logs a warning but does not block or fail the agent loop

---

## Phase 4: Trace Capture in Agent Loop

**Goal:** Instrument the three tool dispatch paths in `src/agent/agent.ts` to record operation traces via the `TraceRecorder` interface.

**Key investigation findings:**
- Tool dispatch lives in `src/agent/agent.ts` with three branches in a single try-catch: `execute_code` (runtime), `compact_context` (compactor), and regular tools (registry.dispatch)
- `AgentDependencies` is defined in `src/agent/types.ts` with 8 current fields (2 optional)
- Agent tests use factory mocks with configurable responses

**CLAUDE.md files to read before implementation:**
- `src/agent/CLAUDE.md` — Agent loop contracts and tool dispatch guarantees

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add traceRecorder and owner to AgentDependencies

**Files:**
- Modify: `src/agent/types.ts` (add two fields to AgentDependencies)
- Modify: `src/agent/index.ts` (export TraceRecorder re-export if not already)

**Implementation:**

Add `traceRecorder?: TraceRecorder` and `owner?: string` to the `AgentDependencies` type. Both are optional so existing callers don't need to change.

The `owner` field is needed so the trace recording helper (Task 2) can populate `OperationTrace.owner`. When not provided, the agent defaults to `'unknown'`.

In `src/agent/types.ts`, add the import and fields:

```typescript
import type { TraceRecorder } from '../reflexion/types.ts';
```

Add to the `AgentDependencies` type:

```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  getExecutionContext?: () => ExecutionContext;
  compactor?: Compactor;
  traceRecorder?: TraceRecorder;
  owner?: string;
};
```

**Verification:**

Run: `bun run build`
Expected: No type errors (fields are optional, no callers break)

Run: `bun test`
Expected: All existing tests still pass

**Commit:** `feat(agent): add optional traceRecorder and owner to AgentDependencies`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Instrument tool dispatch with trace recording

**Verifies:** agent-reflexion.AC2.1, agent-reflexion.AC2.2, agent-reflexion.AC2.3, agent-reflexion.AC2.4

**Files:**
- Modify: `src/agent/agent.ts` (wrap tool dispatch with timing and trace recording)

**Implementation:**

The existing tool dispatch loop has three branches (execute_code, compact_context, regular). Instrument all three to record traces.

The instrumentation wraps each dispatch with:
1. `const startTime = Date.now()` before the dispatch
2. After dispatch (whether success or failure), compute `durationMs = Date.now() - startTime`
3. Fire-and-forget call to `deps.traceRecorder?.record(...)` — no `await`, no error handling at this level (the TraceRecorder itself handles errors internally per AC2.4)

The output summary truncation to 500 chars is handled by the TraceRecorder implementation (Phase 2), but the trace capture should pass the full `toolResult` string as-is.

Add a helper function inside `createAgent` to avoid code duplication:

```typescript
const traceOwner = deps.owner ?? 'unknown';

function recordTrace(
  toolName: string,
  input: Record<string, unknown>,
  output: string,
  durationMs: number,
  success: boolean,
  error: string | null,
): void {
  if (!deps.traceRecorder) return;
  deps.traceRecorder.record({
    owner: traceOwner,
    conversationId: id,
    toolName,
    input,
    outputSummary: output,
    durationMs,
    success,
    error,
  });
}
```

Note: `recordTrace` does NOT await the promise. The `.record()` call returns a Promise but we intentionally don't await it — this is the fire-and-forget pattern. The TraceRecorder's internal try-catch (Phase 2) ensures failures don't propagate.

Then wrap each dispatch branch:

```typescript
const startTime = Date.now();
try {
  if (toolUse.name === 'execute_code') {
    // ... existing code ...
    recordTrace('execute_code', toolUse.input, toolResult, Date.now() - startTime, true, null);
  } else if (toolUse.name === 'compact_context') {
    // ... existing code ...
    recordTrace('compact_context', toolUse.input, toolResult, Date.now() - startTime, true, null);
  } else {
    const result = await deps.registry.dispatch(toolUse.name, toolUse.input);
    toolResult = result.output;
    recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, result.success, result.error ?? null);
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  toolResult = `Error: ${errorMessage}`;
  recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, false, errorMessage);
}
```

**Note:** The `owner` value comes from `deps.owner` (added in Task 1). Phase 7 passes `owner: AGENT_OWNER` (`'spirit'`) when creating the agent.

**Verification:**

Run: `bun run build`
Expected: No type errors

Run: `bun test`
Expected: All existing tests still pass (traceRecorder is optional, existing tests don't provide it)

**Commit:** `feat(agent): instrument tool dispatch with operation trace recording`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for trace capture

**Verifies:** agent-reflexion.AC2.1, agent-reflexion.AC2.2, agent-reflexion.AC2.3, agent-reflexion.AC2.4

**Files:**
- Create: `src/agent/trace-capture.test.ts`

**Testing:**

Test the trace recording instrumentation using mock dependencies, following the existing agent test patterns.

Create a mock `TraceRecorder` that captures recorded traces:

```typescript
function createMockTraceRecorder() {
  const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
  return {
    recorder: {
      record: async (trace: Omit<OperationTrace, 'id' | 'createdAt'>) => {
        traces.push(trace);
      },
    } satisfies TraceRecorder,
    traces,
  };
}
```

Tests must verify:
- **agent-reflexion.AC2.1:** Process a message that triggers a tool call. Verify a trace is recorded with correct tool name, input, output summary, duration > 0, and success = true.
- **agent-reflexion.AC2.1 (execute_code):** Process a message that triggers an `execute_code` call. Verify trace is recorded with tool name `execute_code`.
- **agent-reflexion.AC2.2:** Process a message where tool dispatch throws/fails. Verify trace is recorded with `success: false` and error message populated.
- **agent-reflexion.AC2.4:** Create a trace recorder whose `record` throws. Process a message that triggers a tool call. Verify the agent loop completes normally (error is swallowed).
- **No trace recorder:** Process a message with `traceRecorder: undefined` in deps. Verify agent works normally (no errors from missing recorder).

**Verification:**

Run: `bun test src/agent/trace-capture.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: No type errors

**Commit:** `test(agent): add trace capture tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
