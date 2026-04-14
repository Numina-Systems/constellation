# Introspection Loop Design

## Summary

The introspection loop adds a periodic self-review cycle to Constellation's subconscious system. On a configurable schedule (offset from the existing impulse cron), the subconscious agent is prompted to look back at its recent conversation history, decide which observations are worth formalising into tracked interests or curiosity threads, and write the remainder into a persistent digest block. That digest is then surfaced as an `[Unformalised Observations]` section in both agents' system prompts, giving the system ambient awareness of half-formed thoughts that haven't yet risen to the level of formal interests — and crucially, that awareness persists across daemon restarts.

The implementation follows the established patterns of the subconscious module closely: a pure functional event builder, an imperative assembler that gathers context from existing data sources, and a context provider with a background refresh cache. The design deliberately avoids new database migrations by reusing the existing memory block infrastructure and `PersistenceProvider` query interface. The one genuine divergence from prior art is that the introspection assembler queries raw conversation messages directly — something the impulse assembler never needed to do — because introspection specifically requires access to the agent's unprocessed observations.

## Definition of Done

1. A periodic introspection event fires on a cron offset from the existing impulse cron, prompting the subconscious agent to review its recent conversation, formalize worthy observations, and write a digest of unformalised ones to a memory block.
2. A context provider surfaces that digest memory block in the system prompt so the agent (both main and subconscious) has awareness of half-formed observations across session boundaries.
3. No schema migrations — uses existing memory block infrastructure and conversation queries.
4. Time-windowed review scope — introspection only looks back N hours, preventing path dependency.

## Acceptance Criteria

### introspection-loop.AC1: Introspection event fires periodically with correct context
- **introspection-loop.AC1.1 Success:** Introspection cron fires at configured offset from impulse interval
- **introspection-loop.AC1.2 Success:** Event contains `[Review]` section with recent subconscious conversation messages
- **introspection-loop.AC1.3 Success:** Event contains `[Current State]` section with active interests and last digest content
- **introspection-loop.AC1.4 Success:** Event contains `[Act]` section prompting formalization and digest update
- **introspection-loop.AC1.5 Failure:** Messages with `role = 'tool'` are excluded from review context
- **introspection-loop.AC1.6 Edge:** Empty conversation window (no messages in lookback period) produces event with empty review section, not an error

### introspection-loop.AC2: Context provider surfaces digest in system prompt
- **introspection-loop.AC2.1 Success:** `[Unformalised Observations]` section appears in system prompt when digest block exists
- **introspection-loop.AC2.2 Success:** Both main agent and subconscious agent receive the section
- **introspection-loop.AC2.3 Failure:** Context provider returns `undefined` when no digest block exists (first run)
- **introspection-loop.AC2.4 Edge:** Stale digest from previous daemon run is surfaced on restart (continuity preserved)

### introspection-loop.AC3: No schema migrations required
- **introspection-loop.AC3.1 Success:** Digest stored as `readwrite` working-tier memory block via existing `memory.write()`
- **introspection-loop.AC3.2 Success:** Conversation messages queried via existing `PersistenceProvider.query()` with no new tables or columns

### introspection-loop.AC4: Time-windowed review scope
- **introspection-loop.AC4.1 Success:** Only messages within configured `introspection_lookback_hours` are included in review
- **introspection-loop.AC4.2 Success:** Config validates `introspection_lookback_hours` (min 1, max 72) and `introspection_offset_minutes` (min 1, max 30)
- **introspection-loop.AC4.3 Edge:** Introspection suppressed during sleep hours when activity module is enabled

## Glossary

