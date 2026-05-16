# Cache-Bust Detection Test Requirements

Maps each acceptance criterion from the [design plan](../../design-plans/2026-05-15-cache-bust-detection.md) to specific tests. Every AC is covered by either an automated test or documented human verification.

## Automated Tests

### cache-bust-detection.AC1: Dimension Snapshotting

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC1.1 | unit | `src/agent/cache-diagnostics.test.ts` | Call `checkForCacheBust` twice with same system prompt (no event), then with changed prompt (event produced). Verifies system prompt content is hashed and stored. |
| AC1.2 | unit | `src/agent/cache-diagnostics.test.ts` | Call twice with identical tool arrays (no event), then with changed tools (event produced). Verifies tool definitions are serialized, hashed, and stored. |
| AC1.3 | unit | `src/agent/cache-diagnostics.test.ts` | Identical message prefix produces no event. Mutated prefix (edit/reorder/delete) produces event. Appending a new message to the prefix does NOT produce an event (only overlapping subsequence is compared). |
| AC1.4 | unit | `src/agent/cache-diagnostics.test.ts` | Identical beta headers produce no event; changed headers produce event. Also test with `undefined` beta headers across calls. |
| AC1.5 | unit | `src/agent/cache-diagnostics.test.ts` | First call to `checkForCacheBust` returns empty array regardless of input content. Verifies no comparison is performed when no previous snapshot exists. |

### cache-bust-detection.AC2: Change Detection

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC2.1 | unit | `src/agent/cache-diagnostics.test.ts` | System prompt change between turns returns event with `dimension: 'system_prompt'`. |
| AC2.2 | unit | `src/agent/cache-diagnostics.test.ts` | Tool definition change returns event with `dimension: 'tool_definitions'`. |
| AC2.3 | unit | `src/agent/cache-diagnostics.test.ts` | Message prefix mutation (edit, reorder, delete) returns event with `dimension: 'message_prefix'`. Three sub-cases: edit existing message, reorder messages, delete a message from prefix. |
| AC2.4 | unit | `src/agent/cache-diagnostics.test.ts` | Returned event includes correct `previousSize`, `currentSize`, and `delta` (character count difference). Delta is `currentSize - previousSize`. Verified against known input string lengths. |
| AC2.5 | unit | `src/agent/cache-diagnostics.test.ts` | Change both system prompt and tools simultaneously. Verify two separate events returned (one per dimension), not one aggregate event. |

### cache-bust-detection.AC3: False Positive Suppression

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC3.1 | unit | `src/agent/cache-diagnostics.test.ts` | Establish baseline, then change messages with `{ compactionOccurred: true }`. Verify no `message_prefix` event returned. Also verify hashes ARE updated (third call with same content produces no event). |
| AC3.2 | unit | `src/agent/cache-diagnostics.test.ts` | Establish baseline, then change system prompt with `{ compactionOccurred: true }`. Verify no `system_prompt` event returned. |
| AC3.3 | unit | `src/agent/cache-diagnostics.test.ts` | First call with `{ isFirstTurn: true }` returns no events. Also: establish baseline, then change all dimensions with `{ isFirstTurn: true }` — all dimensions suppressed. |
| AC3.4 | unit | `src/agent/cache-diagnostics.test.ts` | Establish baseline, change tools with `{ toolsChanged: true }`. Verify no `tool_definitions` event. Third call with same tools, no flags — no event (hashes updated during suppression). |
| AC3.5 | unit | `src/agent/cache-diagnostics.test.ts` | Establish baseline, call again with identical content and `{ compactionOccurred: true }`. No events returned — no-op compaction produces no warnings because nothing actually changed. |

Additional suppression correctness tests:

| Variant | Type | Test File | Description |
|---------|------|-----------|-------------|
| Selective suppression | unit | `src/agent/cache-diagnostics.test.ts` | Change both system prompt and tools with `{ compactionOccurred: true }`. System prompt suppressed, but `tool_definitions` event IS returned (compaction does not suppress tool changes). |
| Beta headers vs compaction | unit | `src/agent/cache-diagnostics.test.ts` | Change beta headers with `{ compactionOccurred: true }`. Event IS returned — only `isFirstTurn` suppresses beta headers. |
| Hash update after suppression | unit | `src/agent/cache-diagnostics.test.ts` | Suppressed change updates stored hashes. Subsequent call with same post-suppression content produces no event. Subsequent call with NEW content produces event against the suppressed-but-stored baseline. |

