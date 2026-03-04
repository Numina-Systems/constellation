# Scheduled Task Context Hydration -- Test Requirements

Maps each acceptance criterion to automated tests and human verification items.

---

## AC-to-Test Mapping

| AC | Description | Test Type | Test File | What the Test Verifies |
|----|-------------|-----------|-----------|------------------------|
| AC1.1 | Review event content contains [Recent Activity] section with formatted traces | Integration | `src/index.wiring.test.ts` | `buildReviewEvent` called with a mock `TraceStore` returning traces produces event content containing `[Recent Activity]` header followed by formatted trace lines |
| AC1.2 | Agent-scheduled event content contains [Recent Activity] section with formatted traces | Integration | `src/index.wiring.test.ts` | `buildAgentScheduledEvent` called with a mock `TraceStore` returning traces produces event content containing `[Recent Activity]` header followed by formatted trace lines |
| AC1.3 | When no traces exist, section shows "No recent activity recorded." | Unit + Integration | `src/scheduled-context.test.ts`, `src/index.wiring.test.ts` | **Unit:** `formatTraceSummary([])` returns `"[Recent Activity]\nNo recent activity recorded."`. **Integration:** Both `buildReviewEvent` and `buildAgentScheduledEvent` with an empty-returning mock `TraceStore` produce event content containing `"No recent activity recorded."` |
| AC1.4 | Traces bounded to max 20 entries | Integration | `src/index.wiring.test.ts` | `buildReviewEvent` calls `queryTraces` with `limit: 20` (assert on mock call args) |
| AC1.5 | Only traces within 2-hour lookback window included | Integration | `src/index.wiring.test.ts` | `buildReviewEvent` calls `queryTraces` with `lookbackSince` approximately equal to `Date.now() - 2 * 3600_000` (assert on mock call args with tolerance) |
| AC2.1 | Interactive REPL messages do not include trace sections | Design | N/A | Verified by design -- see Human Verification section below |
| AC2.2 | Bluesky event processing does not include trace sections | Design | N/A | Verified by design -- see Human Verification section below |
| AC3.1 | Each trace is one line with timestamp, tool name, status, truncated output | Unit | `src/scheduled-context.test.ts` | `formatTraceSummary` given traces produces lines matching `[HH:MM] toolName ✓\|✗ outputText` format, one line per trace |
| AC3.2 | Output summaries truncated to ~80 chars per line | Unit | `src/scheduled-context.test.ts` | `formatTraceSummary` given a trace with `outputSummary` longer than 80 chars produces a line where the output portion is exactly 80 chars plus `…`. Traces at or under 80 chars are not truncated. |
| AC3.3 | Traces ordered newest-first | Unit | `src/scheduled-context.test.ts` | `formatTraceSummary` preserves input array order (relies on `queryTraces` returning `created_at DESC`). Test provides traces in newest-first order and asserts output lines match that order. |

---

## Automated Test Inventory

### `src/scheduled-context.test.ts` (Unit -- Functional Core)

| Test Case | ACs Covered |
|-----------|-------------|
| Empty traces array returns `[Recent Activity]` header with "No recent activity recorded." | AC1.3 |
| Single trace produces one formatted line with `[HH:MM] toolName ✓ output` | AC3.1 |
| Failed trace renders `✗` status indicator | AC3.1 |
| Mixed success/failure traces render correct status indicators | AC3.1 |
| Output summary longer than 80 chars is truncated with `…` | AC3.2 |
| Output summary at exactly 80 chars is not truncated | AC3.2 |
| Output summary shorter than 80 chars is not truncated | AC3.2 |
| Multiple traces preserve input order (newest-first) | AC3.3 |
| Output starts with `[Recent Activity]\n` header | AC3.1 |

### `src/index.wiring.test.ts` (Integration -- Imperative Shell)

#### `buildReviewEvent` tests (existing block, updated for async + new cases)

| Test Case | ACs Covered |
|-----------|-------------|
| Event content contains `[Recent Activity]` section when traces exist | AC1.1 |
| Event content contains "No recent activity recorded." when no traces exist | AC1.3 |
| `queryTraces` called with `limit: 20` | AC1.4 |
| `queryTraces` called with `lookbackSince` ~2 hours before now | AC1.5 |
| All existing `buildReviewEvent` tests updated from sync to async (no regressions) | AC1.1 |

#### `buildAgentScheduledEvent` tests (new describe block)

| Test Case | ACs Covered |
|-----------|-------------|
| Event content contains `[Recent Activity]` section when traces exist | AC1.2 |
| Event content contains "No recent activity recorded." when no traces exist | AC1.3 |
| Event source is `'agent-scheduled'` | AC1.2 |
| Event content includes task name | AC1.2 |
| Event metadata includes taskId, taskName, schedule, and payload | AC1.2 |
| `queryTraces` called with `limit: 20` and `lookbackSince` ~2 hours ago | AC1.2 |

---

## Human Verification Items

These ACs cannot be fully automated and require manual or design-level verification.

### AC2.1: Interactive REPL messages do not include trace sections

**Verification method:** Code path inspection.

`buildReviewEvent` and `buildAgentScheduledEvent` are called exclusively from the `scheduler.onDue` handler in `src/index.ts`. Interactive REPL messages flow through `createInteractionLoop` -> `agent.processMessage()`, which never calls either event builder function. Confirm by:

1. Search `src/index.ts` for all call sites of `buildReviewEvent` and `buildAgentScheduledEvent` -- they should appear only inside `scheduler.onDue`
2. Verify `createInteractionLoop` does not reference either function
3. Run `bun test` and confirm no regressions in existing REPL-related tests

### AC2.2: Bluesky event processing does not include trace sections

**Verification method:** Code path inspection.

Bluesky events flow through the Bluesky `onMessage` handler -> `agent.processEvent()`. This handler constructs its own `ExternalEvent` values and never calls `buildReviewEvent` or `buildAgentScheduledEvent`. Confirm by:

1. Search `src/extensions/bluesky/` and the Bluesky wiring section of `src/index.ts` for references to either event builder function -- there should be none
2. Run `bun test` and confirm no regressions in existing Bluesky-related tests
