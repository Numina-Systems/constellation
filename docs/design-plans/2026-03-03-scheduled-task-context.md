# Scheduled Task Context Hydration Design

## Summary

Scheduled tasks in Constellation run as cold-start agent turns: the agent wakes up, reads a terse prompt ("review your predictions" or "run this task you scheduled"), and responds with no conversation history and no memory of what it just did. This produces a well-known failure mode — the agent confidently reports state that contradicts what it actually did in the last hour, because it simply has no visibility into recent activity.

This change enriches both scheduled event builders (`buildReviewEvent` and `buildAgentScheduledEvent`) so that before firing a scheduled task, the system queries the `TraceStore` for the agent's most recent operation traces (up to 20 entries within a 2-hour lookback window), formats them as a compact `[Recent Activity]` section, and embeds that section directly in the event content. The agent sees its recent tool calls — what ran, whether it succeeded, and a truncated output summary — as part of the task message itself, without needing to call any tool to retrieve it. Interactive REPL sessions and Bluesky event processing are unaffected; the enrichment applies exclusively to scheduled tasks.

## Definition of Done

1. Scheduled tasks receive recent operation traces in their event content
2. The agent no longer makes confident claims that contradict recent activity
3. Both system-scheduled and agent-scheduled tasks are enriched
4. No impact on interactive REPL session performance or token usage
5. Trace formatting is compact and bounded (fixed limit on traces and lookback window)

## Acceptance Criteria

### scheduled-task-context.AC1: Scheduled tasks include recent traces
- **AC1.1 Success:** Review event content contains [Recent Activity] section with formatted traces
- **AC1.2 Success:** Agent-scheduled event content contains [Recent Activity] section with formatted traces
- **AC1.3 Edge:** When no traces exist in lookback window, section shows "No recent activity recorded."
- **AC1.4 Edge:** Traces are bounded to max 20 entries regardless of activity volume
- **AC1.5 Edge:** Only traces within 2-hour lookback window are included

### scheduled-task-context.AC2: No impact on interactive sessions
- **AC2.1 Success:** Interactive REPL messages do not include trace sections
- **AC2.2 Success:** Bluesky event processing does not include trace sections

### scheduled-task-context.AC3: Trace formatting is compact and readable
- **AC3.1 Success:** Each trace is one line with timestamp, tool name, status, and truncated output
- **AC3.2 Success:** Output summaries are truncated to ~80 chars per line
- **AC3.3 Success:** Traces are ordered newest-first

## Glossary

- **ExternalEvent**: The domain type representing an inbound event the agent must process. Scheduled task prompts, Bluesky posts, and REPL messages all arrive as `ExternalEvent` values before being handed to `agent.processEvent()`.
- **TraceStore**: A query interface over the operation trace table. Extends `TraceRecorder` with a `queryTraces()` method that filters by owner, time window, and result limit. Lives in `src/reflexion/trace-recorder.ts`.
- **OperationTrace**: A record of a single tool invocation — tool name, input, truncated output summary, duration, success/failure flag, and timestamp. Written by the agent loop after every tool call and queried here for context hydration.
- **buildReviewEvent / buildAgentScheduledEvent**: Functions in `src/index.ts` (the composition root) that construct `ExternalEvent` values for, respectively, system-defined scheduled review tasks and tasks the agent itself scheduled via the `Scheduler` extension.
- **Functional Core / Imperative Shell**: The architectural pattern used throughout the codebase. Pure functions handle data transformation with no side effects; imperative shell code handles I/O, scheduling, and wiring. `formatTraceSummary()` is functional core; the event builders are imperative shell.
- **Context provider**: A Constellation-specific pattern (`ContextProvider` type in `src/agent/types.ts`) for injecting text into the agent's system prompt on every turn. This design explicitly avoids using a context provider — they fire on every turn, whereas trace context is only meaningful for scheduled tasks.
- **Reflexion**: The `src/reflexion/` module. Implements agent self-observation via prediction journaling, operation tracing, and introspection tools. This change consumes reflexion's trace data from outside the module.
- **Composition root**: `src/index.ts`. The single location where all modules are wired together and application-level concerns are handled.

## Architecture

Scheduled tasks currently fire through `buildReviewEvent()` and `buildAgentScheduledEvent()` in the composition root (`src/index.ts`). These functions construct an `ExternalEvent` with a text prompt that gets processed by `agent.processEvent()`. The agent receives this as a cold-start user message with no conversation history.

