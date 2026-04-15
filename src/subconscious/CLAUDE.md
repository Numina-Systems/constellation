# Subconscious

Last verified: 2026-04-14

## Purpose
Autonomous curiosity system that gives the agent an inner life of interests, curiosity threads, and self-directed exploration. Runs on a separate conversation with periodic impulse events that prompt reflection, idea generation, and tool-assisted exploration. Engagement scores decay over time to surface genuinely sustained interests. An introspection loop periodically reviews recent conversation and observations, formalizing worthy ones into tracked interests while maintaining an unformalised digest.

## Contracts
- **Exposes**: `InterestRegistry` port interface, `createInterestRegistry(db)`, `buildImpulseEvent(context)`, `buildImpulseCron(intervalMinutes)`, `buildMorningAgendaEvent(context)`, `buildWrapUpEvent(context)`, `createImpulseAssembler(deps)`, `createSubconsciousContextProvider(registry, owner)`, `buildIntrospectionEvent(context)`, `buildIntrospectionCron(impulseInterval, offset)`, `createIntrospectionAssembler(deps)`, `createIntrospectionContextProvider(memoryStore, owner)`, domain types (`Interest`, `CuriosityThread`, `ExplorationLogEntry`, `InterestRegistryConfig`, `ImpulseContext`, `ImpulseAssembler`, `IntrospectionContext`, `IntrospectionAssembler`)
- **Guarantees**:
  - `InterestRegistry` CRUD operations are owner-scoped (multi-agent safe)
  - `applyEngagementDecay` uses exponential half-life decay on all active interests
  - `enforceActiveInterestCap` transitions lowest-scoring active interests to dormant when cap exceeded
  - `bumpEngagement` atomically increments score and updates `last_engaged_at`
  - `findDuplicateCuriosityThread` prevents duplicate questions per interest
  - Impulse builders (`buildImpulseEvent`, `buildMorningAgendaEvent`, `buildWrapUpEvent`) are pure functions returning `ExternalEvent`
  - Introspection builders (`buildIntrospectionEvent`, `buildIntrospectionCron`) are pure functions; assembler gathers messages/interests/digest context
  - Introspection context provider caches `introspection-digest` memory block with 2-minute TTL, surfaces as `[Unformalised Observations]`
  - Subconscious context provider caches results with 2-minute TTL, returns `undefined` when no activity exists
- **Expects**: PostgreSQL with migration `009_subconscious_schema.sql` applied. `PersistenceProvider` injected for registry. `TraceStore` and `MemoryManager` injected for impulse assembler. `MemoryStore` injected for introspection assembler and context provider.

## Dependencies
- **Uses**: `src/persistence/` (PersistenceProvider for SQL), `src/reflexion/` (TraceStore for impulse context), `src/memory/` (MemoryManager for recent memories in impulse context, MemoryStore for introspection digest), `src/scheduled-context.ts` (formatTraceSummary for impulse prompts), `src/agent/types.ts` (ExternalEvent, ContextProvider)
- **Used by**: `src/tool/builtin/subconscious.ts` (tools consume InterestRegistry), `src/index.ts` (composition root wires registry, assembler, scheduler, context provider, and separate agent instance)
- **Boundary**: Domain types and impulse builders are Functional Core. Registry adapter, impulse assembler, and context provider are Imperative Shell.

## Key Decisions
- Separate conversation: Subconscious runs on its own conversation ID to isolate inner exploration from user-facing dialogue
- Engagement decay with half-life: Interests naturally fade unless actively engaged, preventing unbounded interest accumulation
- Three impulse types: Regular impulses (periodic exploration), morning agenda (daily planning), wrap-up (daily reflection) -- morning/wrap-up tied to activity wake/sleep transitions
- Introspection loop: Periodic review of recent subconscious conversation, formalizes noteworthy observations into interests/curiosity threads, maintains rolling digest of unformalised thoughts via `introspection-digest` memory label
- Introspection scheduling: Offset from impulse cron by configurable minutes (`introspection_offset_minutes`) to avoid collision; lookback window (`introspection_lookback_hours`) controls how far back messages are fetched
- Owner-scoped everything: All queries filter by owner, enabling future multi-agent deployments

## Invariants
- Active interest count never exceeds `max_active_interests` after cap enforcement
- Engagement scores are non-negative (clamped at 0 after decay)
- Curiosity thread questions are unique per interest (duplicates resume existing thread)
- All registry operations are owner-isolated

## Key Files
- `types.ts` -- Domain types and `InterestRegistry` port interface (Functional Core)
- `persistence.ts` -- PostgreSQL adapter implementing `InterestRegistry` (Imperative Shell)
- `impulse.ts` -- Pure impulse event builders: regular, morning agenda, wrap-up (Functional Core)
- `impulse-assembler.ts` -- Gathers context from registry/traces/memory, delegates to impulse builders (Imperative Shell)
- `context.ts` -- Cached context provider injecting `[Inner Life]` into agent system prompt (Imperative Shell)
- `introspection.ts` -- Pure introspection event/cron builders and `IntrospectionContext` type (Functional Core)
- `introspection-assembler.ts` -- Gathers messages/interests/digest, delegates to `buildIntrospectionEvent` (Imperative Shell)
- `introspection-context.ts` -- Cached context provider injecting `[Unformalised Observations]` from introspection-digest (Imperative Shell)
- `index.ts` -- Barrel export
