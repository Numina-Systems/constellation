# Agent Scheduling Autonomy Design

## Summary

Constellation's agent loop already has a PostgreSQL-backed scheduler (`createPostgresScheduler`) and a Bluesky data source for receiving external messages — but the agent has no way to drive either of them itself. This design adds three built-in tools (`schedule_task`, `cancel_task`, `list_tasks`) that expose the scheduler to the agent, letting it autonomously create and manage its own recurring or one-shot tasks. Each task stores a self-instruction prompt that fires back into the agent loop as an `ExternalEvent` when the task comes due — so a task the agent schedules on Monday can wake it up on Friday with exactly the context it needs to do the work.

The design also extends the Bluesky integration so that a separate DID allowlist (`schedule_dids`) can send scheduling requests conversationally, without gaining the broader interaction access that `watched_dids` carries. System-managed jobs (like the existing prediction review cycle) are isolated via an `owner='system'` convention that the agent's tools cannot see or cancel. No new infrastructure or architectural patterns are introduced — every component slots into an established convention from the existing codebase.

## Definition of Done

1. **Three built-in tools** (`schedule_task`, `cancel_task`, `list_tasks`) that give the agent autonomy over its own scheduled work — recurring (cron, 10min minimum) and one-shot (ISO datetime)
2. **Prompt-based tasks** — each scheduled task carries a self-instruction prompt that fires as an ExternalEvent into the agent loop when due
3. **Bluesky scheduling channel** — users in a DID allowlist can request scheduling via Bluesky, with the agent using the same tools to fulfil the request
4. **System job isolation** — agent cannot modify system-managed jobs (e.g., `review-predictions`)
5. **Auditability** — all tasks persist in DB with cancelled flag; user can ask "what's on your schedule?" anytime
6. **Scheduling skill** — agent guidance on when/how to use scheduling, soft prompt length guidance, note about Deno cron availability for runtime code

## Acceptance Criteria

### agent-scheduling.AC1: schedule_task tool
- **agent-scheduling.AC1.1 Success:** Agent can schedule a recurring task with a valid cron expression (e.g., `0 */2 * * *`) and receives task ID and next run time
- **agent-scheduling.AC1.2 Success:** Agent can schedule a one-shot task with an ISO 8601 timestamp in the future
- **agent-scheduling.AC1.3 Failure:** Cron expression with interval < 10 minutes (e.g., `* * * * *`) is rejected with descriptive error
- **agent-scheduling.AC1.4 Failure:** ISO 8601 timestamp in the past is rejected with descriptive error
- **agent-scheduling.AC1.5 Failure:** Invalid schedule string (neither cron nor ISO 8601) is rejected
- **agent-scheduling.AC1.6 Success:** Task payload includes `{ type: 'agent-scheduled', prompt }` with the agent's self-instruction
- **agent-scheduling.AC1.7 Success:** Scheduled task is persisted with `owner` matching the agent's configured owner

### agent-scheduling.AC2: cancel_task tool
- **agent-scheduling.AC2.1 Success:** Agent can cancel a task by ID, setting `cancelled=TRUE`
- **agent-scheduling.AC2.2 Failure:** Cancelling a nonexistent task ID returns an error
- **agent-scheduling.AC2.3 Failure:** Agent cannot cancel a task owned by `'system'` (owner isolation)

### agent-scheduling.AC3: list_tasks tool
- **agent-scheduling.AC3.1 Success:** Returns active (non-cancelled) tasks by default with id, name, schedule, prompt, next_run_at, last_run_at
- **agent-scheduling.AC3.2 Success:** With `include_cancelled=true`, returns all tasks including cancelled ones
- **agent-scheduling.AC3.3 Success:** Output is human-readable (user can audit by asking "what's on your schedule?")
- **agent-scheduling.AC3.4 Success:** Only returns tasks owned by the agent — system tasks are invisible

### agent-scheduling.AC4: Prompt-based event firing
- **agent-scheduling.AC4.1 Success:** When an agent-scheduled task fires, an `ExternalEvent` with `source: 'self-scheduled'` is pushed into the agent loop
- **agent-scheduling.AC4.2 Success:** Event content is the stored prompt from the task payload
- **agent-scheduling.AC4.3 Success:** One-shot tasks auto-cancel after firing (existing scheduler behaviour, no new code)

### agent-scheduling.AC5: Bluesky scheduling channel
- **agent-scheduling.AC5.1 Success:** Events from DIDs in `schedule_dids` are accepted by `shouldAcceptEvent()` even if not in `watched_dids`
- **agent-scheduling.AC5.2 Success:** Events from DIDs in neither `schedule_dids` nor `watched_dids` are rejected
- **agent-scheduling.AC5.3 Success:** Context provider injects `schedule_dids` and `watched_dids` lists into agent system prompt
- **agent-scheduling.AC5.4 Success:** Agent differentiates DID authority: schedule-only DIDs get scheduling responses, watched DIDs get full interaction

