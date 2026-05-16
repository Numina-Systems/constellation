# Structured Error Types Implementation Plan

**Goal:** Integrate error tracing into the agent loop so caught `ConstellationError` instances are automatically recorded via `TraceRecorder`.

**Architecture:** Imperative Shell module providing a `traceError` function that bridges `ConstellationError` to `TraceRecorder`. The agent loop's existing catch blocks are updated to detect `ConstellationError` and record traces, with unknown errors wrapped via `wrapError` before tracing.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 4 of 4

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### structured-error-types.AC5: Trace Integration
- **structured-error-types.AC5.1 Success:** When a `ConstellationError` is caught in the agent loop, it is recorded via `TraceRecorder` with the subsystem as the tool name and the code as the operation
- **structured-error-types.AC5.2 Success:** Trace output includes the display string and context
- **structured-error-types.AC5.3 Success:** Errors that are caught and handled (not propagated) are still traced
- **structured-error-types.AC5.4 Edge:** Errors thrown outside the agent loop (e.g., during startup) are not traced (no TraceRecorder available yet)

---

<!-- START_TASK_1 -->
### Task 1: traceError function

**Verifies:** structured-error-types.AC5.1, AC5.2

**Files:**
- Create: `src/errors/trace.ts`
- Test: `src/errors/trace.test.ts`

**Implementation:**

Create `src/errors/trace.ts`:

```typescript
// pattern: Imperative Shell

import type { TraceRecorder } from '@/reflexion/types.js';
import type { ConstellationError } from './base.js';

/**
 * Record a ConstellationError as an operation trace.
 * Fire-and-forget — errors from the recorder itself are caught and logged.
 */
export function traceError(
  error: ConstellationError,
  recorder: TraceRecorder,
  owner: string,
  conversationId: string,
): void {
  const displayString = error.toDisplayString();
  const truncatedOutput = displayString.length > 500
    ? displayString.slice(0, 497) + '...'
    : displayString;

  recorder.record({
    owner,
    conversationId,
    toolName: error.subsystem,
    input: { errorCode: error.code, subsystem: error.subsystem, context: error.context },
    outputSummary: truncatedOutput,
    durationMs: 0,
    success: false,
    error: displayString,
  }).catch((recordError) => {
    console.warn('traceError: failed to record error trace', recordError);
  });
}
```

Key design decisions:

- **`toolName` = `error.subsystem`**: The trace groups errors by the subsystem that produced them (e.g., `memory`, `model`, `agent`). This aligns with how `TraceRecorder` is used for tool dispatch — each trace identifies the source.

- **`input` = `{ errorCode, subsystem, context }`**: The error code, subsystem, and context are namespaced into separate keys to prevent key collisions (e.g., if `error.context` contained a `code` key, spreading would silently overwrite it). The `OperationTrace.input` field is `Record<string, unknown>`, so this is type-compatible.

- **`outputSummary` truncated to 500 chars**: Matches the existing convention in `src/reflexion/trace-recorder.ts` where output summaries are truncated to 500 characters before storage.

- **`durationMs: 0`**: Error traces don't have meaningful duration — the error was caught, not timed. Zero is the sentinel.

- **Fire-and-forget**: The `.catch()` swallows recorder failures, matching the existing `TraceRecorder` contract (fire-and-forget, never propagate to the agent loop).

- **`owner` and `conversationId` as parameters**: These are required by `OperationTrace` but aren't available on the error itself. The agent loop passes them from its own context.

**Testing:**

Create `src/errors/trace.test.ts`:

Mock `TraceRecorder` as a plain object with a `record` method that captures its argument:

```typescript
function createMockRecorder() {
  const traces: Array<Record<string, unknown>> = [];
  const recorder: TraceRecorder = {
    record: async (trace) => { traces.push(trace as Record<string, unknown>); },
  };
  return { recorder, traces };
}
```

Test cases:

1. **AC5.1:** `traceError` calls `recorder.record` with `toolName` equal to the error's `subsystem` — e.g., a `MemoryError` produces `toolName: 'memory'`
2. **AC5.1:** `input.errorCode` equals the error's `code` field and `input.subsystem` equals the error's `subsystem`
3. **AC5.2:** `outputSummary` contains the error's `.toDisplayString()` output
4. **AC5.2:** `input.context` contains the error's `context` object (nested, not spread)
5. `success` is `false` on all error traces
6. `error` field contains the full display string
7. Output longer than 500 characters is truncated with `...` suffix
8. Recorder failure (rejecting promise) does not throw — `traceError` swallows it (verify by passing a recorder whose `record` rejects, and asserting no exception is thrown)

**Verification:**
Run: `bun test src/errors/trace.test.ts`
Expected: All tests pass

**Commit:** `feat(errors): add traceError for recording errors via TraceRecorder`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire traceError into agent loop catch blocks

**Verifies:** structured-error-types.AC5.1, AC5.3, AC5.4

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

The agent loop in `src/agent/agent.ts` has four catch blocks that handle errors (identified during codebase investigation):

