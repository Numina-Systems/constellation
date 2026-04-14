# Subconscious Design

## Summary

Constellation currently runs a single agent that responds to human input and external events. This design adds a second agent instance — the subconscious — that runs autonomously in the background during the agent's configured wake hours. Every 15–30 minutes, an impulse fires that prompts the subconscious to reflect on recent activity, pick something to explore, and act on it using the full toolset (web search, code execution, memory writes, scheduling). The subconscious maintains its own persistent conversation that accumulates and compacts independently from the main conversation.

The two agents share the same dependency graph: same memory system, same tools, same skill registry, same trace recorder. Cross-pollination is passive — both agents read and write shared memory, so topics from human conversations surface naturally to the subconscious, and subconscious discoveries are retrievable by the main agent via memory search. A context provider bridges the gap by injecting a compact `[Inner Life]` summary into the main agent's system prompt each turn, giving it ambient awareness of what the subconscious has been up to without requiring explicit lookup.

## Definition of Done

1. **A subconscious subsystem** that generates internal events every 15-30 minutes during wake hours, prompting the agent to autonomously explore, learn, and act
2. **A persistent inner monologue** — a dedicated long-running conversation where the agent's autonomous activity accumulates and compacts over time
3. **A structured interest/goal model** (new DB tables) for tracking what the agent cares about, with rich narrative context stored in the existing memory system
4. **Full bidirectional integration** — human conversations seed curiosity threads, and subconscious discoveries are accessible during human interactions
5. **Emergent interests** — the agent develops its own preferences and curiosities through exploration, not through prescribed topics

## Acceptance Criteria

### subconscious.AC1: Subconscious fires autonomously during wake hours
- **subconscious.AC1.1 Success:** Impulse events fire at the configured cron interval during wake hours
- **subconscious.AC1.2 Success:** Each impulse dispatches a reflect→generate→act prompt to the subconscious agent
- **subconscious.AC1.3 Success:** Impulse prompt includes current interests, recent traces, and recent memories
- **subconscious.AC1.4 Failure:** Impulses are suppressed during sleep hours (activity-gated)

### subconscious.AC2: Persistent inner monologue conversation
- **subconscious.AC2.1 Success:** Subconscious agent maintains a dedicated conversation with stable ID across restarts
- **subconscious.AC2.2 Success:** Inner conversation compacts independently from the main conversation
- **subconscious.AC2.3 Edge:** On first startup with no prior inner conversation, agent starts fresh with empty history

### subconscious.AC3: Interest registry tracks what the agent cares about
- **subconscious.AC3.1 Success:** Interests can be created with name, description, source, and engagement score
- **subconscious.AC3.2 Success:** Curiosity threads can be created, explored, resolved, or parked within an interest
- **subconscious.AC3.3 Success:** Engagement scores decay over time with configurable half-life
- **subconscious.AC3.4 Success:** Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached
- **subconscious.AC3.5 Failure:** Duplicate curiosity threads (same question within same interest) are detected and the existing thread is resumed instead

### subconscious.AC4: Both agents can interact with interests and see each other's activity
- **subconscious.AC4.1 Success:** manage_interest tool creates, updates, and transitions interests
- **subconscious.AC4.2 Success:** manage_curiosity tool creates, explores, resolves, and parks curiosity threads
- **subconscious.AC4.3 Success:** list_interests tool returns interests filtered by status, source, or minimum engagement score
- **subconscious.AC4.4 Success:** list_curiosities tool returns curiosity threads for an interest, filtered by status
- **subconscious.AC4.5 Success:** Main agent's system prompt includes [Inner Life] section with active interests and recent explorations
- **subconscious.AC4.6 Edge:** Context provider returns undefined when no subconscious activity exists (no [Inner Life] section injected)
- **subconscious.AC4.7 Success:** A topic from human conversation appears as a seeded interest after the next impulse cycle
- **subconscious.AC4.8 Success:** Main agent can reference subconscious discoveries naturally during human conversation

### subconscious.AC5: Interests emerge without prescribed topics
- **subconscious.AC5.1 Success:** Wake transition triggers a morning agenda impulse
- **subconscious.AC5.2 Success:** Sleep transition triggers a wrap-up reflection impulse
- **subconscious.AC5.3 Success:** Exploration log records each impulse cycle's actions and tools used
- **subconscious.AC5.4 Success:** Starting from zero interests, the agent creates its first interests autonomously on first impulse
- **subconscious.AC5.5 Failure:** No interests are hardcoded or prescribed at startup — the registry starts empty

## Glossary

