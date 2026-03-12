# Test Requirements — Efficient Agent Loop

Maps every acceptance criterion from the [design plan](../../../docs/design-plans/2026-03-06-efficient-agent-loop.md) to either an automated test or a documented human verification. Rationalized against implementation decisions in phases 1-4.

---

## Automated Tests

| AC | Description | Test Type | Test File | Phase | Rationale |
|----|-------------|-----------|-----------|-------|-----------|
| efficient-agent-loop.AC1.1 | When agent-initiated traces exist since last review, `review-predictions` fires normally and the agent receives the review event | unit | `src/reflexion/review-gate.test.ts` | 1 | `shouldSkipReview(n)` returns `false` when `n > 0`. Composition test in `src/index.wiring.test.ts` verifies `buildReviewEvent` produces a valid event when the mock trace store returns traces. |
| efficient-agent-loop.AC1.1 | (composition) Gate + event builder integration | integration | `src/index.wiring.test.ts` | 1 | Wiring test queries a mock trace store with traces present, asserts `shouldSkipReview` returns false and `buildReviewEvent` produces a `review-job` event. Proves the two pieces compose correctly even though `handleSystemSchedulerTask` is not directly unit-testable (async IIFE inside a void callback). |
| efficient-agent-loop.AC1.2 | When zero agent-initiated traces exist since last review, `review-predictions` skips entirely -- no event pushed, no LLM call made, skip logged | unit | `src/reflexion/review-gate.test.ts` | 1 | `shouldSkipReview(0)` returns `true`. Composition test in `src/index.wiring.test.ts` verifies that when the mock trace store returns empty, the gate blocks and no event is built. |
| efficient-agent-loop.AC1.2 | (composition) Gate blocks review when idle | integration | `src/index.wiring.test.ts` | 1 | Empty trace store -> `shouldSkipReview` returns true -> handler would return early. The composition test proves the condition, even though the actual early-return wiring in `handleSystemSchedulerTask` is straightforward enough to not warrant a full handler mock. |
| efficient-agent-loop.AC1.3 | Passive inbound events (bluesky posts not acted on) do not count as activity and do not trigger a review | unit | `src/reflexion/review-gate.test.ts` | 1 | Architectural invariant: only agent-initiated tool dispatches create operation traces. Passive inbound events never call tools, so they produce zero traces. Test asserts `shouldSkipReview(0)` returns `true` with a descriptive name documenting this invariant. No separate passive-event test is needed because the trace recorder already has tests proving it only records tool dispatches (`src/reflexion/trace-recorder.test.ts`). |
| efficient-agent-loop.AC2.3 | DataSource registration wires `onMessage` handlers to a shared event queue that feeds the single agent | unit | `src/extensions/data-source-registry.test.ts` | 3 | Mock DataSources are registered, messages emitted via the stored `onMessage` handler, and the test asserts messages arrive in the `EventSink` array. Multiple sources routing to the same sink is also verified. `processEvents` callback invocation is asserted after each push. |
| efficient-agent-loop.AC2.4 | Per-source instructions are injected into `formatExternalEvent` via lookup rather than hardcoded conditionals | unit | `src/extensions/data-source-registry.test.ts` | 3 | `formatExternalEvent` accepts a `ReadonlyMap<string, string>` for source instructions. Tests verify: (a) matching source key appends instructions, (b) missing source key omits instructions, (c) undefined map omits instructions. Since `formatExternalEvent` is internal to `agent.ts`, these may be tested through `agent.processEvent` if not exported, or through dedicated export-for-test. |
| efficient-agent-loop.AC2.4 | (composition) Bluesky instructions preserved after refactor | integration | `src/index.wiring.test.ts` | 3 | Existing bluesky event formatting tests continue to pass after the hardcoded conditional is replaced with the lookup map. The Phase 3 interim wiring (hardcoded map before `createAgent`) ensures no gap. Phase 4 derives the map from registrations. |
| efficient-agent-loop.AC2.5 | Registry `shutdown()` disconnects all registered DataSources | unit | `src/extensions/data-source-registry.test.ts` | 3 | Register multiple mock DataSources, call `shutdown()`, assert `disconnect()` was called on each. Additional tests: (a) shutdown continues if one source throws during disconnect (uses `Promise.allSettled`), (b) error is logged for failed disconnects. |
| efficient-agent-loop.AC3.1 | Activity interceptor accepts a generic `highPriorityFilter` predicate instead of a bluesky-specific DID list | unit | `src/activity/activity-interceptor.test.ts` | 2 | Tests exercise `createActivityInterceptor` with various filter predicates: always-true, always-false, source-based filter, metadata-based filter. Proves the interceptor is source-agnostic. Verifies: filter returning `true` -> high priority + flagged; filter returning `false` -> normal priority; no filter -> normal priority. |
| efficient-agent-loop.AC3.2 | Bluesky high-priority DID matching works through the generic predicate (existing behaviour preserved) | unit | `src/activity/activity-interceptor.test.ts` | 2 | A DID-based filter predicate matching the composition root pattern (`authorDid` metadata lookup against a `Set`) is tested through the generic interceptor. Verifies: matching DID -> high priority; non-matching DID -> normal priority; missing `authorDid` metadata -> normal priority. This is the exact filter that the composition root will pass at runtime. |
| efficient-agent-loop.AC2.1 | A single agent instance processes REPL input, scheduler events, and bluesky firehose events in one conversation | integration | `src/index.wiring.test.ts` | 4 | Composition test verifies `processEventQueue` is called with the main agent for external (DataSource) events, matching the existing pattern that already tests scheduler events through the main agent. Combined with registry tests (AC2.3) proving events route through the shared sink, this demonstrates the single-agent topology. |
| efficient-agent-loop.AC2.2 | No second agent instance (`blueskyAgent`) exists at runtime | unit | `src/index.wiring.test.ts` | 4 | Structural assertion: the test file or a grep-based verification confirms zero occurrences of `blueskyAgent` in `src/index.ts`. This is a code-level invariant, not a runtime behaviour, but is testable as a static check. |

