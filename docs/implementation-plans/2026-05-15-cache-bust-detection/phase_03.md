# Cache-Bust Detection Implementation Plan — Phase 3

**Goal:** Wire cache diagnostics into the agent loop with logging, trace recording, and config gating so cache busts are detected and recorded in production.

**Architecture:** Imperative Shell integration — creates `CacheDiagnostics` instance in agent state, calls it before each `model.complete()`, logs warnings via `console.warn()`, records traces via the existing `recordTrace()` wrapper. Gated behind `cache_diagnostics` config flag.

**Tech Stack:** Bun (TypeScript), Zod config schema

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-bust-detection.AC4: Trace Recording
- **cache-bust-detection.AC4.1 Success:** Each cache-bust event is recorded via `TraceRecorder` with tool name `"cache_diagnostics"`, input containing the changed dimensions, and output containing the diff summary
- **cache-bust-detection.AC4.2 Success:** Turns with no cache bust produce no trace (not a "no change" trace)
- **cache-bust-detection.AC4.3 Success:** Trace includes the turn number for correlation with conversation history

### cache-bust-detection.AC5: Config Gating
- **cache-bust-detection.AC5.1 Success:** `cache_diagnostics = false` skips all snapshotting and comparison (zero overhead)
- **cache-bust-detection.AC5.2 Success:** `cache_diagnostics = true` (default) enables snapshotting and comparison
- **cache-bust-detection.AC5.3 Success:** Config field lives in the `[agent]` section of config.toml

### cache-bust-detection.AC6: Performance
- **cache-bust-detection.AC6.1 Success:** Snapshot computation adds < 5ms overhead per turn (hashing only, no serialization to disk)
- **cache-bust-detection.AC6.2 Success:** Previous snapshot is replaced in-place — no accumulation of historical snapshots in memory
- **cache-bust-detection.AC6.3 Edge:** Very large system prompts (100K+ chars) are hashed in constant time relative to content size (hash function is O(n) in content length, but no additional overhead)

---

<!-- START_TASK_1 -->
### Task 1: Add cache_diagnostics config field

**Verifies:** cache-bust-detection.AC5.3

**Files:**
- Modify: `src/config/schema.ts` (the `AgentConfigSchema = z.object({...})` block, currently lines 6-16)
- Modify: `src/agent/types.ts` (the `AgentConfig` type definition, currently lines 21-31)
- Modify: `src/index.ts` (the `config: { ... }` block inside the `createAgent()` call, currently lines 967-976)

**Implementation:**

**In `src/config/schema.ts`:** Add `cache_diagnostics` to the `AgentConfigSchema` Zod object. Follow the existing pattern of `recall_enabled`:

```typescript
cache_diagnostics: z.boolean().default(true),
```

Note: Default is `true` per design (AC5.2). This differs from `recall_enabled` which defaults to `false`.

**In `src/agent/types.ts`:** Add the field to `AgentConfig`:

```typescript
cache_diagnostics?: boolean;
```

**In `src/index.ts`:** Add to the config unpacking block at lines 967-976, following the `recall_token_budget` line:

```typescript
cache_diagnostics: config.agent.cache_diagnostics,
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(config): add cache_diagnostics config field`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Integrate cache diagnostics into agent loop

**Verifies:** cache-bust-detection.AC4.1, cache-bust-detection.AC4.2, cache-bust-detection.AC4.3, cache-bust-detection.AC5.1, cache-bust-detection.AC5.2, cache-bust-detection.AC6.1, cache-bust-detection.AC6.2

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

This task wires cache diagnostics into the agent loop. Follow the existing `snapshotState` pattern (created after `const dynamicProviders = buildDynamicProviderMap(...)`, currently around line 107-110).

**Step 1: Import and initialize state**

At the top of `agent.ts`, import `createCacheDiagnostics` from `./cache-diagnostics.ts`.

In `createAgent()`, after the `const snapshotState = createSnapshotState();` line (currently line 107), conditionally create the cache diagnostics instance:

```typescript
const cacheDiagnostics = deps.config.cache_diagnostics !== false
  ? createCacheDiagnostics()
  : null;
```

Add a conversation-level turn counter and a tool hash tracker for change detection:

```typescript
let turnNumber = 0;
let previousToolsHash: bigint | null = null;
```

**Step 2: Add turn counter increment**

At the start of `processMessage()` (after the `async processMessage(input, event?)` signature, currently around line 137), increment the turn counter:

```typescript
turnNumber++;
```

**Step 3: Track compaction flag**

