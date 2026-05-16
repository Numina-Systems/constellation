# Cache-Bust Detection Implementation Plan

**Goal:** Wire cache diagnostics into the agent loop with logging, trace recording, and config gating so cache busts are detected and recorded in production.

**Architecture:** Imperative Shell integration that creates a `CacheDiagnostics` instance in agent state, calls it before each `model.complete()`, logs warnings for unexpected events, and records them via `TraceRecorder`. Config gating via a new `cache_diagnostics` boolean in the `[agent]` TOML section ensures zero overhead when disabled.

**Tech Stack:** Bun, TypeScript 5.7+

**Scope:** Phase 3 of 3

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
### Task 1: Config schema extension

**Verifies:** cache-bust-detection.AC5.1, cache-bust-detection.AC5.2, cache-bust-detection.AC5.3

**Files:**
- Modify: `src/config/schema.ts`

**Implementation:**

Add `cache_diagnostics` to `AgentConfigSchema`. Follow the same pattern as `recall_enabled`:

```typescript
// In AgentConfigSchema (lines 6-16 of schema.ts)
cache_diagnostics: z.boolean().default(true),
```

This places the field in the `[agent]` section of `config.toml`. Default is `true` (enabled).

**CRITICAL: The `AgentConfig` type in `src/agent/types.ts` is manually defined, NOT inferred from the Zod schema.** You must also add `cache_diagnostics?: boolean` to the `AgentConfig` type in `src/agent/types.ts` (around line 22). Additionally, update the manual config mapping in `src/index.ts` (around lines 893-900) to include:
```typescript
cache_diagnostics: config.agent.cache_diagnostics,
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(config): add cache_diagnostics config flag`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config mapping

**Verifies:** cache-bust-detection.AC5.3

**Files:**
- Modify: `src/config/config.ts`

**Implementation:**

Map the `cache_diagnostics` field from the parsed TOML config to the agent config object. Follow the same pattern used for `recall_enabled` — find the agent config mapping section and add:

```typescript
cache_diagnostics: agentConfig.cache_diagnostics,
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(config): map cache_diagnostics to agent config`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Agent loop integration

**Verifies:** cache-bust-detection.AC4.1, cache-bust-detection.AC4.2, cache-bust-detection.AC4.3, cache-bust-detection.AC5.1, cache-bust-detection.AC6.1, cache-bust-detection.AC6.2

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

Modify `createAgent()` in `src/agent/agent.ts`:

**1. Create CacheDiagnostics instance in agent state (near line 75-80, alongside other state initialization):**

```typescript
import { createCacheDiagnostics } from './cache-diagnostics.js';
import type { CacheBustEvent } from './cache-diagnostics.js';

// Inside createAgent(), after other state declarations:
const cacheDiagnostics = deps.config.cache_diagnostics
  ? createCacheDiagnostics()
  : null;
```

If `cache_diagnostics` config is false, `cacheDiagnostics` is null and all subsequent checks are skipped (zero overhead — AC5.1).

**2. Before `model.complete()` call (before lines 208-216), add cache-bust check:**

```typescript
if (cacheDiagnostics !== null) {
  const suppressionFlags = {
    compactionOccurred: /* true if compaction fired this turn — check the compaction
       trigger at lines 126-129; a local boolean set when compaction runs */,
    toolsChanged: /* true if tool registry changed — check if tool count or
       composition differs from previous turn */,
    isFirstTurn: turn === 0,
  };

  const events = cacheDiagnostics.checkForCacheBust(
    system,
    tools,
    messages,
    /* betaHeaders — extract from model call options if available, otherwise undefined */,
    turn,
    suppressionFlags,
  );

  for (const event of events) {
    const summary = `${event.dimension} changed: ${event.previousSize} chars → ${event.currentSize} chars (${event.delta >= 0 ? '+' : ''}${event.delta})`;
    console.warn(`[cache-diagnostics] Cache bust detected on turn ${event.turn}: ${summary}`);

    // Use the existing recordTrace() helper (positional args, fire-and-forget)
    recordTrace(
      'cache_diagnostics',
      { dimension: event.dimension, turn: event.turn },
      summary,
      0,
      true,
      null,
    );
  }
}
```