### agent-scheduling.AC6: System job isolation & wiring
- **agent-scheduling.AC6.1 Success:** Review job operates under `owner='system'` and is invisible to agent scheduling tools
- **agent-scheduling.AC6.2 Success:** All scheduling tools registered in composition root, daemon starts successfully with both system and agent schedulers

### agent-scheduling.AC7: Scheduling skill
- **agent-scheduling.AC7.1 Success:** Skill file exists with valid YAML frontmatter and is loaded by the skill retrieval system
- **agent-scheduling.AC7.2 Success:** Skill includes guidance on when/how to schedule, cron patterns, one-shot ISO 8601, self-contained prompts, Deno cron note, DID authority, auditability

## Glossary

- **DID (Decentralised Identifier)**: A globally unique identifier used by the AT Protocol (the protocol underlying Bluesky). In this design, DIDs identify specific Bluesky users and serve as the basis for the scheduling allowlist.
- **ExternalEvent**: An event type the agent loop accepts from outside sources (e.g., Bluesky messages, scheduled tasks). Agent-scheduled tasks fire as `ExternalEvent` with `source: 'self-scheduled'`.
- **Croner**: A TypeScript cron library (`croner`) used to parse and evaluate cron expressions. Already a project dependency; used here for both cron and ISO 8601 timestamp parsing.
- **ISO 8601**: An international date/time format standard (e.g., `2026-03-15T14:00:00Z`). Used in this design for scheduling one-shot tasks at a specific future moment.
- **Cron expression**: A compact string format (e.g., `0 */2 * * *`) specifying a recurring schedule. Five or six space-separated fields encode minute, hour, day, month, and weekday patterns.
- **`shouldAcceptEvent()`**: A filter function on the Bluesky data source that gates which incoming posts are forwarded to the agent. Extended in Phase 4 to include `schedule_dids`.
- **ContextProvider**: A function registered at startup that injects additional text into the agent's system prompt each turn. Used here to inject DID authority information so the agent knows how to respond to different Bluesky senders.
- **Owner isolation**: The scheduler's mechanism for multi-tenancy — each `PostgresScheduler` instance is created with an `owner` string and only sees tasks for that owner. Agent tasks use `owner='spirit'`; system tasks use `owner='system'`.
- **Functional Core / Imperative Shell**: The architectural pattern used throughout the codebase. Pure functions (no side effects) form the "core"; I/O, DB calls, and event handling live in the "shell." This design's `validateMinimumInterval` is a pure core function; the tool handlers are shell.
- **Hexagonal architecture (Port/Adapter)**: An architectural pattern where domain logic is decoupled from external systems via defined interfaces ("ports") and concrete implementations ("adapters"). `Scheduler` is a port; `PostgresScheduler` is the adapter.
- **`onDue` handler**: A callback registered with the scheduler that fires when a task becomes due. The composition root registers this handler and routes the fired task based on `payload.type`.
- **One-shot task**: A task scheduled to run exactly once, at a specific future time. After it fires, the scheduler marks it `cancelled=TRUE` and removes it from future polling.
- **`scheduled_tasks` table**: The PostgreSQL table backing the scheduler. Stores task definitions, schedule strings, payload JSON, run timestamps, owner, and cancelled flag.

## Architecture

Three new built-in tools (`schedule_task`, `cancel_task`, `list_tasks`) expose the existing PostgreSQL-backed scheduler to the agent, giving it autonomy over its own scheduled work. A scheduling skill provides guidance on when and how to use the tools. Bluesky users with scheduling authority (a separate DID allowlist from `watched_dids`) can request scheduling conversationally.

**Core separation:** System-managed jobs (e.g., `review-predictions`) use `owner='system'` and are invisible to the agent's tools. Agent-scheduled jobs use `owner='spirit'` (or the agent's configured owner). Owner-based isolation is already enforced by the scheduler — no new access control logic needed.

**Task types:** Recurring tasks use cron expressions (minimum 10-minute interval enforced by the tools). One-shot tasks use ISO 8601 timestamps. Croner natively supports both formats. The scheduler's existing auto-cancel logic handles one-shot tasks: after firing, `nextRun()` returns null and the task is marked `cancelled=TRUE`.

**Data flow:**

