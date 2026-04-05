# Efficient Agent Loop Design

## Summary

Constellation's agent loop currently has two inefficiencies this design addresses. First, a prediction review task fires every hour regardless of whether the agent has done anything — burning tokens on an LLM call even when there's been no activity since the last review. Second, the Bluesky integration runs as a completely separate agent instance with its own conversation, meaning context and tool state are siloed from the primary agent the user interacts with.

The changes are structurally independent. The reflexion gate adds a pre-flight check to the hourly review scheduler: if no agent-initiated tool traces exist since the last run, the review is silently skipped. The agent consolidation introduces a DataSource registry — a thin wiring layer that connects external event sources (Bluesky today, others tomorrow) to a single shared agent conversation. This eliminates the second agent instance and generalises the activity interceptor from a Bluesky-specific construct to a source-agnostic one that any registered DataSource can configure.

## Definition of Done

1. **Dynamic daytime reflexion**: The hourly `review-predictions` task checks for agent-initiated traces since the last review and skips entirely if there are none — no LLM call, no token spend.

2. **Unified agent context**: The separate bluesky agent instance is eliminated. A single agent with a single conversation handles REPL input, scheduler events, and bluesky firehose events. Bluesky events continue to arrive tagged inline.

3. **Sleep mode untouched**: Sleep tasks (compaction, prediction review, pattern analysis) continue to work as designed — they're the circadian retrospective, not part of this change.

4. **No functional regression**: Bluesky posting/receiving, prediction journaling, and the reflexion review process all continue to work — just more efficiently.

## Acceptance Criteria

### efficient-agent-loop.AC1: Dynamic daytime reflexion
- **efficient-agent-loop.AC1.1 Success:** When agent-initiated traces exist since last review, `review-predictions` fires normally and the agent receives the review event
- **efficient-agent-loop.AC1.2 Success:** When zero agent-initiated traces exist since last review, `review-predictions` skips entirely — no event pushed, no LLM call made, skip logged
- **efficient-agent-loop.AC1.3 Edge:** Passive inbound events (bluesky posts not acted on) do not count as activity and do not trigger a review

### efficient-agent-loop.AC2: Unified agent context
- **efficient-agent-loop.AC2.1 Success:** A single agent instance processes REPL input, scheduler events, and bluesky firehose events in one conversation
- **efficient-agent-loop.AC2.2 Success:** No second agent instance (`blueskyAgent`) exists at runtime
- **efficient-agent-loop.AC2.3 Success:** DataSource registration wires `onMessage` handlers to a shared event queue that feeds the single agent
- **efficient-agent-loop.AC2.4 Success:** Per-source instructions are injected into `formatExternalEvent` via lookup rather than hardcoded conditionals
- **efficient-agent-loop.AC2.5 Success:** Registry `shutdown()` disconnects all registered DataSources

### efficient-agent-loop.AC3: Generalised activity interceptor
- **efficient-agent-loop.AC3.1 Success:** Activity interceptor accepts a generic `highPriorityFilter` predicate instead of a bluesky-specific DID list
- **efficient-agent-loop.AC3.2 Success:** Bluesky high-priority DID matching works through the generic predicate (existing behaviour preserved)

### efficient-agent-loop.AC4: No functional regression
- **efficient-agent-loop.AC4.1 Success:** Bluesky posts are received and processed by the agent (posting, replying, liking via templates)
- **efficient-agent-loop.AC4.2 Success:** Prediction journaling works — `predict`, `annotate_prediction`, `list_predictions` tools function correctly
- **efficient-agent-loop.AC4.3 Success:** Sleep tasks (compaction, prediction review, pattern analysis) fire on their circadian schedule unchanged

## Glossary