Before the pre-turn compaction block (the `if (deps.compactor && shouldCompress(...))` block, currently around lines 152-157), declare a mutable flag:

```typescript
let compactionOccurredThisTurn = false;
```

Inside the compaction block, after the `compress()` call succeeds and `history` is reassigned, set the flag:

```typescript
compactionOccurredThisTurn = result.messagesCompressed > 0;
```

For tool-round compaction (the second `if (deps.compactor)` block inside the while loop, currently around lines 318-325), set the same flag there too since cache diagnostics runs before each `model.complete()` in the tool round loop.

**Step 4: Detect tool changes**

Before calling `checkForCacheBust`, compute the current tool hash and compare against the stored one:

```typescript
const currentToolsSerialized = JSON.stringify(
  Array.from(modelTools).sort((a: unknown, b: unknown) =>
    ((a as { name?: string }).name ?? '').localeCompare(
      (b as { name?: string }).name ?? '',
    ),
  ),
);
const currentToolsHash = BigInt(Bun.hash(currentToolsSerialized));
const toolsChangedThisTurn = previousToolsHash !== null && currentToolsHash !== previousToolsHash;
previousToolsHash = currentToolsHash;
```

This uses the same sorting-before-hashing approach as the `CacheDiagnostics` internals for consistency. The hash comparison happens in the agent loop because the tool registry has no built-in change detection mechanism.

**Step 5: Call cache diagnostics before model.complete()**

Immediately before the `const response = await deps.model.complete(modelRequest);` call (currently around line 265), insert the cache diagnostics check:

```typescript
if (cacheDiagnostics) {
  const cacheBustEvents = cacheDiagnostics.checkForCacheBust(
    systemPrompt,
    modelTools,
    finalMessages,
    undefined,
    turnNumber,
    {
      compactionOccurred: compactionOccurredThisTurn,
      toolsChanged: toolsChangedThisTurn,
      isFirstTurn: turnNumber === 1 && roundCount === 1,
    },
  );

  for (const event of cacheBustEvents) {
    const summary = `${event.dimension} changed: ${event.previousSize} chars → ${event.currentSize} chars (${event.delta >= 0 ? '+' : ''}${event.delta})`;
    console.warn(`cache bust detected (turn ${event.turn}): ${summary}`);
    recordTrace(
      'cache_diagnostics',
      { dimension: event.dimension, turn: event.turn },
      summary,
      0,
      true,
      null,
    );
  }

  // Reset after consumption so subsequent tool rounds in the same turn
  // don't carry the flag forward (unless compaction happens again in the tool round).
  compactionOccurredThisTurn = false;
}
```

