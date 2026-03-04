# Agent Scheduling — Human Test Plan

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Migrations applied (`bun run migrate`) — specifically 004 and 005
- Valid `config.toml` with Bluesky credentials (if testing AC5.x)
- `bun test` passing (99 tests, 0 failures)

## Phase 1: Scheduling Output Readability (AC3.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon: `bun run start` | REPL prompt appears, no startup errors |
| 2 | Type: "Schedule a task to consolidate memory every 2 hours" | Agent calls `schedule_task` with a cron expression like `0 */2 * * *` |
| 3 | Type: "What's on your schedule?" | Agent calls `list_tasks`. Output should be a clearly formatted JSON array with fields: `id`, `name`, `schedule`, `prompt`, `next_run_at`, `last_run_at`. Dates should be ISO 8601 strings. The output should be scannable and understandable at a glance without needing to parse nested structures. |
| 4 | Verify the prompt field in list output matches the original self-instruction | The `prompt` field should contain the consolidation instruction, not raw JSON payload |

## Phase 2: DID Authority Differentiation (AC5.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure `config.toml` with a DID in `schedule_dids` that is NOT in `watched_dids` | Config loads without error |
| 2 | Start daemon and observe the system prompt (enable debug logging or inspect via context provider output) | System prompt contains `[DID Authority]` section listing both `Watched DIDs (full interaction)` and `Schedule DIDs (scheduling only)`, plus the instruction "When a message comes from a schedule-only DID, process only scheduling requests. Do not engage in general conversation." |
| 3 | Send a message from the schedule-only DID (via Bluesky post) containing a scheduling request like "Schedule a daily check at 9am" | Agent should accept the event, process it as a scheduling request, and call `schedule_task` |
| 4 | Send a conversational message from the same schedule-only DID like "What do you think about the weather?" | Agent should restrict its response to scheduling-related content only, not engage in general conversation |
| 5 | Send the same conversational message from a `watched_dids` DID | Agent should respond normally with full interaction |

## Phase 3: System Task Isolation (AC6.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run migration 005 (`bun run migrate`) | Migration applies successfully |
| 2 | Start daemon: `bun run start` | No startup errors |
| 3 | Type: "List your scheduled tasks" | Agent calls `list_tasks`. Output should NOT include `review-predictions` or any system-owned tasks |
| 4 | Query the database directly: `SELECT id, owner, name FROM scheduled_tasks WHERE name = 'review-predictions'` | Row exists with `owner = 'system'` |
| 5 | Ask the agent to cancel the review-predictions task by its ID (from step 4) | Agent should receive an error: "Task not found or not owned by this agent" |

## Phase 4: Composition Root Wiring (AC6.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon: `bun run start` | Starts without errors |
| 2 | Observe startup log output | Should see indication that schedulers are started (both agent and system scheduler instances) |
| 3 | Ask the agent: "What tools do you have for scheduling?" | Agent should reference `schedule_task`, `cancel_task`, `list_tasks` (these should be in its tool registry) |
| 4 | Create a scheduled task, list it, then cancel it | Full lifecycle completes without errors: schedule returns ID, list includes the task, cancel succeeds |

