# Dynamic Sleep Cycle — Human Test Plan

Generated: 2026-03-04

## Prerequisites

- PostgreSQL 17 running with pgvector (`docker compose up -d`)
- Migrations applied (`bun run migrate`)
- Valid `config.toml` with all required sections
- Access to Bluesky test account (for Phase 5)

---

## Phase 1: Backward Compatibility (AC8.1, AC8.2, AC8.3)

### Test 1.1: Absent activity config
1. Ensure `config.toml` has NO `[activity]` section
2. Run `bun run start`
3. **Verify:** Agent starts normally with no activity-related log messages
4. **Verify:** Scheduled tasks (prediction review) fire on schedule
5. **Verify:** Bluesky messages process normally

### Test 1.2: Disabled activity config
1. Add to `config.toml`:
   ```toml
   [activity]
   enabled = false
   ```
2. Run `bun run start`
3. **Verify:** Same behaviour as absent config — no activity components created

### Test 1.3: Invalid cron rejected
1. Add to `config.toml`:
   ```toml
   [activity]
   enabled = true
   timezone = "America/Toronto"
   sleep_schedule = "not-a-cron"
   wake_schedule = "0 6 * * *"
   ```
2. Run `bun run start`
3. **Verify:** Startup fails with Zod validation error mentioning invalid cron

---

## Phase 2: Sleep/Wake Transition Cycle (AC1.1, AC1.2)

### Test 2.1: Observe full transition cycle
1. Configure activity with schedules that will fire soon:
   ```toml
   [activity]
   enabled = true
   timezone = "America/Toronto"
   sleep_schedule = "*/5 * * * *"   # every 5 minutes (for testing)
   wake_schedule = "2-59/5 * * * *" # 2 minutes after each sleep
   ```
2. Run `bun run start`
3. **Verify:** Log shows `activity manager started (mode: active|sleeping, ...)`
4. Wait for sleep transition
5. **Verify:** Log shows `[activity] transitioned to sleeping mode`
6. Wait for wake transition
7. **Verify:** Log shows `[activity] transitioned to active mode`
8. **Verify:** Log shows `[activity] drained N queued events` (if any were queued)

---

## Phase 3: Sleep Tasks During Sleep (AC3.1–AC3.5)

### Test 3.1: Sleep tasks fire during sleep window
1. Use production-like schedule (10 PM sleep, 6 AM wake) or accelerated test schedule
2. Start agent during sleep window
3. **Verify:** `sleep-compaction` task fires at ~2h offset
4. **Verify:** `sleep-prediction-review` task fires at ~4h offset
5. **Verify:** `sleep-pattern-analysis` task fires at ~6h offset
6. **Verify:** Each sleep task triggers agent processing (visible in logs)

### Test 3.2: Flagged event summary in sleep tasks
1. During sleep, send a message from a high-priority DID (listed in `schedule_dids`)
2. Wait for next sleep task to fire
3. **Verify:** Sleep task prompt includes `[Flagged Events]` section with the flagged event

---

## Phase 4: Event Queueing and Priority (AC2.1, AC2.3, AC2.4, AC4.1, AC5.1–AC5.4)

### Test 4.1: Events queued during sleep
1. Start agent with activity enabled, wait for sleep transition
2. Trigger a scheduled task (e.g., prediction review)
3. **Verify:** Log shows `[activity] queued scheduler task "review-predictions" during sleep`
4. **Verify:** Task is NOT processed by agent during sleep

### Test 4.2: Events dispatch normally when active
1. Start agent with activity enabled, confirm active mode
2. Trigger a scheduled task
3. **Verify:** Task processes normally (no queueing log message)

### Test 4.3: Wake drain with priority ordering
1. During sleep, queue multiple events (some high priority via high-priority DIDs, some normal)
2. Wait for wake transition
3. **Verify:** High-priority events process before normal-priority events
4. **Verify:** Events within same priority level process in FIFO order
5. **Verify:** Trickle delay visible between event processing (no burst)

### Test 4.4: Empty queue on wake
1. Start agent, let it sleep with no incoming events
2. Wait for wake transition
3. **Verify:** Wake completes without errors, no "drained 0 events" noise

---

## Phase 5: Context Provider Injection (AC6.1, AC6.2)

### Test 5.1: Active mode context
1. Start agent with activity enabled in active mode
2. Trigger agent processing (send a message or scheduled event)
3. **Verify:** Agent system prompt includes `[Activity] Status: active` with next sleep time

### Test 5.2: Sleep mode context with guidance
1. Start agent during sleep window (or wait for sleep transition)
2. Trigger a sleep task
3. **Verify:** Agent system prompt includes:
   - `[Activity] Status: sleeping`
   - Queue stats (queued count, flagged count)
   - `[Circadian Guidance]` section advising internal-focused work
   - `[Flagged Events]` section if any high-priority events exist

---

## Phase 6: Restart Resilience (AC7.1, AC7.2, AC7.3)

### Test 6.1: Restart mid-sleep
1. Start agent, wait for sleep transition
2. Stop agent (Ctrl+C)
3. **Verify:** Shutdown log shows `[activity] shutdown state: sleeping, queued: N`
4. Restart agent
5. **Verify:** Startup log shows `activity manager started (mode: sleeping, ...)`
6. **Verify:** No duplicate activity tasks registered (check for "registered task" logs)

### Test 6.2: Restart mid-active
1. Start agent during active window
2. Stop and restart
3. **Verify:** Resumes in active mode

### Test 6.3: First-ever startup
1. Truncate `activity_state` table: `TRUNCATE activity_state;`
2. Start agent with activity enabled
3. **Verify:** Mode computed from cron expressions (logged at startup)
4. **Verify:** `activity_state` row created in database

---

## End-to-End: Full Cycle

### Test E2E.1: Complete sleep/wake cycle with events
1. Configure with accelerated schedule (5-minute cycles)
2. Start agent fresh
3. Confirm active mode at startup
4. Wait for sleep transition
5. Send 2-3 Bluesky messages (mix of high-priority and normal DIDs)
6. Confirm events are queued (check logs)
7. Wait for at least one sleep task to fire
8. Wait for wake transition
9. Confirm queued events drain in priority order with trickle delay
10. Confirm agent returns to normal active operation
11. Stop agent, verify clean shutdown with activity state logged