## Human Verification

| AC | Description | Justification | Verification Approach |
|----|-------------|---------------|----------------------|
| efficient-agent-loop.AC2.1 | A single agent instance processes REPL input, scheduler events, and bluesky firehose events in one conversation | Full end-to-end verification requires a running agent with a live Bluesky firehose, scheduler, and REPL -- infrastructure that is not available in the unit/integration test environment. The automated tests prove the wiring is correct in isolation; human verification confirms the assembled system works as expected. | Start the daemon (`bun run start`), send a REPL message, wait for a scheduler event to fire, and confirm a Bluesky firehose event arrives. All three should appear in a single conversation in the database. Verify with `SELECT DISTINCT conversation_id FROM messages WHERE owner = '<agent>'` returning exactly one active conversation. |
| efficient-agent-loop.AC4.1 | Bluesky posts are received and processed by the agent (posting, replying, liking via templates) | End-to-end bluesky interaction requires live AT Protocol credentials, a running Jetstream connection, and actual post creation on the network. The automated test coverage for this AC is compositional: registry tests prove events route correctly (AC2.3), interceptor tests prove priority filtering works (AC3.2), and existing bluesky source tests prove the source emits valid `IncomingMessage` events. The gap is the assembled end-to-end flow with real network I/O. | Start the daemon with Bluesky enabled. Trigger or wait for an inbound Bluesky post from a followed account. Verify the agent receives it (check logs for `[registry] bluesky event` or similar), processes it (LLM response in conversation), and can post a reply (verify via Bluesky app or AT Protocol API). Confirm the post appears under the agent's Bluesky handle. |
| efficient-agent-loop.AC4.2 | Prediction journaling works -- `predict`, `annotate_prediction`, `list_predictions` tools function correctly | Prediction journaling tools are not modified by this change. Existing tests in `src/reflexion/tools.test.ts` and `src/reflexion/prediction-store.test.ts` provide full coverage. Human verification is a belt-and-suspenders check that the tools remain functional in the assembled system after the agent consolidation. | Start the daemon. Issue a REPL message asking the agent to make a prediction (exercises `predict` tool). Then ask it to list predictions (`list_predictions`). Then ask it to annotate a prediction with an outcome (`annotate_prediction`). Verify all three succeed without errors. This confirms the tools are still registered and functional in the single-agent context. |
| efficient-agent-loop.AC4.3 | Sleep tasks (compaction, prediction review, pattern analysis) fire on their circadian schedule unchanged | Sleep task scheduling is not modified by this change. The circadian schedule, `suppressDuringSleep` flag, and sleep task handlers are untouched. Automated tests exist for dispatch logic (`src/activity/dispatch.test.ts`), schedule calculation (`src/activity/schedule.test.ts`), and sleep events (`src/activity/sleep-events.test.ts`). However, verifying they fire on the correct circadian offsets in a real deployment requires observing the agent across a sleep/wake cycle. | Put the agent into sleep mode (either wait for the circadian trigger or manually invoke the sleep transition). Observe logs for `sleep-compaction`, `sleep-prediction-review`, and `sleep-pattern-analysis` tasks firing at their configured offsets. Verify they complete without errors. Wake the agent and confirm normal operation resumes. This confirms the sleep task pipeline is intact after the architectural changes. |

