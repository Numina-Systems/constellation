# Cache-Bust Detection Design

## Summary

Constellation has no visibility into why Anthropic prompt cache misses happen. When cache misses occur, latency increases (the full prefix must be re-tokenized) and cost increases (no cache discount on input tokens). These misses happen silently — the operator has no way to distinguish between an expected cache bust (tools changed, compaction rewrote history) and an unexpected one (a context provider mutated content that should have been stable, a message was accidentally reordered).

This feature adds a diagnostic layer that snapshots cache-sensitive dimensions before each model call, compares against the previous turn's snapshot, and logs warnings when unexpected changes are detected. It integrates with the existing `TraceRecorder` to record cache-bust events as operation traces, giving the operator a clear audit trail of what changed and when.

The system is purely observational — it never modifies the request or prevents the model call. It's a diagnostic tool, not a gate. Gated behind a `cache_diagnostics` config flag (default true) so it can be disabled if the overhead is unwanted.

Ported from Pattern's cache-drift detector, adapted for Constellation's Anthropic SDK integration, `TraceRecorder` pattern, and TOML+Zod config.

## Definition of Done

1. Before each model call, the system snapshots cache-sensitive dimensions (system prompt, tool definitions, beta headers, message prefix).
2. If any dimension changed unexpectedly since the previous turn, a warning is logged identifying the specific dimension and a summary of what changed.
3. Expected changes (after compaction, tool registration changes, first turn) are suppressed — no false positive warnings.
4. Cache-bust events are recorded as operation traces via `TraceRecorder`.
5. The feature is gated behind `cache_diagnostics` config flag (default true).
6. Snapshots are lightweight in-memory structures, not persisted to the database.

## Acceptance Criteria

### cache-bust-detection.AC1: Dimension Snapshotting
- **cache-bust-detection.AC1.1 Success:** System prompt content is hashed and stored before each model call
- **cache-bust-detection.AC1.2 Success:** Tool definitions (serialized) are hashed and stored before each model call
- **cache-bust-detection.AC1.3 Success:** Message prefix (all messages except the last) is hashed and stored
- **cache-bust-detection.AC1.4 Success:** Beta headers (if any) are hashed and stored
- **cache-bust-detection.AC1.5 Edge:** First turn has no previous snapshot — no comparison is performed, no warning emitted

### cache-bust-detection.AC2: Change Detection
- **cache-bust-detection.AC2.1 Success:** System prompt content change between turns triggers a warning with dimension name `"system_prompt"`
- **cache-bust-detection.AC2.2 Success:** Tool definition change triggers a warning with dimension name `"tool_definitions"`
- **cache-bust-detection.AC2.3 Success:** Message prefix mutation (reordering, editing, deletion) triggers a warning with dimension name `"message_prefix"`
- **cache-bust-detection.AC2.4 Success:** Warning includes a diff summary: which dimension changed and an approximate content delta size (character count difference)
- **cache-bust-detection.AC2.5 Success:** Multiple dimensions changing in the same turn produce one warning per dimension, not one aggregate warning

### cache-bust-detection.AC3: False Positive Suppression
- **cache-bust-detection.AC3.1 Success:** Turn immediately after compaction does not produce a warning for `message_prefix` changes (compaction rewrites history)
- **cache-bust-detection.AC3.2 Success:** Turn immediately after compaction does not produce a warning for `system_prompt` changes (compaction may trigger full snapshot in batch-anchored-snapshots)
- **cache-bust-detection.AC3.3 Success:** First turn of a conversation produces no warnings
- **cache-bust-detection.AC3.4 Success:** Tool registration/deregistration (e.g., MCP reconnection) does not produce a warning for `tool_definitions` if the change was signalled via a `toolsChanged` flag
- **cache-bust-detection.AC3.5 Edge:** Compaction that doesn't actually change any messages (no-op compaction) correctly produces no warning

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

## Glossary

- **Cache-sensitive dimension**: A component of the model request whose content identity affects Anthropic's prompt cache key. Changes to any dimension bust the cache for that prefix position.
- **Dimension snapshot**: A lightweight in-memory record of content hashes for each cache-sensitive dimension, taken before each model call.
- **Content hash**: A fast non-cryptographic hash (via `Bun.hash()`) of a dimension's serialized content. Used for equality comparison, not security.
- **Diff summary**: A human-readable description of what changed in a dimension — e.g., "system_prompt changed: 15234 chars → 15280 chars (+46)". Not a line-by-line diff.
- **Suppression flag**: A per-turn signal that marks certain dimension changes as expected (e.g., `compactionOccurred`, `toolsChanged`). Prevents false positive warnings.
- **TraceRecorder**: Existing interface (`src/reflexion/types.ts`) for fire-and-forget operation tracing. Records tool name, input, output summary, duration, and success/failure.
- **Message prefix**: All messages in the conversation history except the last one. Anthropic caches the tokenized prefix, so changes to any message in the prefix bust the cache.
- **Beta headers**: Optional HTTP headers passed to the Anthropic API that may affect request processing (e.g., `anthropic-beta`). Changes to these can affect cache behavior.

