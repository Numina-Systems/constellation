---
name: scheduling
description: How to use schedule_task, cancel_task, and list_tasks for autonomous time-based work. Use when a task should happen later, on a recurring basis, or when a user requests scheduled actions via Bluesky.
tags:
  - scheduling
  - cron
  - automation
  - bluesky
---

# Scheduling

Use the scheduling system to defer work, automate recurring checks, and respond to time-based requests from users.

## When to Schedule

Schedule a task when:

- **Explicit user requests**: "remind me", "check every hour", "do this tomorrow", or "run this weekly"
- **Self-initiated follow-ups**: You want to review a prediction in 24 hours, check back on incomplete work, or validate an earlier action
- **Deferred work that doesn't need to happen now**: You've completed the current request but identified work that should happen later on a schedule

Don't schedule tasks that should happen immediately in the current conversation.

## How to Schedule — Recurring Tasks

Recurring tasks use cron expressions. The scheduler enforces a minimum interval of 10 minutes (tasks more frequent than that will be rejected).

### Cron Format

5-field cron: `minute hour day-of-month month day-of-week`

Each field:
- `minute`: 0-59
- `hour`: 0-23 (UTC)
- `day-of-month`: 1-31
- `month`: 1-12
- `day-of-week`: 0-6 (0 = Sunday, 6 = Saturday)

Use `*` for "any" and `/N` for every N steps.

### Common Patterns

- `0 * * * *` — Every hour, at the top of the hour
- `0 */2 * * *` — Every 2 hours
- `0 9 * * *` — Daily at 09:00 UTC
- `0 9 * * 1` — Every Monday at 09:00 UTC
- `0 */6 * * *` — Every 6 hours (midnight, 6am, noon, 6pm UTC)

Avoid intervals shorter than 10 minutes. If you need sub-minute timing, use `Deno.cron()` in sandboxed code instead.

## How to Schedule — One-Shot Tasks

One-shot tasks run exactly once at a specified time using ISO 8601 format.

### Format

`2026-03-15T14:00:00Z`

- Must be a future timestamp
- Must include timezone (typically `Z` for UTC)
- Task auto-cancels after firing (no cleanup needed)

### When to Use One-Shot

Use one-shot scheduling for:
- Time-sensitive requests ("check my predictions tomorrow at 9am")
- Urgent deferred work that has a specific deadline
- Following up on a user request at a specific time

## Self-Contained Prompts

When you schedule a task, the prompt fires into a fresh agent context with no conversation history. Design prompts accordingly:

### Rules

1. **Include all necessary context** in the prompt itself
2. **Don't assume prior knowledge** — the prompt runs in isolation
3. **Keep it concise** — one to three sentences is usually sufficient
4. **Be explicit about the goal**

### Good vs Bad

**Bad:**
```
Continue the analysis
```
Problem: No context for what analysis, what data, what the prior decision was.

**Good:**
```
Review all pending predictions from the past 24 hours, annotate outcomes based on recent traces, and write a reflection to archival memory noting calibration accuracy and patterns.
```
Contains: the task ("review predictions"), the scope ("past 24 hours"), the action ("annotate outcomes"), and the output ("write reflection").

### Tips

- Name the tools you'll use if they're not obvious (`use memory_write to persist notes`)
- Reference specific data by scope or label if possible (`review the Bluesky posts tagged with #reflex`)
- Include success criteria if the task is open-ended (`stop after reviewing the most recent 10 events`)

## What NOT to Schedule

- **Tasks more frequent than every 10 minutes** — the tool will reject these. Use `Deno.cron()` in code for sub-minute timing.
- **Duplicates of system jobs** — don't schedule your own review cycle if the daemon already has one
- **Chains of dependent schedules** — schedule one task; if it needs follow-up, let that task schedule the next one

## Bluesky DID Authority

The daemon has two DID lists:
- `schedule_dids` — Users who can request scheduling but not general interaction
- `watched_dids` — Users who get full interaction including scheduling

### Interaction Rules

- **For `schedule_dids` users**: Process their scheduling requests conversationally, but don't engage in general discussion. Keep responses focused on the scheduling task.
- **For `watched_dids` users**: Full interaction including scheduling requests.

When a user asks you to schedule something, use `schedule_task` with the user's request incorporated into the prompt. Always summarize what you're scheduling back to the user for confirmation.

## Deno Cron Note

The Deno sandbox runtime has its own `Deno.cron()` API for in-process timing. Use it when:
- You need sub-minute granularity
- You're writing code that should schedule internal work
- The timing is tied to logic inside the same code block

Use `schedule_task` for agent-level scheduling (orchestrated by the daemon scheduler). Use `Deno.cron()` for timing within sandboxed code execution.

## Auditability

When a user asks "what's on your schedule?", "what tasks are pending?", or similar, use `list_tasks` to show active scheduled tasks.

All tasks persist in the database, including cancelled ones, so the agent and users can audit the scheduling history for transparency and debugging.