- **Agent loop**: The core cycle that receives input (user messages, scheduler events, external events), invokes the LLM, dispatches tool calls, and records results.
- **Reflexion**: The system by which the agent reviews its own past predictions and traces to evaluate accuracy — runs on a circadian schedule.
- **Trace / operation trace**: A structured record of a single tool dispatch — includes tool name, timing, and success or failure. Written by the agent loop on every tool call.
- **Prediction journaling**: Tools (`predict`, `annotate_prediction`, `list_predictions`) that let the agent log predictions and later annotate them with outcomes.
- **`review-predictions`**: A scheduled system task (hourly during waking hours) that triggers an LLM call to review recent prediction accuracy. Subject to the dynamic gate introduced here.
- **`suppressDuringSleep`**: A scheduler flag that prevents a task from firing while the agent is in sleep mode.
- **Circadian schedule / sleep tasks**: The agent's day/night cycle. Sleep tasks run on fixed offsets after entering sleep mode and are out of scope for this change.
- **DataSource**: A port interface (`src/extensions/data-source.ts`) representing any external event feed — currently only Bluesky, designed to be extended.
- **DataSource registry**: The new adapter introduced here that accepts `DataSourceRegistration` objects, wires each source's `onMessage` to a shared event queue, and provides unified lifecycle management.
- **Activity interceptor**: A transparent wrapper around an `onMessage` handler that classifies incoming events as high- or low-priority to mediate agent wake behaviour. Currently Bluesky-specific; being generalised here.
- **`highPriorityFilter`**: The generic predicate replacing the hardcoded DID list in the activity interceptor — any DataSource can supply one.
- **DID (Decentralised Identifier)**: An AT Protocol identifier for a Bluesky account (e.g., `did:plc:abc123`). Used here to distinguish followed/trusted accounts from the broader firehose.
- **Jetstream firehose**: Bluesky's real-time event stream of public posts, consumed by the `BlueskyDataSource`.
- **Compaction**: The context compression pipeline that summarises and archives older conversation turns to keep the agent's context window within budget.
- **Composition root**: `src/index.ts` — the single file where all modules are instantiated and wired together.
- **Port/adapter pattern**: A port is a TypeScript interface defining a capability; an adapter is a concrete implementation. Keeps domain logic decoupled from infrastructure.
- **Functional Core / Imperative Shell**: Pure functions handle logic (functional core); side effects and wiring happen at the edges (imperative shell).

## Architecture

Two independent changes that together reduce token waste and simplify the agent's runtime topology.

### Dynamic Daytime Reflexion

The hourly `review-predictions` system task gains a pre-flight gate. Before building the review event (which triggers an LLM call), the handler queries `traceRecorder.queryTraces()` for agent-initiated traces since `last_run_at`. If the count is zero, the review is skipped with a log line — no event is pushed, no LLM call is made.