Notes on the implementation:
- `toolsChangedThisTurn` is computed by hashing the current tool array and comparing against the previous hash stored in the agent closure. This fulfils AC3.4 — MCP reconnections that change tools will set this flag and suppress the `tool_definitions` warning.
- `isFirstTurn` is `true` only when it's both the first turn AND first round (tool rounds within a turn are not separate "turns").
- `undefined` for `betaHeaders` — beta headers are applied at the Anthropic adapter layer (`src/model/anthropic.ts`), not surfaced in `ModelRequest`. The `beta_headers` dimension is fully functional in the `CacheDiagnostics` core and tested in unit tests, but the agent loop cannot provide real values without modifying `ModelRequest`. This is an intentional scope boundary: adding beta headers to `ModelRequest` would require changes across all model provider adapters. If beta header tracking is needed in production, a follow-up should thread them through `ModelRequest` or provide a separate extraction point.
- `durationMs: 0` — the trace records that the event happened, not how long the check took. The check itself is near-instantaneous (AC6.1).
- The `compactionOccurredThisTurn = false` reset is placed **inside** the `if (cacheDiagnostics)` block, **after** the events are processed. This ensures the flag is consumed before being cleared. Subsequent tool rounds in the same turn start with a clean flag unless tool-round compaction sets it again.

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(agent): integrate cache diagnostics into agent loop`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for agent loop integration

**Verifies:** cache-bust-detection.AC4.1, cache-bust-detection.AC4.2, cache-bust-detection.AC4.3, cache-bust-detection.AC5.1, cache-bust-detection.AC5.2, cache-bust-detection.AC6.1, cache-bust-detection.AC6.2, cache-bust-detection.AC6.3

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Testing:**

Add new `describe` blocks for AC4, AC5, and AC6 to the existing test file.

**AC4 tests (Trace Recording):** These test the integration contract — that events are formatted and recorded correctly.

- **cache-bust-detection.AC4.1:** Verify that `CacheBustEvent` contains all fields needed for trace recording: `dimension` (for input), `previousSize`/`currentSize`/`delta` (for output summary). The trace call pattern `recordTrace('cache_diagnostics', { dimension, turn }, summary, ...)` is tested by verifying the event shape.
- **cache-bust-detection.AC4.2:** Verify that when no dimensions change between calls, `checkForCacheBust` returns an empty array (no events = no traces).
- **cache-bust-detection.AC4.3:** Verify that the `turn` field on returned events matches the `turn` parameter passed to `checkForCacheBust`.

**AC5 tests (Config Gating):** These are integration-level concerns — config gating happens in `agent.ts` by conditionally creating the `CacheDiagnostics` instance. Unit tests verify:

- **cache-bust-detection.AC5.1:** Test that when `createCacheDiagnostics()` is NOT called (simulating `cache_diagnostics = false`), no hashing or comparison occurs. This is inherently true — if the object isn't created, nothing runs.
- **cache-bust-detection.AC5.2:** Test that `createCacheDiagnostics()` returns a working instance that detects changes (already covered by Phase 1/2 tests, but include a basic sanity test in this section).

**AC6 tests (Performance):**

- **cache-bust-detection.AC6.1:** Performance benchmark test. Create a diagnostics instance, call `checkForCacheBust` with realistic-sized inputs (system prompt ~10K chars, 20 tools, 50 messages). Measure wall clock time with `performance.now()`. Assert < 5ms. Run the check 100 times and verify average is under 5ms.
- **cache-bust-detection.AC6.2:** Call `checkForCacheBust` 100 times with changing content. After all calls, verify the diagnostics instance has not accumulated state (test `reset()` then verify next call behaves like first turn — no historical data leaked).
- **cache-bust-detection.AC6.3:** Create a 100K+ character system prompt. Call `checkForCacheBust` twice (first to establish, second to compare). Verify it completes within reasonable time (< 10ms) and produces correct results.

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass (Phase 1, 2, and 3 tests)

**Commit:** `test(agent): add integration and performance tests for cache-diagnostics`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Integration test for agent loop wiring

**Verifies:** cache-bust-detection.AC4.1, cache-bust-detection.AC5.1, cache-bust-detection.AC5.2

**Files:**
- Modify: `src/agent/agent.test.ts`

**Testing:**

Add an integration test that verifies the full pipeline: agent loop → `checkForCacheBust` → `recordTrace`. Follow the existing `agent.test.ts` patterns which use `createMockModelProvider`, `createMockPersistenceProvider`, etc.

Add a new `describe('Cache Diagnostics Integration', ...)` block:

- **Config gating OFF:** Create an agent with `cache_diagnostics: false` in config and a mock `traceRecorder` that captures calls. Run two turns with different system prompts. Verify `traceRecorder.record` was NEVER called with `toolName: 'cache_diagnostics'`.

- **Config gating ON with change detection:** Create an agent with `cache_diagnostics: true` (or omit to use default) and a mock `traceRecorder` that captures calls. Configure the mock model to return a simple assistant response (no tool use) so each `processMessage` completes in one round. Run turn 1 (establishes baseline — no trace). Run turn 2 with same setup (no change — no trace). Modify the system prompt between turns (this requires the test to control what `buildSystemPrompt` returns — either by providing a mock memory manager that returns different content, or by directly testing that `traceRecorder.record` is called with `toolName: 'cache_diagnostics'` when a change is detected).

  If controlling the system prompt is too complex due to `buildSystemPrompt` internals, an alternative approach: verify that the `CacheDiagnostics` instance is called by checking that `traceRecorder.record` is NOT called with `'cache_diagnostics'` on the first turn (first-turn suppression) and IS called on a subsequent turn where compaction occurs (compaction rewrites messages, triggering `message_prefix` change).

- **Trace shape verification:** When a cache-bust trace is recorded, verify it contains `toolName: 'cache_diagnostics'`, `input` with `dimension` and `turn` fields, and a non-empty `outputSummary`.

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass (existing + new cache diagnostics tests)

**Commit:** `test(agent): add integration test for cache-diagnostics agent loop wiring`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Verify build and full test suite

**Verifies:** None (final verification)

**Files:** None (verification only)

**Verification:**
Run: `bun run build`
Expected: Type-check passes with no errors

Run: `bun test`
Expected: All tests pass, no regressions

**Commit:** No commit needed — verification only.

<!-- END_TASK_5 -->