**Key integration details:**

- `compactionOccurred`: Set a local boolean `let compactionThisTurn = false` at the start of `processMessage()`. Flip to `true` in **both** compaction trigger points: (a) the automatic compression check inside `processMessage()` (around the `shouldCompress` call), and (b) inside the `compact_context` tool handler (around the `compactor.compress()` call in the tool dispatch block). Both paths rewrite conversation history, so both need the suppression flag.
- `toolsChanged`: Rather than maintaining separate tool state, pass `toolsChanged: false` as the default. The `CacheDiagnostics` object already tracks tool definition hashes internally — if tools change, it detects the dimension change. The suppression flag is only needed when a tool change is *expected* (e.g., MCP reconnection). Add a `toolsChanged` signal to the tool registry or MCP client that the agent loop can query. For the initial implementation, `toolsChanged: false` is acceptable — unexpected tool changes will produce a diagnostic warning, which is the correct behaviour.
- `betaHeaders`: If the model call includes beta headers (check the `model.complete()` call signature and options), pass them. If not accessible at this point, pass `undefined`. The dimension will simply never trigger.
- `turn`: Use the existing turn counter from the agent loop.
- `recordTrace`: Use the existing `recordTrace()` helper (lines 86-109) which is fire-and-forget.

**3. Reset on compaction:**

When compaction occurs (lines 126-129), do NOT call `cacheDiagnostics.reset()`. The suppression flags handle this — resetting would lose the stored hashes and make the next turn look like a first turn, which is incorrect. The compaction flag already suppresses the expected changes.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass (existing + new)

**Commit:** `feat(agent): integrate cache-bust detection into agent loop`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Composition root wiring

**Verifies:** cache-bust-detection.AC5.2, cache-bust-detection.AC5.3

**Files:**
- Modify: `src/index.ts`

**Implementation:**

Ensure the `cache_diagnostics` config value flows through to `AgentDependencies`. Find where the agent config is constructed in `src/index.ts` (the composition root) and verify that `cache_diagnostics` is included. If `AgentDependencies` or the agent config type does not already include this field from the schema changes in Task 1, add it.

This should be minimal — if `AgentDependencies.config` uses the Zod-inferred type from `AgentConfigSchema`, the field is already present. Verify by checking the type chain.

**Verification:**
Run: `bun run build`
Expected: Type-check passes. The `cache_diagnostics` field is accessible in `createAgent()`.

**Commit:** `feat(agent): wire cache_diagnostics config through composition root`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Performance validation

**Verifies:** cache-bust-detection.AC6.1, cache-bust-detection.AC6.3

**Files:**
- Modify: `src/agent/cache-diagnostics.test.ts`

**Implementation:**

Add a performance test to the existing test file:

```
describe('AC6: Performance', () => {
  test('snapshot computation completes under 5ms for large inputs')
  // Setup:
  //   - System prompt: 100,000+ character string
  //   - Tools: 50 tool definitions with realistic schemas
  //   - Messages: 100 messages with realistic content
  //   - Beta headers: 5 headers
  // Measure:
  //   - Call checkForCacheBust() twice (first to establish baseline, second to compare)
  //   - Time the second call with performance.now()
  // Assert:
  //   - Duration < 5ms
  //   - Note: This is a soft assertion — CI environments may be slower.
  //     Use a generous threshold (e.g., 50ms) if flaky, but document
  //     that local runs should consistently be under 5ms.

  test('no historical snapshot accumulation after many turns')
  // Setup:
  //   - Call checkForCacheBust() 100 times with incrementally growing messages
  // Assert:
  //   - No OOM, function completes normally
  //   - This is a sanity check that previous snapshots are replaced, not accumulated
})
```

**Verification:**
Run: `bun test src/agent/cache-diagnostics.test.ts`
Expected: All tests pass

**Commit:** `test(agent): add performance validation for cache-bust detection`
<!-- END_TASK_5 -->