## Phase 5: Skill Content Completeness (AC7.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `skills/scheduling/SKILL.md` | File exists and is readable |
| 2 | Verify topic: **When to schedule** | Guidance on appropriate use cases for scheduling is present |
| 3 | Verify topic: **Cron patterns** | Examples and explanation of cron syntax included |
| 4 | Verify topic: **One-shot ISO 8601** | Explanation of one-shot scheduling with ISO timestamp examples |
| 5 | Verify topic: **Self-contained prompts** | Guidance that scheduled prompts should be self-contained (agent won't have original context when they fire) |
| 6 | Verify topic: **Deno cron note** | Note about the relationship between this scheduling system and Deno's built-in cron |
| 7 | Verify topic: **DID authority** | Explanation of schedule-only vs watched DIDs and how the agent should behave for each |
| 8 | Verify topic: **Auditability** | Guidance on making scheduled tasks auditable (naming conventions, clear prompts) |

## End-to-End: Full Agent Scheduling Lifecycle

1. Start daemon with `bun run start`
2. Ask the agent to schedule a one-shot task 2 minutes in the future: "Schedule a reminder for [2 minutes from now ISO timestamp] to check the current memory status"
3. Verify the agent calls `schedule_task` and receives an ID and `next_run_at`
4. Ask "What's on your schedule?" — verify the task appears in the list
5. Wait for the task to fire (up to ~2.5 minutes with the 60-second polling interval)
6. Observe the agent receiving an `ExternalEvent` with `source: 'self-scheduled'` and the prompt content
7. Verify the agent processes the prompt (e.g., calls memory tools)
8. Ask "What's on your schedule?" again — the one-shot task should no longer appear (auto-cancelled)
9. Ask "Show all tasks including cancelled" — the one-shot task should appear with `cancelled: true`

## End-to-End: Multi-Owner Isolation

1. Start daemon
2. Schedule an agent task via the REPL
3. Query DB directly: verify agent task has `owner` matching the configured agent owner
4. Query DB directly: verify `review-predictions` exists with `owner = 'system'`
5. Via REPL, list tasks — only agent-owned tasks appear
6. Both schedulers should be polling independently (system scheduler fires review jobs, agent scheduler fires agent tasks)

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC3.3 — Output is human-readable | "Human-readable" is a subjective quality | Phase 1, Steps 3-4 |
| AC5.4 — Agent differentiates DID authority | LLM behavioural compliance cannot be deterministically asserted | Phase 2, Steps 3-5 |
| AC6.1 — Review job invisible to agent tools | Requires running database with migration applied | Phase 3, Steps 3-5 |
| AC6.2 — All scheduling tools registered | Full composition root wiring requires all real dependencies | Phase 4, Steps 1-4 |
| AC7.2 — Skill includes all 7 guidance topics | Content completeness is a checklist review | Phase 5, Steps 1-8 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|---------------------|---------------|-------------|
| AC1.1 — Schedule recurring task | `scheduling.test.ts` line 74 | Phase 4, Step 4 |
| AC1.2 — Schedule one-shot task | `scheduling.test.ts` line 106 | E2E Lifecycle, Step 2 |
| AC1.3 — Reject frequent cron | `scheduling.test.ts` line 134 | — |
| AC1.4 — Reject past timestamp | `scheduling.test.ts` line 155 | — |
| AC1.5 — Reject invalid schedule | `scheduling.test.ts` line 179 | — |
| AC1.6 — Payload structure | `scheduling.test.ts` line 199 | — |
| AC1.7 — Owner on task | `scheduling.test.ts` line 224 | E2E Multi-Owner, Step 3 |
| AC2.1 — Cancel task by ID | `scheduling.test.ts` line 308 | Phase 4, Step 4 |
| AC2.2 — Cancel nonexistent | `scheduling.test.ts` line 336 | — |
| AC2.3 — Owner isolation on cancel | `scheduling.test.ts` line 355 | Phase 3, Step 5 |
| AC3.1 — List active tasks | `scheduling.test.ts` line 426 | Phase 1, Step 3 |
| AC3.2 — Include cancelled | `scheduling.test.ts` line 484 | E2E Lifecycle, Step 9 |
| AC3.3 — Human-readable output | — | Phase 1, Steps 3-4 |
| AC3.4 — Owner-scoped list | `scheduling.test.ts` line 581 | Phase 3, Step 3 |
| AC4.1 — Self-scheduled event source | `index.wiring.test.ts` line 291 | E2E Lifecycle, Step 6 |
| AC4.2 — Event content is prompt | `index.wiring.test.ts` line 324 | E2E Lifecycle, Step 6 |
| AC4.3 — One-shot auto-cancel | `index.wiring.test.ts` line 404 | E2E Lifecycle, Steps 8-9 |
| AC5.1 — Schedule DIDs accepted | `source.test.ts` line 65 | Phase 2, Step 3 |
| AC5.2 — Unknown DIDs rejected | `source.test.ts` line 107 | — |
| AC5.3 — Context provider injects DIDs | `scheduling-context.test.ts` | Phase 2, Step 2 |
| AC5.4 — DID authority differentiation | — | Phase 2, Steps 3-5 |
| AC6.1 — System task invisible | — | Phase 3, Steps 3-5 |
| AC6.2 — Composition root wiring | — | Phase 4, Steps 1-4 |
| AC7.1 — Skill file parses | `parser.test.ts` line 483 | — |
| AC7.2 — Skill content checklist | — | Phase 5, Steps 1-8 |