```
Scheduling (any input channel):
  User/agent intent → schedule_task tool → scheduler.schedule() → scheduled_tasks table
  User/agent intent → cancel_task tool → scheduler.cancel() → scheduled_tasks.cancelled = TRUE
  User/agent intent → list_tasks tool → SELECT from scheduled_tasks WHERE owner = 'spirit'

Execution:
  Scheduler 60s poll → task due → onDue handler
    → if payload.type = 'agent-scheduled': buildAgentScheduledEvent(task)
    → if payload.type = 'prediction-review': existing review logic
    → ExternalEvent pushed to scheduler event queue
    → agent.processEvent(event) with source: 'self-scheduled'

Bluesky scheduling:
  Bluesky post from DID in schedule_dids ∪ watched_dids → shouldAcceptEvent() → agent
    → agent recognises scheduling intent (LLM, no regex) → uses schedule_task tool
    → DID in schedule_dids only: agent processes scheduling request, does not engage conversationally
    → DID in both: normal interaction plus scheduling
```

**Key contracts:**

```typescript
// Tool handler dependencies
type SchedulingToolDeps = {
  readonly scheduler: Scheduler;
  readonly owner: string;
  readonly persistence: PersistenceProvider;
};

// Event built when agent-scheduled task fires
type AgentScheduledEvent = ExternalEvent & {
  readonly source: 'self-scheduled';
  // content = the agent's stored prompt
  // metadata includes taskId, taskName, schedule
};

// Minimum interval validation (pure function)
function validateMinimumInterval(schedule: string, minMinutes: number): boolean;
```

## Existing Patterns

Investigation found established patterns this design follows:

**Tool registration via `createFooTools()`:** Memory tools use `createMemoryTools(manager)`, prediction tools use `createPredictionTools(store, owner)`. Scheduling tools follow the same pattern: `createSchedulingTools(scheduler, owner, persistence)` returning `Array<Tool>`.

**Owner-scoped isolation:** All data tables filter by `owner` string. The scheduler is already owner-scoped via `createPostgresScheduler(persistence, owner)`. Changing the review job owner from `'spirit'` to `'system'` leverages this existing mechanism.

**Event processing via `processEvent()`:** Bluesky and the review job both fire `ExternalEvent` through `agent.processEvent()`. Agent-scheduled tasks use the same path with `source: 'self-scheduled'`.

**`shouldAcceptEvent()` filter:** The Bluesky source already accepts events from a `watchedDids` set. Adding `scheduleDids` to the acceptance filter follows the same pattern.

**Context providers:** Rate limiter status and prediction count are injected into the system prompt via `ContextProvider` functions. Scheduling authority (the `schedule_dids` list) uses the same mechanism.

**Config via Zod schemas:** `BlueskyConfigSchema` already validates conditional requirements. Adding `schedule_dids` as an optional array with a default follows the existing pattern.

**No new patterns introduced.** All components fit existing architectural conventions.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Owner Migration & Config
**Goal:** Separate system jobs from agent jobs. Add `schedule_dids` to config.

**Components:**
- `src/persistence/migrations/005_scheduler_owner.sql` — `UPDATE scheduled_tasks SET owner = 'system' WHERE name = 'review-predictions' AND owner = 'spirit'`
- `src/config/schema.ts` — Add `schedule_dids: z.array(z.string()).default([])` to `BlueskyConfigSchema`
- `src/index.ts` — Change review job registration to use `owner='system'`. Create a separate system scheduler instance: `createPostgresScheduler(persistence, 'system')` for the review job, keep agent scheduler as `createPostgresScheduler(persistence, AGENT_OWNER)`.

**Dependencies:** None

**Done when:** Migration runs, config validates with new field, review job registers under `'system'` owner, `bun run build` passes
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Scheduling Tools
**Goal:** Three agent-callable tools for managing scheduled tasks.

**Components:**
- `src/tool/builtin/scheduling.ts` — `createSchedulingTools(scheduler, owner, persistence)` producing `schedule_task`, `cancel_task`, `list_tasks` tools
  - `schedule_task`: validates cron minimum interval (10min), validates ISO 8601 futures, generates UUID, calls `scheduler.schedule()` with payload `{ type: 'agent-scheduled', prompt }`
  - `cancel_task`: delegates to `scheduler.cancel()`, owner-scoped
  - `list_tasks`: queries `scheduled_tasks` WHERE `owner = spirit`, optional `include_cancelled` filter, returns human-readable formatted output
- `src/tool/builtin/scheduling.ts` — Pure `validateMinimumInterval(schedule, minMinutes)` function for cron interval checking

**Dependencies:** Phase 1