- **Impulse**: A scheduled event that fires every 15–30 minutes during wake hours, triggering one cycle of subconscious activity (reflect → generate → act).
- **Inner monologue**: The subconscious agent's dedicated persistent conversation, identified by a stable `innerConversationId` configured in `config.toml`.
- **Interest registry**: PostgreSQL-backed tables storing what the agent cares about (`interests`, `curiosity_threads`, `exploration_log`), with structured metadata queryable by status and engagement score.
- **Curiosity thread**: A specific question or line of inquiry within an interest. Transitions through states: `open` → `exploring` → `resolved` or `parked`.
- **Engagement score**: A numeric value on each interest reflecting how actively it's been explored. Decays over time via configurable half-life; used to prioritise and evict interests when the cap is hit.
- **Dormant**: An interest state indicating it is no longer actively pursued — either because it hasn't been revisited (decay) or because the active cap was hit. Can become active again.
- **Context provider**: A function injected into an agent that returns a string (or `undefined`) appended to the system prompt each turn. Used to surface dynamic state without hardcoding it. Cached with a TTL.
- **`[Inner Life]` section**: The formatted block the subconscious context provider injects into the main agent's system prompt, summarising active interests and recent explorations.
- **Activity-gated**: Conditional on the agent's circadian state. Impulses are suppressed during sleep hours and resume on wake.
- **Compaction**: The process of summarising and archiving older conversation turns to keep context windows manageable. Each agent compacts its own conversation independently.
- **Exploration log**: A record of what happened during each impulse cycle — which tools were used, what was discovered. Creates accountability against hallucination loops.
- **Port/adapter boundary**: An architectural pattern used throughout the codebase: a domain interface (the "port") is defined separately from its implementation (the "adapter"), allowing the implementation to be swapped without affecting callers.
- **Constrained novelty search**: The approach used for goal generation, inspired by VOYAGER. Instead of computing novelty metrics, the LLM's semantic understanding of "interestingness" drives exploration, grounded by actual state from the interest registry and memory.

## Architecture

Two agent instances sharing the same dependency graph. The main agent handles human interaction and external events (Bluesky, REPL). The subconscious agent runs autonomously during wake hours on its own persistent conversation, exploring interests and building knowledge.

Cross-pollination happens through the shared memory system. Both agents read and write the same core/working/archival memory. A subconscious context provider injected into the main agent surfaces recent inner activity per-turn, so the main agent can reference discoveries naturally during human conversation.

### Components

**Subconscious agent** — a second `createAgent()` instance with a stable `innerConversationId` (configured, not random). Shares: memory, persistence, tools, scheduler, embedding, skills, trace recorder. Has its own: conversation history, compaction cycle, context providers.

**Impulse scheduler** — a system-owned cron task that fires every 15-30 minutes during wake hours. Activity-gated: suppressed during sleep, resumes on wake. Dispatches impulse events to the subconscious agent via `processEvent()`.

**Impulse handler** — builds a structured prompt from current state (active interests, recent reflections, recent main-conversation topics from memory, operation traces) and sends it to the subconscious agent. The agent acts freely with the full toolset.

**Interest registry** — new PostgreSQL tables tracking what the agent cares about. Structured metadata in DB tables (queryable, sortable), rich narrative in shared memory (depth, connections).

**Subconscious context provider** — injected into the main agent. Queries active interests, recent exploration log, and open curiosity threads. Formats a compact `[Inner Life]` summary injected per-turn with TTL caching.

**Interest tools** — `manage_interest`, `manage_curiosity`, `list_interests`, `list_curiosities`. Available to both agents. The subconscious uses them to manage its inner life; the main agent uses them to answer "what have you been thinking about?" or seed interests from conversation.

### Data flow

```
Cron fires (every 15-30 min, wake hours only)
  → Activity dispatch (suppressed during sleep)
  → Impulse handler builds prompt from interest registry + memory + traces
  → subconsciousAgent.processEvent(impulse)
  → Reflect → Generate interest → Act (full toolset)
  → Write to interest registry + shared memory
  → Main agent picks up via context provider + memory search
```

### The impulse cycle: reflect → generate → act

Each impulse prompt is assembled in three stages.

**Reflect.** Query recent operation traces (from both agents via shared `TraceRecorder`), recent exploration log entries, and recent memories written by both agents. Present to the subconscious: "Here's what's happened recently. What patterns or insights do you notice?" The agent writes reflections to shared memory.

**Generate.** Query active interests and their engagement scores, open curiosity threads, and any memories seeded from recent human conversations. Present: "Given what you know and what you've been exploring, what's interesting right now?" The agent picks an existing curiosity thread, creates a new one, or spawns a new interest entirely. This is constrained novelty search — the LLM's semantic sense of interestingness drives it, grounded by actual state from the registry and memory.

**Act.** The agent pursues its chosen curiosity with the full toolset: web search, code execution, Bluesky interaction, memory writes, scheduling follow-ups. The exploration log records what happened. Interest engagement scores update based on activity.

### Cross-pollination