- **Subconscious agent**: A secondary agent instance in Constellation that runs independently of the main conversational agent, handling background cognitive work such as interest tracking and curiosity exploration.
- **Impulse**: A scheduled event that prompts the subconscious agent to act. The introspection event fires on a cron offset from this existing impulse interval.
- **ExternalEvent**: A typed event structure used to inject external stimuli (scheduled tasks, data source events, etc.) into an agent's processing queue, distinct from user messages.
- **Context provider**: A factory-produced function (`() => string | undefined`) that contributes a section to an agent's system prompt. Returns `undefined` to suppress the section entirely.
- **Memory block**: A named, persistent key-value entry in the `memory_blocks` table. `readwrite` blocks can be overwritten directly without a mutation approval workflow.
- **Working tier**: The intermediate memory tier for active, transient state — contrasted with core (permanent) and archival (long-term compressed) tiers.
- **InterestRegistry**: The subconscious module's store for tracked topics the agent has marked as worth following. Interests are the formalised output of observations.
- **Curiosity thread**: A structured record of an active line of inquiry — more developed than a raw observation, less permanent than a core memory.
- **Functional Core / Imperative Shell**: An architectural pattern separating pure data-transformation logic (no side effects, easily testable) from the layer that performs I/O and coordinates dependencies.
- **Compaction**: The process by which older conversation messages are summarised, archived, and deleted to keep the agent's context window manageable. Relevant here because the introspection lookback window needs to stay within the compaction horizon.
- **Zod**: A TypeScript-first schema validation library used throughout Constellation to validate and parse config values at runtime.
- **TTL (Time-to-Live)**: The duration a cached value is considered fresh before being refreshed. The context provider uses a 2-minute TTL.

## Architecture

The introspection loop adds a periodic self-review cycle to the subconscious system. A new cron event (`subconscious:introspection`) fires offset from the existing impulse cron, prompting the subconscious agent to review its recent conversation history, formalize worthy observations into tracked interests and curiosity threads, and write a digest of remaining unformalised observations to a working-tier memory block. A new context provider reads that memory block and injects it as `[Unformalised Observations]` into both agents' system prompts, giving them ambient awareness of half-formed thoughts across session boundaries.

The design adds two new components to `src/subconscious/` and modifies two existing files. No new database migrations are required — the digest uses the existing memory block infrastructure (`memory_blocks` table with `readwrite` permission), and conversation messages are queried via the existing `PersistenceProvider`.

**Data flow:**

1. Introspection cron fires (offset from impulse interval)
2. Introspection assembler gathers context: recent subconscious conversation messages (time-windowed), active interests, current digest block
3. Builds an `ExternalEvent` with source `subconscious:introspection`
4. Event dispatched to subconscious agent via existing event queue
5. Agent reviews observations, formalizes some, writes updated digest to `introspection-digest` memory block via `memory_write`
6. Context provider reads `introspection-digest` block, injects `[Unformalised Observations]` into system prompt on subsequent turns

## Existing Patterns

This design follows established subconscious module patterns:

**Event assembly pattern** from `src/subconscious/impulse.ts` and `src/subconscious/impulse-assembler.ts`:
- Pure event builder function (functional core) takes a context object, returns `ExternalEvent`
- Imperative assembler gathers context from multiple data sources, delegates to pure builder
- Event source string follows `subconscious:<type>` convention
- Source instructions registered in `subconsciousSourceInstructions` map in `src/index.ts`

**Context provider pattern** from `src/subconscious/context.ts`:
- Factory function `create*ContextProvider()` returns `ContextProvider` (synchronous `() => string | undefined`)
- Background async refresh with 2-minute cache TTL
- Returns `undefined` when no data exists (section not injected)
- Registered in `contextProviders` array at agent creation time in `src/index.ts`

**Cron scheduling pattern** from `src/index.ts`:
- System-owned scheduled tasks created via `scheduler.createTask()` with cron expression
- Event handler builds event from assembler, pushes to event queue
- Activity-gated (only fires during wake hours when activity module is enabled)

**Memory block upsert** from `src/memory/manager.ts`:
- `memory.write(label, content, tier)` upserts by `(owner, label)` pair
- `readwrite` permission allows direct overwrites without mutation approval
- Working tier used for active transient state

**Divergence:** The introspection assembler queries raw conversation messages from the `messages` table via `PersistenceProvider.query()`. This is a new data source for the subconscious module — the existing impulse assembler uses `InterestRegistry`, `TraceStore`, and `MemoryManager` but never queries messages directly. This is justified because introspection specifically needs to review the agent's raw conversational observations, which aren't captured in any other data source.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Introspection Event Builder

**Goal:** Pure function that builds an introspection event from assembled context

