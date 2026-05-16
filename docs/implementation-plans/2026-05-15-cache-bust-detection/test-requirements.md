# Cache-Bust Detection Test Requirements

Generated from Acceptance Criteria in the design plan.

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| cache-bust-detection.AC1.1 | System prompt content is hashed and stored before each model call | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC1.2 | Tool definitions (serialized) are hashed and stored before each model call | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC1.3 | Message prefix (all messages except the last) is hashed and stored | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC1.4 | Beta headers (if any) are hashed and stored | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC1.5 | First turn has no previous snapshot — no comparison is performed, no warning emitted | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC2.1 | System prompt content change between turns triggers a warning with dimension name `"system_prompt"` | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC2.2 | Tool definition change triggers a warning with dimension name `"tool_definitions"` | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC2.3 | Message prefix mutation (reordering, editing, deletion) triggers a warning with dimension name `"message_prefix"` | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC2.4 | Warning includes a diff summary: which dimension changed and approximate content delta size | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC2.5 | Multiple dimensions changing in the same turn produce one warning per dimension | unit | src/agent/cache-diagnostics.test.ts | 1 |
| cache-bust-detection.AC3.1 | Turn immediately after compaction does not produce a warning for `message_prefix` changes | unit | src/agent/cache-diagnostics.test.ts | 2 |
| cache-bust-detection.AC3.2 | Turn immediately after compaction does not produce a warning for `system_prompt` changes | unit | src/agent/cache-diagnostics.test.ts | 2 |
| cache-bust-detection.AC3.3 | First turn of a conversation produces no warnings | unit | src/agent/cache-diagnostics.test.ts | 2 |
| cache-bust-detection.AC3.4 | Tool registration/deregistration does not produce a warning if `toolsChanged` flag is set | unit | src/agent/cache-diagnostics.test.ts | 2 |
| cache-bust-detection.AC3.5 | Compaction that doesn't actually change any messages correctly produces no warning | unit | src/agent/cache-diagnostics.test.ts | 2 |
| cache-bust-detection.AC4.1 | Each cache-bust event is recorded via `TraceRecorder` with tool name `"cache_diagnostics"`, input containing changed dimensions, output containing diff summary | unit | src/agent/cache-diagnostics.test.ts | 3 |
| cache-bust-detection.AC4.2 | Turns with no cache bust produce no trace | unit | src/agent/cache-diagnostics.test.ts | 3 |
| cache-bust-detection.AC4.3 | Trace includes the turn number for correlation with conversation history | unit | src/agent/cache-diagnostics.test.ts | 3 |
| cache-bust-detection.AC5.1 | `cache_diagnostics = false` skips all snapshotting and comparison (zero overhead) | unit | src/agent/cache-diagnostics.test.ts | 3 |
| cache-bust-detection.AC5.2 | `cache_diagnostics = true` (default) enables snapshotting and comparison | unit | src/agent/cache-diagnostics.test.ts | 3 |
| cache-bust-detection.AC5.3 | Config field lives in the `[agent]` section of config.toml | unit | src/agent/cache-diagnostics.test.ts | 3 |

## Human Verification Required

| AC ID | Criterion | Justification | Verification Approach |
|-------|-----------|---------------|----------------------|
| cache-bust-detection.AC6.1 | Snapshot computation adds < 5ms overhead per turn | Timing-sensitive; CI variance makes hard assertions unreliable | Soft assertion in unit test (`expect(elapsed).toBeLessThan(50)` with generous margin). Manual profiling on representative conversations with 100K+ char system prompts during Phase 3 integration testing. |
| cache-bust-detection.AC6.2 | Previous snapshot is replaced in-place — no accumulation of historical snapshots in memory | Memory accumulation is difficult to assert in a unit test without inspecting internals | Code review during Phase 1. Verify `checkForCacheBust()` overwrites stored hashes rather than appending. Optionally confirm with a heap snapshot after 100 turns in a manual test session. |
| cache-bust-detection.AC6.3 | Very large system prompts (100K+ chars) are hashed in constant time relative to content size | O(n) hash is inherent to the algorithm; the criterion is "no additional overhead beyond the hash itself" | Code review confirms no extra serialization or copying beyond the hash call. Soft timing assertion in test with 100K string. |