**Done when:** Tests verify: schedule with valid cron creates task, schedule with too-frequent cron is rejected, schedule with ISO 8601 future creates task, schedule with past ISO 8601 is rejected, cancel marks task cancelled, list returns active tasks, list with include_cancelled returns all tasks, owner isolation (can't see/cancel other owners' tasks). Covers `agent-scheduling.AC1.1–AC1.7`, `agent-scheduling.AC2.1–AC2.3`, `agent-scheduling.AC3.1–AC3.4`.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Event Building & onDue Branching
**Goal:** Agent-scheduled tasks fire as `self-scheduled` events into the agent loop.

**Components:**
- `src/index.ts` — `buildAgentScheduledEvent(task)` function producing `ExternalEvent` with `source: 'self-scheduled'`, task's stored prompt as content, task metadata in metadata field
- `src/index.ts` — Modify `onDue` handler to branch on `task.payload.type`: `'agent-scheduled'` → `buildAgentScheduledEvent`, `'prediction-review'` → existing `buildReviewEvent`

**Dependencies:** Phase 2

**Done when:** Tests verify: agent-scheduled task fires event with `source: 'self-scheduled'` and correct prompt content, review job continues working as before, one-shot tasks auto-cancel after firing. Covers `agent-scheduling.AC4.1–AC4.3`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Bluesky Integration
**Goal:** Accept scheduling requests from authorised Bluesky DIDs.

**Components:**
- `src/extensions/bluesky/source.ts` — Modify `shouldAcceptEvent()` to accept events from `scheduleDids` set in addition to `watchedDids`. Pass both sets from config.
- `src/index.ts` — Pass `config.bluesky.schedule_dids` to Bluesky source constructor
- Scheduling context provider — `createSchedulingContextProvider(scheduleDids)` returning `ContextProvider` that injects the `schedule_dids` list and `watched_dids` list into the agent's system prompt so it can differentiate DID authority

**Dependencies:** Phase 1

**Done when:** Tests verify: events from `schedule_dids`-only DIDs are accepted, events from DIDs in neither list are rejected, context provider injects DID lists into system prompt. Covers `agent-scheduling.AC5.1–AC5.4`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Scheduling Skill
**Goal:** Agent guidance on when/how to use scheduling tools.

**Components:**
- `skills/scheduling/scheduling.md` — YAML frontmatter + markdown guidance covering:
  - When to schedule (explicit requests, self-initiated follow-ups, deferred work)
  - How to schedule (cron patterns, ISO 8601 for one-shots, self-contained prompts)
  - What not to schedule (too-frequent tasks, duplicating system jobs, scheduling chains)
  - Bluesky DID authority (schedule_dids vs watched_dids behaviour)
  - Deno cron note (sandbox runtime has its own cron for code-level timing)
  - Auditability (presenting schedule to user on request)
  - Soft prompt length guidance (keep prompts concise, future-you has no conversation context)

**Dependencies:** Phases 2, 4

**Done when:** Skill file exists with valid YAML frontmatter, skill retrieval system loads it at startup, semantic search surfaces it for scheduling-related queries
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Composition Root Wiring
**Goal:** Wire scheduling tools and context provider into the daemon.

**Components:**
- `src/index.ts` — Create agent scheduler (`createPostgresScheduler(persistence, AGENT_OWNER)`), create system scheduler (`createPostgresScheduler(persistence, 'system')`), register scheduling tools, register scheduling context provider, wire both schedulers' `onDue` handlers to the event queue

**Dependencies:** Phases 2, 3, 4, 5

**Done when:** Daemon starts with scheduling tools available, agent can schedule/cancel/list tasks via REPL, self-scheduled events fire correctly, `bun run build` passes. Covers `agent-scheduling.AC6.1–AC6.2`.
<!-- END_PHASE_6 -->

## Additional Considerations

**Two scheduler instances:** The composition root creates two `PostgresScheduler` instances — one for `'system'` (review job) and one for `AGENT_OWNER` (agent tasks). Both poll independently on the same 60-second interval. This is simple and maintains clean owner isolation without conditional logic in a single instance.

**Prompt self-containment:** When the agent schedules a task, the prompt must be self-contained — future-you has no conversation context, just the prompt and task metadata. The skill emphasises this. No hard enforcement; the agent learns through experience.

**One-shot auto-cancel:** Croner handles ISO 8601 timestamps natively. After a one-shot task fires, `nextRun()` returns null and the scheduler marks it `cancelled=TRUE`. The task remains in the DB for audit. No new code needed in the scheduler for this.

**Minimum interval enforcement:** The `validateMinimumInterval` function is called by `schedule_task` only, not by the scheduler itself. The scheduler remains a dumb executor. This keeps validation at the tool boundary where the agent interacts.

**`scheduled_tasks` table growth:** Cancelled one-shot tasks accumulate. A future retention policy (e.g., purge cancelled tasks older than 30 days) is advisable but out of scope.