```
Human conversation → shared memory → subconscious retrieves on next impulse
Subconscious exploration → shared memory → main agent retrieves via search
Subconscious activity → context provider → main agent sees [Inner Life] per-turn
```

The context provider gives the main agent awareness without requiring it to search. Memory search gives depth when a topic comes up naturally in conversation.

### Interest lifecycle

Interests transition through states: `active` → `dormant` → optionally back to `active`, or `active` → `abandoned` (terminal).

Engagement scores decay over time with a configurable half-life (default 7 days). An interest the agent hasn't revisited naturally becomes dormant. `max_active_interests` (default 10) caps simultaneous active interests — when the cap is hit, the lowest-scoring interest transitions to dormant.

Curiosity threads within an interest track specific questions: `open` → `exploring` → `resolved` or `parked`. Resolved threads capture what was learned.

### Integration with existing systems

**Activity system.** Impulses are activity-gated. Sleep transition can trigger a "wrap up" impulse for end-of-day reflection. Wake transition can trigger a "morning agenda" impulse to review interests and pick priorities.

**Sleep tasks.** Existing sleep tasks (compaction, prediction review, pattern analysis) continue on the main agent. The subconscious agent gets its own compaction on its inner monologue conversation.

**Scheduler.** The subconscious can use `schedule_task` to schedule its own follow-ups ("check back on this in 3 hours"). These route through the existing agent-owned scheduler.

**Skills.** Same skill registry. Skills relevant to autonomous exploration surface naturally via embedding similarity.

### Grounding against hallucination loops

The reflect stage forces the agent to process what actually happened, not just plan. The exploration log creates accountability — if the agent keeps planning without acting, the log shows it. Engagement score decay means abandoned threads naturally fall away. If the agent generates a curiosity thread identical to an existing one, it should resume that thread rather than creating a duplicate.

## Existing patterns

This design follows established constellation patterns:

**Port/adapter boundaries.** The interest registry follows the same pattern as `PredictionStore` in `src/reflexion/` — a port interface with a PostgreSQL adapter. Factory function returns the interface.

**Context providers.** The subconscious context provider follows the same pattern as `createActivityContextProvider()` and `createPredictionContextProvider()` — a function returning `() => string | undefined` with TTL caching.

**System-owned scheduler tasks.** The impulse scheduler follows the same pattern as sleep transitions and prediction review — system-owned cron tasks registered in the composition root with activity-aware dispatch.

**Sleep task events.** The impulse event builder follows the same pattern as `buildCompactionEvent()`, `buildPredictionReviewEvent()`, and `buildPatternAnalysisEvent()` in `src/activity/sleep-events.ts` — pure functions returning structured events.

**Tool registration.** Interest management tools follow the same pattern as scheduling tools in `src/tool/builtin/scheduling.ts` — factory functions taking dependencies, returning tool definitions.

**Dual-owner scheduler.** The composition root already runs two scheduler instances (agent-owned + system-owned). The subconscious impulse task is system-owned; any follow-ups the subconscious schedules for itself are agent-owned.

**New pattern: dual agent instances.** This is the one divergence. The composition root currently creates a single agent. This design adds a second agent instance sharing the same dependency graph. The coordinator logic lives in the composition root — no new abstraction layer needed.

## Implementation phases

<!-- START_PHASE_1 -->
### Phase 1: Interest registry

**Goal:** PostgreSQL-backed interest and curiosity tracking with port/adapter boundary.

**Components:**
- Interest registry types in `src/subconscious/types.ts` — `Interest`, `CuriosityThread`, `ExplorationLogEntry`, `InterestRegistry` port interface
- PostgreSQL adapter in `src/subconscious/persistence.ts` — implements `InterestRegistry`
- Migration in `src/persistence/migrations/` — `interests`, `curiosity_threads`, `exploration_log` tables
- Factory function `createInterestRegistry(persistence)` in `src/subconscious/`

**Dependencies:** None (first phase)

**Done when:** Interest registry can create, query, update, and transition interests and curiosity threads. Engagement score decay works. Tests verify CRUD operations, state transitions, and decay logic. Covers `subconscious.AC3.1` through `subconscious.AC3.5`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Interest management tools

**Goal:** Tools for both agents to manage and query the interest registry.

**Components:**
- Tool definitions in `src/tool/builtin/subconscious.ts` — `manage_interest`, `manage_curiosity`, `list_interests`, `list_curiosities`
- Tool registration in tool registry

**Dependencies:** Phase 1 (interest registry)

**Done when:** Tools can create/update/transition interests and curiosity threads, query by status and filters. Tests verify tool input validation and registry interaction. Covers `subconscious.AC4.1` through `subconscious.AC4.4`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Subconscious agent instance

**Goal:** Second agent instance with its own persistent conversation, sharing deps with the main agent.