## Architecture

Cache-bust detection is a diagnostic observer that sits in the agent loop immediately before `model.complete()`. It's purely read-only — it inspects the request that's about to be sent, compares it to the previous request, and logs/traces if something changed unexpectedly.

### Components

**CacheDiagnostics** (`src/agent/cache-diagnostics.ts`, Functional Core) — Stateful object that holds the previous turn's dimension hashes and suppression flags. Exposes `checkForCacheBust(request, flags)` which computes hashes for the current request, compares against stored hashes, and returns a list of `CacheBustEvent` objects describing any unexpected changes. Pure in the sense that it has no I/O — state mutation is limited to updating the stored hashes.

**Dimension hasher** (internal to `cache-diagnostics.ts`) — Hashes each dimension independently:
- `system_prompt`: hash of the system prompt string
- `tool_definitions`: hash of the JSON-serialized tool array (sorted by name for stability)
- `message_prefix`: hash of the JSON-serialized message array excluding the last element
- `beta_headers`: hash of sorted beta header values (if any)

**Integration point** (`src/agent/agent.ts`) — Before calling `model.complete()`, the agent loop calls `cacheDiagnostics.checkForCacheBust()` with the current request and any suppression flags. If events are returned, they're logged as warnings and recorded via `TraceRecorder`.

### Contracts

```typescript
// src/agent/cache-diagnostics.ts

type CacheDimension =
  | 'system_prompt'
  | 'tool_definitions'
  | 'message_prefix'
  | 'beta_headers';

type CacheBustEvent = {
  readonly dimension: CacheDimension;
  readonly previousSize: number;
  readonly currentSize: number;
  readonly delta: number;
  readonly turn: number;
};

type SuppressionFlags = {
  readonly compactionOccurred?: boolean;
  readonly toolsChanged?: boolean;
  readonly isFirstTurn?: boolean;
};

type CacheDiagnostics = {
  checkForCacheBust(
    systemPrompt: string,
    tools: ReadonlyArray<unknown>,
    messages: ReadonlyArray<unknown>,
    betaHeaders: ReadonlyArray<string> | undefined,
    turn: number,
    flags: SuppressionFlags,
  ): ReadonlyArray<CacheBustEvent>;
  reset(): void;
};

function createCacheDiagnostics(): CacheDiagnostics;
```

### Suppression Logic

Not all cache busts are unexpected. The suppression matrix:

| Dimension | Suppressed when |
|-----------|----------------|
| `system_prompt` | `compactionOccurred` (compaction may change context), `isFirstTurn` |
| `tool_definitions` | `toolsChanged` (explicit tool registration change), `isFirstTurn` |
| `message_prefix` | `compactionOccurred` (compaction rewrites history), `isFirstTurn` |
| `beta_headers` | `isFirstTurn` |

When a dimension change is suppressed, the new hash is still stored (so the next turn compares against the post-change state), but no warning is emitted.

### Data Flow

```
Agent Loop (before model.complete())
    │
    ├── Compute suppression flags
    │   ├── compactionOccurred: true if compaction fired this turn
    │   ├── toolsChanged: true if tool registry changed since last turn
    │   └── isFirstTurn: true if no previous snapshot exists
    │
    ├── cacheDiagnostics.checkForCacheBust(...)
    │   ├── Hash each dimension
    │   ├── Compare against stored hashes
    │   ├── Apply suppression
    │   └── Return unsuppressed CacheBustEvents
    │
    ├── For each event:
    │   ├── Log warning: "Cache bust detected: {dimension} changed ({delta} chars)"
    │   └── traceRecorder.record({ tool: "cache_diagnostics", ... })
    │
    └── model.complete(request)   ← request is unmodified
```

## Existing Patterns