Agent-initiated traces are tool dispatches recorded by the agent loop (every tool call generates a trace with timing, name, success/failure). Passive inbound events (e.g., bluesky posts that arrive but aren't acted on) do not generate traces, so they don't trigger reviews.

Sleep tasks are unaffected. `review-predictions` is already suppressed during sleep via `suppressDuringSleep`. The circadian sleep tasks (`sleep-compaction`, `sleep-prediction-review`, `sleep-pattern-analysis`) continue on their fixed offsets.

### Unified Agent Context

The separate `blueskyAgent` instance is eliminated. A single agent with a single conversation handles all input: REPL, scheduler events, and DataSource events (currently Bluesky, extensible to future sources).

A lightweight DataSource registry replaces the hand-wired per-source setup in `src/index.ts`. The registry:

1. Accepts enabled DataSource instances at startup
2. Wires each source's `onMessage` handler to a shared event queue
3. Wraps handlers with the activity interceptor (if activity system is enabled)
4. Provides a unified `shutdown()` that disconnects all sources

The shared event queue feeds into `processEventQueue()` → `agent.processEvent()`, which already handles source-tagged events generically. Scheduler events continue through their own queue (scheduler is internal, not a DataSource).

Per-source instructions in `formatExternalEvent` (currently a hardcoded `if (event.source === 'bluesky')` block) become a source-keyed lookup, so each DataSource can provide instructions that get injected when its events are formatted.

### Contracts

```typescript
type DataSourceRegistration = {
  readonly source: DataSource;
  readonly instructions?: string;
  readonly highPriorityFilter?: (message: IncomingMessage) => boolean;
};

type DataSourceRegistry = {
  readonly sources: ReadonlyArray<DataSource>;
  shutdown(): Promise<void>;
};

function createDataSourceRegistry(
  registrations: ReadonlyArray<DataSourceRegistration>,
  agent: Agent,
  activityManager?: ActivityManager,
): DataSourceRegistry;
```

The `highPriorityFilter` replaces the bluesky-specific DID matching in the interceptor with a generic predicate that any source can provide.

## Existing Patterns

This design follows established patterns from codebase investigation:

- **Factory functions over classes**: `createDataSourceRegistry()` returns an interface, matching `createAgent()`, `createActivityManager()`, `createBlueskyInterceptor()`, etc.
- **Pattern annotations**: New files will use `// pattern: Imperative Shell` (registry wiring) or `// pattern: Functional Core` (types).
- **Port/adapter boundaries**: `DataSource` is already a port interface in `src/extensions/data-source.ts`. The registry is an adapter that wires ports to the agent.
- **Activity interceptor wrapping**: The existing `createBlueskyInterceptor` pattern (wrap handler transparently, fall through on error) is generalised rather than replaced.
- **Event formatting**: `formatExternalEvent` in `src/agent/agent.ts` already handles generic metadata extraction with source-specific instruction blocks. Extending this to a lookup is consistent with the existing approach.
- **Composition root wiring**: All integration happens in `src/index.ts`, matching the existing pattern where no domain module imports another directly.

The `createBlueskyInterceptor` in `src/activity/bluesky-interceptor.ts` already uses `IncomingMessageLike` (structurally identical to `IncomingMessage`), so generalising it to accept any source's messages requires minimal change — primarily renaming and accepting a filter predicate instead of a DID list.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Dynamic Reflexion Gate

**Goal:** Stop the hourly `review-predictions` from firing when there's been no agent-initiated activity.

**Components:**
- Handler modification in `src/index.ts` — add trace count check before `buildReviewEvent()` call
- Trace query using existing `traceRecorder.queryTraces()` with `since` parameter from `last_run_at`

**Dependencies:** None (first phase, isolated change)

**Done when:** Hourly review skips with a log message when no agent-initiated traces exist since last review. Review fires normally when traces exist. Sleep tasks remain unaffected.

**Covers:** `efficient-agent-loop.AC1.1`, `efficient-agent-loop.AC1.2`, `efficient-agent-loop.AC1.3`
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Generalise Activity Interceptor

**Goal:** Make the bluesky-specific activity interceptor source-agnostic so any DataSource can use it.

**Components:**
- Generalised interceptor in `src/activity/` — rename/refactor `createBlueskyInterceptor` to accept a generic `highPriorityFilter` predicate instead of a DID list
- Updated types in `src/activity/types.ts` if needed
- Bluesky-specific DID matching becomes the filter predicate passed by the caller

**Dependencies:** None (can be done independently of Phase 1)

**Done when:** Existing bluesky interceptor behaviour is preserved via the new generic interceptor with a DID-based filter predicate. Activity interceptor accepts any `IncomingMessage`-shaped handler.

**Covers:** `efficient-agent-loop.AC3.1`, `efficient-agent-loop.AC3.2`
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: DataSource Registry

**Goal:** Extract per-source wiring into a reusable registration pattern.

**Components:**
- Registry types in `src/extensions/data-source.ts` — `DataSourceRegistration`, `DataSourceRegistry`
- Registry factory `createDataSourceRegistry()` in `src/extensions/data-source-registry.ts` — handles `onMessage` wiring, shared event queue, activity interceptor wrapping, unified shutdown
- Per-source instruction lookup for `formatExternalEvent` in `src/agent/agent.ts`

**Dependencies:** Phase 2 (generalised interceptor)

**Done when:** DataSource registration, event routing, and shutdown lifecycle are handled by the registry. Per-source instructions are injected via lookup rather than hardcoded conditionals.

**Covers:** `efficient-agent-loop.AC2.3`, `efficient-agent-loop.AC2.4`, `efficient-agent-loop.AC2.5`
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Consolidate to Single Agent

**Goal:** Eliminate the bluesky agent instance and route all events through the main agent.

**Components:**
- Remove `blueskyAgent` construction in `src/index.ts`
- Wire BlueskyDataSource through the new registry, routing events to the single agent
- Remove deterministic `bluesky-${did}` conversation ID
- Update composition root to use registry for all DataSource lifecycle

**Dependencies:** Phase 3 (registry exists)

**Done when:** Single agent instance handles REPL input, scheduler events, and bluesky firehose events. Bluesky posting/receiving works as before. No second agent instance exists.

**Covers:** `efficient-agent-loop.AC2.1`, `efficient-agent-loop.AC2.2`, `efficient-agent-loop.AC4.1`, `efficient-agent-loop.AC4.2`, `efficient-agent-loop.AC4.3`
<!-- END_PHASE_4 -->

## Additional Considerations

**Context pressure:** A single conversation accumulates more messages (bluesky events + REPL + scheduler). The existing compaction system handles this, but token spend per turn should be monitored after the change to ensure compaction triggers appropriately.

**Event ordering:** With one shared queue for all DataSource events, a flood from one source could delay others. The bounded queue (capacity 50, drop-oldest) mitigates this. Per-source caps are not built now — YAGNI until a second source exists and demonstrates the problem.

**Future sources:** Adding a new DataSource requires implementing the `DataSource` interface and registering it with `createDataSourceRegistry()`. No changes to the agent, event processing, or activity system are needed.