**Components:**
- Composition root changes in `src/index.ts` — create second `createAgent()` with stable `innerConversationId`, shared deps
- Configuration in config schema (`src/config/`) — `[subconscious]` section with `enabled`, `interval`, `inner_conversation_id`, `max_tool_rounds`, `engagement_half_life_days`, `max_active_interests`

**Dependencies:** Phase 2 (tools available for both agents)

**Done when:** Second agent instance starts, processes events on its own conversation, shares memory with the main agent. Config is validated via Zod schema. Tests verify agent creation, conversation isolation, and shared memory access. Covers `subconscious.AC2.1`, `subconscious.AC2.2`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Impulse handler and scheduler

**Goal:** System-owned cron task that fires during wake hours and dispatches impulse events to the subconscious agent.

**Components:**
- Impulse event builder in `src/subconscious/impulse.ts` — pure function building the reflect→generate→act prompt from interest registry + memory + traces
- Impulse scheduler registration in composition root — system-owned cron task with activity-aware dispatch
- Event routing in composition root — impulse events dispatched to subconscious agent via `processEvent()`

**Dependencies:** Phase 3 (subconscious agent exists)

**Done when:** Impulse fires on schedule during wake hours, is suppressed during sleep. The prompt includes current interests, recent traces, and recent memories. The subconscious agent processes the impulse and can use all tools. Tests verify scheduling, activity gating, and prompt assembly. Covers `subconscious.AC1.1` through `subconscious.AC1.4`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Subconscious context provider

**Goal:** Main agent sees recent subconscious activity per-turn via `[Inner Life]` summary.

**Components:**
- Context provider in `src/subconscious/context.ts` — `createSubconsciousContextProvider(interestRegistry)` returning `() => string | undefined` with TTL cache
- Registration in composition root — inject into main agent's `contextProviders`

**Dependencies:** Phase 4 (subconscious generates activity to summarize)

**Done when:** Main agent's system prompt includes `[Inner Life]` section with active interests, current explorations, and recent discoveries. Cached with TTL. Returns `undefined` when no subconscious activity exists. Tests verify formatting, caching, and empty-state handling. Covers `subconscious.AC4.5`, `subconscious.AC4.6`.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Bidirectional integration

**Goal:** Human conversations seed curiosity threads. Subconscious discoveries surface in human conversations.

**Components:**
- Seeding logic — no new code needed. Shared memory means the subconscious naturally discovers human conversation topics via memory retrieval during the reflect stage. The `source` field on interests distinguishes `emergent` from `seeded` from `external`.
- Wake/sleep transition impulses in `src/subconscious/impulse.ts` — "morning agenda" impulse on wake, "wrap up" impulse on sleep transition
- Exploration log recording in impulse handler — logs each impulse cycle's actions and tools used

**Dependencies:** Phase 5 (context provider bridges the gap)

**Done when:** A topic discussed in human conversation appears as a seeded interest after the next impulse. The main agent can reference subconscious discoveries in conversation. Wake/sleep transition impulses fire correctly. Exploration log records impulse activity. Tests verify seeding flow, transition impulses, and log recording. Covers `subconscious.AC4.7`, `subconscious.AC4.8`, `subconscious.AC5.1` through `subconscious.AC5.3`.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Emergent interest development

**Goal:** The agent develops its own interests from scratch without prescribed topics.

**Components:**
- Cold-start prompt variant in `src/subconscious/impulse.ts` — when interest registry is empty, the impulse prompt becomes: "You have no interests yet. What are you curious about?"
- Anti-sprawl enforcement in interest registry — `max_active_interests` cap with automatic dormancy for lowest-scoring interests
- Duplicate detection in curiosity thread creation — resume existing threads rather than creating duplicates

**Dependencies:** Phase 6 (full integration working)

**Done when:** Starting from zero interests, the agent creates its first interests autonomously. Active interest cap is enforced. Duplicate curiosity threads are detected and resumed. Tests verify cold start, cap enforcement, and deduplication. Covers `subconscious.AC5.4`, `subconscious.AC5.5`, `subconscious.AC3.4`, `subconscious.AC3.5`.
<!-- END_PHASE_7 -->

## Additional considerations

**Cost.** At every 20 minutes during a 16-hour wake cycle, that's ~48 impulses per day. Each impulse is a full agent turn with potential tool use. Cost depends on model choice for the subconscious agent — using a cheaper model (e.g., Haiku) for reflection and a capable model for action could reduce costs significantly. The `max_tool_rounds` config limits how much work each impulse does.

**Compaction.** The inner monologue conversation will accumulate rapidly at 48 turns/day. The existing compactor handles this — it'll summarize and archive older turns automatically. The archived summaries become part of the shared memory, so even compacted inner monologue content is retrievable.

**Conversation persistence across restarts.** The `innerConversationId` must be stable across daemon restarts. Configure it in `config.toml` rather than generating it. On restart, the subconscious agent loads its existing conversation history from the database.