The fix enriches the event builders: before constructing the event, they query the `TraceStore` for the last 20 operation traces within a 2-hour lookback window. A pure formatting function converts these traces into a compact `[Recent Activity]` section embedded directly in the event content. The agent sees its recent operations as part of the message, not as something it must discover via tool calls.

Data flow:

```
Scheduler tick fires task
  → Handler calls async buildReviewEvent(task, traceStore, owner)
    → traceStore.queryTraces({ owner, lookbackSince: 2h ago, limit: 20 })
    → formatTraceSummary(traces) → compact one-line-per-trace string
    → Embed in event content as [Recent Activity] section
  → schedulerEventQueue.push(event)
  → agent.processEvent(event)
```

This approach:
- Enriches only scheduled task events (no overhead on interactive REPL turns)
- Uses the existing `TraceStore.queryTraces()` API (no new database queries)
- Keeps the event builder as the single point of context assembly for scheduled tasks

### Contracts

Event builder signatures change from synchronous to async:

```typescript
async function buildReviewEvent(
  task: { name: string; id: string; schedule: string; payload?: Record<string, unknown> },
  traceStore: TraceStore,
  owner: string,
): Promise<ExternalEvent>

async function buildAgentScheduledEvent(
  task: { name: string; id: string; schedule: string; payload?: Record<string, unknown> },
  traceStore: TraceStore,
  owner: string,
): Promise<ExternalEvent>
```

Trace formatting is a pure function:

```typescript
function formatTraceSummary(traces: ReadonlyArray<OperationTrace>): string
```

## Existing Patterns

Investigation found the existing `createPredictionContextProvider` in `src/reflexion/context-provider.ts` — a context provider that injects pending prediction count into the system prompt. This design deliberately does *not* follow that pattern because:

- Context providers inject into every turn (wasteful for trace data only needed during scheduled tasks)
- The event builder pattern already exists for scheduled task content assembly
- Enriching the event content is more explicit: the agent sees "here's what you've been doing" as part of the task message rather than as ambient system state

The `TraceStore.queryTraces()` API in `src/reflexion/trace-recorder.ts` is reused directly — same query interface used by the `self_introspect` tool.

The event builder functions in `src/index.ts` (lines 96-134 for `buildReviewEvent`, lines 144-168 for `buildAgentScheduledEvent`) are the modification targets. They currently construct events synchronously; the change makes them async.

<!-- START_PHASE_1 -->
## Implementation Phases

### Phase 1: Trace Formatting and Event Builder Enrichment

**Goal:** Enrich both event builders with recent operation traces so scheduled tasks receive recent activity context.

**Components:**
- `formatTraceSummary()` pure function in `src/index.ts` — converts `ReadonlyArray<OperationTrace>` to compact multi-line string (one line per trace: timestamp, tool name, success/fail, truncated output)
- `buildReviewEvent()` in `src/index.ts` — becomes async, accepts `TraceStore` and `owner`, queries last 20 traces within 2-hour window, embeds formatted summary in event content
- `buildAgentScheduledEvent()` in `src/index.ts` — same enrichment as above
- `systemScheduler.onDue` handler in `src/index.ts` — updated to await async event builder, passes `traceStore` and `owner`
- `agentScheduler.onDue` handler in `src/index.ts` — same update

**Dependencies:** None (single phase)

**Done when:**
- Event builders query traces and embed them in event content
- Both system and agent scheduler handlers pass `traceStore` and `owner` to builders
- `formatTraceSummary()` returns `"No recent activity recorded."` when traces are empty
- Trace output is bounded: max 20 traces, 2-hour lookback, ~80 char output truncation per line
- All existing tests pass
- New tests verify: trace formatting (with traces, empty traces), event content includes `[Recent Activity]` section
<!-- END_PHASE_1 -->

## Additional Considerations

**Token budget:** 20 traces at ~80 chars each plus labels ≈ 40-60 lines of context. Well within budget for a scheduled task turn that otherwise has minimal conversation history.

**Lookback window vs trace limit:** The 2-hour window catches activity since the last hourly scheduled run. The 20-trace limit caps worst case (if the agent was very active). Both constraints apply — whichever is more restrictive wins.