1. **Tool dispatch catch** (line ~295): Catches errors from `deps.registry.dispatch()` and code execution
2. **Recall pipeline catch** (line ~160): Catches errors from the recall pipeline
3. **Skill retrieval catch** (line ~182): Catches errors from `deps.skills.getRelevant()`
4. **Embedding catch** (line ~380): Catches embedding provider failures

Add the import at the top of `src/agent/agent.ts`:

```typescript
import { isConstellationError, wrapError } from '@/errors/index.js';
import { traceError } from '@/errors/trace.js';
```

**Catch block 1: Tool dispatch (line ~295)**

This is the primary target. Currently:

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  toolResult = `Error executing tool ${toolUse.name}: ${errorMsg}`;
  recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, false, errorMsg);
}
```

Update to also trace via `traceError` when a `TraceRecorder` is available:

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  toolResult = `Error executing tool ${toolUse.name}: ${errorMsg}`;
  recordTrace(toolUse.name, toolUse.input, toolResult, Date.now() - startTime, false, errorMsg);

  // Record structured error trace if available
  if (deps.traceRecorder) {
    const structured = isConstellationError(error)
      ? error
      : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { toolName: toolUse.name });
    traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
  }
}
```

The existing `recordTrace` call is preserved — it records the tool-level trace with timing. The new `traceError` call records the structured error trace with subsystem context. Both fire-and-forget.

**Catch block 2: Recall pipeline (line ~160)**

Currently:

```typescript
} catch (error) {
  console.warn('recall: pipeline failed, continuing without recall', error);
  cachedRecallResult = null;
}
```

Update to also trace the error (AC5.3 — errors that are caught and handled are still traced):

```typescript
} catch (error) {
  console.warn('recall: pipeline failed, continuing without recall', error);
  cachedRecallResult = null;

  if (deps.traceRecorder) {
    const structured = isConstellationError(error)
      ? error
      : wrapError(error, 'RECALL_FAILED', 'agent', {});
    traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
  }
}
```

**Catch block 3: Skill retrieval (line ~182)**

Currently:

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.warn(`failed to retrieve relevant skills: ${errorMsg}`);
}
```

This is a non-critical failure (skills are optional). Add tracing but keep the existing behavior:

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.warn(`failed to retrieve relevant skills: ${errorMsg}`);

  if (deps.traceRecorder) {
    const structured = isConstellationError(error)
      ? error
      : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { operation: 'skill_retrieval' });
    traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
  }
}
```

**Catch block 4: Embedding (line ~380)**

Currently:

```typescript
} catch (error) {
  console.warn('embedding provider failed for message, storing with null embedding', error);
  return null;
}
```

This is a fire-and-forget helper. Do NOT add tracing here — embedding failures are expected and high-frequency (e.g., when no embedding provider is configured). Tracing every one would flood the trace store. Per AC5.4, this is also partially outside the agent loop's main processing path.

**Variable scoping confirmation:** In `createAgent()`, the following variables are in scope at all four catch sites via closure:
- `deps.owner` — closure variable from the `deps` parameter of `createAgent()`; available at all catch sites
- `id` — the `conversationId` variable, also a closure variable from the outer function scope
- Catch block 1 (tool dispatch, line ~295): `deps.owner` in scope, `id` in scope
- Catch block 2 (recall pipeline, line ~160): `deps.owner` in scope, `id` in scope
- Catch block 3 (skill retrieval, line ~182): `deps.owner` in scope, `id` in scope
- Catch block 4 (embedding, line ~380): not modified (no traceError call added)

**IMPORTANT:** Do not change any existing behavior. The existing `recordTrace`, `console.warn`, and return values all stay. The `traceError` calls are purely additive.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing agent tests pass. The new `traceError` calls are fire-and-forget and require no mock setup in existing tests (they only fire when `deps.traceRecorder` is present, and most test setups don't provide one).

**Commit:** `feat(agent): wire traceError into agent loop catch blocks`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports with trace module

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/errors/index.ts`

**Implementation:**

Add the trace export:

```typescript
export { traceError } from './trace.js';
```

The final `src/errors/index.ts` should export everything from all four phases:

```typescript
// pattern: Functional Core (barrel export)

// Phase 1: Base
export { ConstellationError } from './base.js';
export { isConstellationError, wrapError } from './utils.js';

// Phase 2: Memory and Model
export { MemoryError } from './memory.js';
export type { MemoryErrorCode } from './memory.js';
export { ModelError } from './model.js';
export type { ModelErrorCode } from './model.js';

// Phase 3: Persistence, Agent, Config
export { PersistenceError, sanitizeQuery } from './persistence.js';
export type { PersistenceErrorCode } from './persistence.js';
export { AgentError } from './agent.js';
export type { AgentErrorCode } from './agent.js';
export { ConfigError } from './config.js';
export type { ConfigErrorCode } from './config.js';

// Phase 4: Trace integration
export { traceError } from './trace.js';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `feat(errors): complete barrel exports with trace integration`
<!-- END_TASK_3 -->
