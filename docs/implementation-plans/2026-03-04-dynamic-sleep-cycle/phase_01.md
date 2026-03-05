# Dynamic Sleep Cycle Implementation Plan — Phase 1

**Goal:** Define the `[activity]` config section and create database tables for activity state and event queue.

**Architecture:** Extends existing Zod config schema with an optional `activity` field following the same pattern as `email`, `web`, and `skills`. New migration creates two PostgreSQL tables (`activity_state` and `event_queue`) with appropriate indices.

**Tech Stack:** Zod 3.24, PostgreSQL 17, TOML config

**Scope:** 7 phases from original design (phases 1-7)

**Codebase verified:** 2026-03-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### sleep-cycle.AC1: Activity mode transitions on schedule
- **sleep-cycle.AC1.5 Failure:** Invalid cron expression in config rejected at startup with clear error

### sleep-cycle.AC8: Opt-in and backward compatibility
- **sleep-cycle.AC8.1 Success:** Absent `[activity]` config results in no activity manager, no context injection, normal scheduler dispatch
- **sleep-cycle.AC8.2 Success:** `enabled = false` has same effect as absent config

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add ActivityConfigSchema and extend AppConfigSchema

**Verifies:** sleep-cycle.AC1.5, sleep-cycle.AC8.1, sleep-cycle.AC8.2

**Files:**
- Modify: `src/config/schema.ts` (add `ActivityConfigSchema` before `AppConfigSchema`, extend `AppConfigSchema` with `activity` field, export new types)

**Implementation:**

Add `ActivityConfigSchema` before `AppConfigSchema` (around line 128). The schema validates:
- `enabled: boolean` (default `false`)
- `timezone: string` (IANA timezone, required when enabled)
- `sleep_schedule: string` (cron expression, required when enabled)
- `wake_schedule: string` (cron expression, required when enabled)

Use `superRefine` following the `BlueskyConfigSchema` pattern (lines 44-66) to conditionally require `timezone`, `sleep_schedule`, and `wake_schedule` when `enabled: true`.

Add `activity: ActivityConfigSchema.optional()` to `AppConfigSchema`.

Export `ActivityConfig` type and `ActivityConfigSchema`.

```typescript
import { Cron } from 'croner';

const ActivityConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    timezone: z.string().optional(),
    sleep_schedule: z.string().optional(),
    wake_schedule: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.timezone) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "timezone is required when activity is enabled", path: ["timezone"] });
      }
      if (!data.sleep_schedule) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sleep_schedule is required when activity is enabled", path: ["sleep_schedule"] });
      } else {
        try { new Cron(data.sleep_schedule); } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid cron expression for sleep_schedule: ${data.sleep_schedule}`, path: ["sleep_schedule"] });
        }
      }
      if (!data.wake_schedule) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wake_schedule is required when activity is enabled", path: ["wake_schedule"] });
      } else {
        try { new Cron(data.wake_schedule); } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid cron expression for wake_schedule: ${data.wake_schedule}`, path: ["wake_schedule"] });
        }
      }
    }
  });
```

**Note:** `Cron` from `croner` is already a project dependency (v10.0.1). The import should be added alongside other imports at the top of `src/config/schema.ts`. Instantiating `new Cron(expression)` with an invalid expression throws an error, which we catch to produce a clear validation message.

In `AppConfigSchema`, add after `email`:
```typescript
activity: ActivityConfigSchema.optional(),
```

Add to type exports:
```typescript
export type ActivityConfig = z.infer<typeof ActivityConfigSchema>;
```

Add `ActivityConfigSchema` and `ActivityConfig` to the named exports at the bottom of the file.

**Testing:**
Tests must verify each AC listed above:
- sleep-cycle.AC1.5: Config with `enabled: true` and invalid/missing cron fields is rejected with clear error
- sleep-cycle.AC8.1: Config with no `[activity]` section parses successfully, `result.activity` is `undefined`
- sleep-cycle.AC8.2: Config with `activity: { enabled: false }` parses successfully

Follow existing test patterns in `src/config/schema.test.ts` (uses `describe/it/expect` from `bun:test`, AC IDs in describe names, full `AppConfigSchema.parse()` with all required sections).

**Verification:**
Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/config/schema.test.ts`
Expected: All tests pass

**Commit:** `feat(config): add ActivityConfigSchema with optional [activity] section`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add ActivityConfigSchema tests

**Verifies:** sleep-cycle.AC1.5, sleep-cycle.AC8.1, sleep-cycle.AC8.2

**Files:**
- Modify: `src/config/schema.test.ts` (add new describe blocks at end of file)

**Testing:**
Tests must follow existing patterns in `src/config/schema.test.ts`:
- Use AC IDs in describe block names (e.g., `describe("sleep-cycle.AC8.1: ...")`)
- Full `AppConfigSchema.parse()` calls with all required fields
- Test the following cases:

For sleep-cycle.AC8.1:
- Parse config with no `activity` field at all — `result.activity` should be `undefined`

For sleep-cycle.AC8.2:
- Parse config with `activity: { enabled: false }` — should parse without error, `result.activity.enabled` should be `false`

For sleep-cycle.AC1.5:
- Parse config with `activity: { enabled: true }` but no `timezone` — should throw
- Parse config with `activity: { enabled: true, timezone: "America/Toronto" }` but no `sleep_schedule` — should throw
- Parse config with `activity: { enabled: true, timezone: "America/Toronto", sleep_schedule: "0 22 * * *" }` but no `wake_schedule` — should throw
- Parse config with all four fields present and `enabled: true` — should succeed
- Parse config with `activity: { enabled: true, timezone: "America/Toronto", sleep_schedule: "not a cron", wake_schedule: "0 6 * * *" }` — should throw with clear error about invalid cron expression for `sleep_schedule`
- Parse config with `activity: { enabled: true, timezone: "America/Toronto", sleep_schedule: "0 22 * * *", wake_schedule: "garbage" }` — should throw with clear error about invalid cron expression for `wake_schedule`

**Verification:**
Run: `bun test src/config/schema.test.ts`
Expected: All tests pass

**Commit:** `test(config): add ActivityConfigSchema validation tests`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Create database migration 006_activity_schema.sql

**Verifies:** None (infrastructure task)

**Files:**
- Create: `src/persistence/migrations/006_activity_schema.sql`

**Implementation:**

Create the migration file with two tables and indices. Follow the style of existing migrations (e.g., `004_reflexion_schema.sql`).

**Note:** Design plan says 005 but 005 already exists (`005_scheduler_owner.sql`). Use **006**.

```sql
-- Activity state tracking
CREATE TABLE IF NOT EXISTS activity_state (
    owner TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'sleeping')),
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_transition_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event queue for deferred events during sleep
CREATE TABLE IF NOT EXISTS event_queue (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    source TEXT NOT NULL,
    payload JSONB NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_queue_owner_priority ON event_queue (owner, priority, enqueued_at)
    WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_queue_owner_flagged ON event_queue (owner, flagged)
    WHERE processed_at IS NULL AND flagged = TRUE;
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes (migration is SQL, no TS impact, but verifies nothing is broken)

**Commit:** `feat(db): add migration 006 for activity_state and event_queue tables`
<!-- END_TASK_3 -->