### cache-bust-detection.AC4: Trace Recording

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC4.1 | unit | `src/agent/cache-diagnostics.test.ts` | Verify `CacheBustEvent` shape contains `dimension` (for trace input) and `previousSize`/`currentSize`/`delta` (for trace output summary). |
| AC4.1 | integration | `src/agent/agent.test.ts` | Agent loop records trace via `traceRecorder` with `toolName: 'cache_diagnostics'`, input containing `dimension` and `turn`, output containing diff summary string. |
| AC4.2 | unit | `src/agent/cache-diagnostics.test.ts` | When no dimensions change, `checkForCacheBust` returns empty array. No trace should be recorded. |
| AC4.2 | integration | `src/agent/agent.test.ts` | Run two turns with no changes. Verify `traceRecorder.record` never called with `toolName: 'cache_diagnostics'`. |
| AC4.3 | unit | `src/agent/cache-diagnostics.test.ts` | Verify that the `turn` field on returned events matches the `turn` parameter passed to `checkForCacheBust`. |

### cache-bust-detection.AC5: Config Gating

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC5.1 | integration | `src/agent/agent.test.ts` | Create agent with `cache_diagnostics: false`. Run two turns with different system prompts. Verify `traceRecorder.record` never called with `toolName: 'cache_diagnostics'`. |
| AC5.2 | integration | `src/agent/agent.test.ts` | Create agent with `cache_diagnostics: true` (or default). Verify cache diagnostics runs and detects changes when present. |
| AC5.2 | unit | `src/agent/cache-diagnostics.test.ts` | Sanity check that `createCacheDiagnostics()` returns a working instance that detects changes. |
| AC5.3 | unit | N/A (build verification) | Verify `AgentConfigSchema` includes `cache_diagnostics` as `z.boolean().default(true)` in the `[agent]` section. Validated by `bun run build` type-checking. |

### cache-bust-detection.AC6: Performance

| AC | Type | Test File | Description |
|----|------|-----------|-------------|
| AC6.1 | performance | `src/agent/cache-diagnostics.test.ts` | Benchmark: call `checkForCacheBust` with realistic inputs (10K char system prompt, 20 tools, 50 messages). Run 100 iterations, assert average < 5ms per call. |
| AC6.2 | unit | `src/agent/cache-diagnostics.test.ts` | Call `checkForCacheBust` 100 times with changing content, then call `reset()`. Verify next call behaves like first turn — no accumulated historical state. |
| AC6.3 | performance | `src/agent/cache-diagnostics.test.ts` | Create 100K+ character system prompt. Call `checkForCacheBust` twice (establish then compare). Assert completes within 10ms and produces correct results. |

## Human Verification

| AC | Justification | Verification Approach |
|----|--------------|----------------------|
| AC5.3 | Config field placement is a structural/schema concern that also requires confirming TOML rendering. | Review `src/config/schema.ts` to confirm the field is inside `AgentConfigSchema` (which maps to `[agent]`). Verify that `config.example.toml` (if present) includes `cache_diagnostics = true` under the `[agent]` section. Run `bun run build` to confirm type coherence. |
| AC6.1 | The 5ms threshold is environment-dependent. CI runners, local dev machines, and production hardware have different performance profiles. | Run `bun test src/agent/cache-diagnostics.test.ts` on the deployment target. If the benchmark test passes, the AC is met. If it fails due to environment differences, investigate whether the failure is machine-specific or algorithmic. |

## Test File Summary

| File | AC Coverage | Phase |
|------|------------|-------|
| `src/agent/cache-diagnostics.test.ts` | AC1.1-AC1.5, AC2.1-AC2.5, AC3.1-AC3.5, AC4.1-AC4.3, AC5.2, AC6.1-AC6.3 | 1, 2, 3 |
| `src/agent/agent.test.ts` | AC4.1, AC4.2, AC5.1, AC5.2 | 3 |

## Notes

- **Beta headers (AC1.4)**: Fully testable at the unit level. The agent loop passes `undefined` because beta headers are applied at the Anthropic adapter layer, not surfaced in `ModelRequest`. Unit tests validate the dimension works; production wiring is a follow-up.
- **Message prefix append detection**: The message prefix comparison hashes individual messages and only flags changes within the overlapping subsequence. Merely appending new messages is not a cache bust. Explicitly tested under AC1.3.
- **Tool ordering stability**: Tools are sorted by name before hashing. A dedicated edge-case test verifies that tools in different array order but identical content produce no event.
- **`reset()` behaviour**: Tested as an edge case under AC6.2 (no state accumulation) and implicitly under AC1.5 (post-reset call behaves like first turn).