**Components:**
- `buildIntrospectionEvent()` in `src/subconscious/introspection.ts` — pure event builder (functional core) that takes an `IntrospectionContext` and returns `ExternalEvent` with `[Review]`, `[Current State]`, and `[Act]` sections
- `buildIntrospectionCron()` in `src/subconscious/introspection.ts` — pure function that computes offset cron expression from impulse interval and offset minutes
- `IntrospectionContext` type — conversation messages, active interests, current digest content, timestamp

**Dependencies:** None (pure functions, no external deps)

**Covers:** introspection-loop.AC1.1, introspection-loop.AC1.2, introspection-loop.AC1.3, introspection-loop.AC1.4, introspection-loop.AC1.5, introspection-loop.AC4.1

**Done when:** Event builder produces correctly structured events from test data, cron builder generates valid offset expressions, messages with `role = 'tool'` are excluded from review context
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Introspection Assembler

**Goal:** Imperative shell that gathers context and delegates to the event builder

**Components:**
- `IntrospectionAssembler` type and `createIntrospectionAssembler()` in `src/subconscious/introspection-assembler.ts` — queries persistence for recent subconscious messages (time-windowed, filtered by role), lists active interests from registry, reads current digest block from memory manager
- Config additions to `SubconsciousConfigSchema` in `src/config/schema.ts` — `introspection_offset_minutes` (number, min 1, max 30, default 3) and `introspection_lookback_hours` (number, min 1, max 72, default 24)

**Dependencies:** Phase 1 (event builder)

**Covers:** introspection-loop.AC1.3, introspection-loop.AC1.6, introspection-loop.AC4.2

**Done when:** Assembler queries correct data sources with time window, passes context to event builder, config validates with Zod
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Introspection Context Provider

**Goal:** Context provider that surfaces the digest memory block in agent system prompts

**Components:**
- `createIntrospectionContextProvider()` in `src/subconscious/introspection-context.ts` — reads `introspection-digest` memory block by label, formats as `[Unformalised Observations]` section, caches with 2-minute TTL
- Export additions to `src/subconscious/index.ts`

**Dependencies:** Phase 1 (types)

**Covers:** introspection-loop.AC2.1, introspection-loop.AC2.2, introspection-loop.AC2.3, introspection-loop.AC2.4, introspection-loop.AC3.1, introspection-loop.AC3.2

**Done when:** Context provider returns formatted section when digest exists, returns `undefined` when no digest exists, caches correctly
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Composition & Wiring

**Goal:** Wire introspection into the daemon lifecycle

**Components:**
- Introspection assembler creation in `src/index.ts` — alongside impulse assembler, with deps: persistence, interestRegistry, memory, owner, subconsciousConversationId
- Introspection cron registration in `src/index.ts` — system-owned scheduled task with offset cron expression
- Source instructions for `subconscious:introspection` in `subconsciousSourceInstructions` map
- Context provider registration in `contextProviders` arrays for both main and subconscious agents
- Event handler that builds introspection event and pushes to subconscious event queue

**Dependencies:** Phases 1-3

**Covers:** introspection-loop.AC1.1, introspection-loop.AC2.1, introspection-loop.AC3.1, introspection-loop.AC3.2, introspection-loop.AC4.3

**Done when:** Introspection fires on configured schedule, events reach subconscious agent, context provider injects into both agents' system prompts, build passes
<!-- END_PHASE_4 -->

## Additional Considerations

**Compaction interaction:** The subconscious conversation undergoes independent compaction. Old messages get summarized, archived, and deleted. The introspection lookback window should be shorter than the typical compaction horizon to avoid querying messages that may have been deleted. The default 24-hour window is conservative — compaction typically retains more recent messages.

**First-run behaviour:** On first startup before any introspection has fired, the digest block doesn't exist. The context provider returns `undefined`, so no `[Unformalised Observations]` section appears. This is correct — there's nothing to surface yet. The first introspection event will create the block.

**Digest staleness:** If the daemon is stopped and restarted, the digest block persists in the database with its last content. This is intentional — it provides continuity. The next introspection cycle will update it with fresh observations.