- **TraceRecorder** — `src/reflexion/types.ts` defines fire-and-forget trace recording. Cache-bust traces follow the same pattern as tool dispatch traces in `agent.ts`.
- **`Bun.hash()`** — Already used (or available) for fast non-cryptographic hashing. Same approach as content hashing in the batch-anchored-snapshots design.
- **Config in `[agent]` section** — New fields added to `AgentConfigSchema` with defaults. Same pattern as `recall_enabled`, `recall_token_budget`.
- **Factory functions** — `createCacheDiagnostics()` returns the interface. No classes.
- **Functional Core / Imperative Shell** — `CacheDiagnostics` is Functional Core (stateful but no I/O). Agent loop integration is Imperative Shell.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Dimension Hashing and Comparison

**Goal:** Implement the core hashing and comparison logic for cache-sensitive dimensions.

**Components:**
- `src/agent/cache-diagnostics.ts` (Functional Core) — `createCacheDiagnostics()` factory, dimension hashing with `Bun.hash()`, comparison logic, `CacheBustEvent` and `CacheDimension` types
- `src/agent/cache-diagnostics.test.ts` — Unit tests: first call stores hashes without events, identical second call produces no events, system prompt change produces event, tool definition change produces event, message prefix change produces event, multiple changes produce multiple events, delta calculation is correct

**Dependencies:** None

**Covers:** cache-bust-detection.AC1 (dimension snapshotting), cache-bust-detection.AC2 (change detection)

**Done when:** `checkForCacheBust()` correctly detects changes in each dimension, produces accurate events with size deltas, and stores updated hashes for next comparison. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Suppression Logic

**Goal:** Suppress false positive warnings for expected changes (compaction, tool registration, first turn).

**Components:**
- `src/agent/cache-diagnostics.ts` — Add suppression flag handling to `checkForCacheBust()`. Suppressed changes still update stored hashes but produce no events.
- `src/agent/cache-diagnostics.test.ts` — Additional unit tests: compaction suppresses system_prompt and message_prefix events, toolsChanged suppresses tool_definitions events, isFirstTurn suppresses all events, suppressed changes still update hashes (next unsuppressed turn compares against post-change state), no-op compaction produces no events

**Dependencies:** Phase 1

**Covers:** cache-bust-detection.AC3 (false positive suppression)

**Done when:** Suppression flags correctly prevent warnings for expected changes while still updating internal state. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Agent Loop Integration and Trace Recording

**Goal:** Wire cache diagnostics into the agent loop, add logging and trace recording, add config gating.

**Components:**
- `src/agent/agent.ts` — Create `CacheDiagnostics` instance in agent state. Before each `model.complete()` call, compute suppression flags and call `checkForCacheBust()`. Log warnings for returned events. Record events via `TraceRecorder`.
- `src/agent/types.ts` — Add `cache_diagnostics` boolean to `AgentConfig`
- `src/config/schema.ts` — Add `cache_diagnostics` field to `AgentConfigSchema` (default `true`)
- `src/config/config.ts` — Map config field to agent config
- `src/index.ts` — Pass config value through to agent construction

**Dependencies:** Phases 1, 2

**Covers:** cache-bust-detection.AC4 (trace recording), cache-bust-detection.AC5 (config gating), cache-bust-detection.AC6 (performance)

**Done when:** Cache diagnostics run before every model call when enabled. Warnings logged for unexpected changes. Traces recorded via TraceRecorder. Disabled when config flag is false. Build succeeds (`bun run build`). All tests pass.
<!-- END_PHASE_3 -->

## Additional Considerations

**Tool definition ordering.** Tool arrays may not be consistently ordered between turns if tools are registered dynamically (e.g., MCP reconnection). The dimension hasher sorts tools by name before serializing to avoid false positives from reordering. This is a hash-time normalization, not a mutation of the actual tool array.

**Message prefix sensitivity.** The message prefix hash will change whenever a new message is added to history (which happens every turn). This is an *expected* change — the prefix grows by one message each turn. The hasher should therefore hash only the messages that existed in the previous turn's prefix (i.e., compare the first N messages of the current prefix against the previous prefix of length N, then check if the only difference is appended messages). Alternatively, hash each message individually and compare the overlapping subsequence. Implementation should handle this to avoid a false positive on every single turn.

**Relationship to batch-anchored-snapshots.** If batch-anchored-snapshots is implemented, the system prompt should be stable between turns, meaning `system_prompt` cache-bust events become strong signals of a bug rather than expected noise. These two features complement each other: batch-anchored-snapshots reduces cache busts, cache-bust-detection verifies that the reduction is working.

**No persistence.** Snapshots are in-memory only. They reset on daemon restart. This is intentional — cache diagnostics are a runtime observation tool, not an audit log. The `TraceRecorder` provides persistence for significant events.