---

## Coverage Matrix

Maps each AC to its complete test coverage (automated + human) with the phase that delivers it.

| AC | Automated | Human | Phase |
|----|-----------|-------|-------|
| efficient-agent-loop.AC1.1 | unit + integration | -- | 1 |
| efficient-agent-loop.AC1.2 | unit + integration | -- | 1 |
| efficient-agent-loop.AC1.3 | unit (architectural invariant) | -- | 1 |
| efficient-agent-loop.AC2.1 | integration (wiring) | end-to-end (single conversation) | 4 |
| efficient-agent-loop.AC2.2 | unit (structural grep) | -- | 4 |
| efficient-agent-loop.AC2.3 | unit | -- | 3 |
| efficient-agent-loop.AC2.4 | unit + integration | -- | 3 |
| efficient-agent-loop.AC2.5 | unit | -- | 3 |
| efficient-agent-loop.AC3.1 | unit | -- | 2 |
| efficient-agent-loop.AC3.2 | unit | -- | 2 |
| efficient-agent-loop.AC4.1 | compositional (AC2.3 + AC3.2 + existing source tests) | end-to-end (live bluesky) | 4 |
| efficient-agent-loop.AC4.2 | existing tests (unchanged) | smoke test (REPL) | 4 |
| efficient-agent-loop.AC4.3 | existing tests (unchanged) | circadian cycle observation | 4 |

---

## Notes

### Why AC1.3 is a unit test, not an integration test

AC1.3 ("passive inbound events do not count as activity") is an architectural invariant, not a behavioural one. The trace recorder only writes traces when the agent loop dispatches a tool call. Passive inbound events (Bluesky posts that arrive but aren't acted on) never enter the tool dispatch path, so they never produce traces. Testing this directly would require proving a negative (that a code path was *not* reached), which is better expressed as a documentation-style unit test asserting that `shouldSkipReview(0)` returns `true` -- combined with the existing trace recorder tests that prove only tool dispatches generate traces.

### Why AC4.1-AC4.3 need human verification

These are regression criteria -- they assert that *existing* functionality continues working after the architectural change. The automated tests prove each layer in isolation (registry routing, interceptor wrapping, tool registration), but the full end-to-end chain -- live network I/O, real LLM calls, circadian scheduling over real time -- cannot be replicated in a unit or integration test without extensive mocking that would test the mocks rather than the system. Human verification provides the final confirmation that the assembled system works.

### Why AC2.2 is a structural test

"No second agent instance" is a code-level invariant. A runtime test could assert this by counting agent instances, but that requires a full composition root instantiation which is not feasible in the test environment (database, LLM provider, etc.). A structural grep for `blueskyAgent` in `src/index.ts` is simpler, more reliable, and catches regressions at the source.

### Implementation decision: `formatExternalEvent` testability

Phase 3 Task 4 modifies `formatExternalEvent` to accept a `sourceInstructions` map parameter. This function is module-scoped (not exported) in `src/agent/agent.ts`. The implementation plan notes that AC2.4 can be tested either through `agent.processEvent` (public API) or by exporting the function for direct testing. The implementor should prefer testing through the public API to avoid coupling tests to internal structure, unless the indirection makes the test significantly harder to write.
