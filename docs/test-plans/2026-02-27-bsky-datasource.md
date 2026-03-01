# Bluesky DataSource Integration — Human Test Plan

## Prerequisites

- PostgreSQL running (`docker compose up -d`)
- Database migrated (`bun run migrate`)
- Valid Bluesky account credentials (handle + app password)
- A second Bluesky account (or existing DID) to post from
- `config.toml` configured per `config.toml.example`
- All unit tests passing: `bun test` (expect 166 pass, 3 pre-existing PG-dependent failures acceptable)
- Deno installed and on PATH

## Phase 1: Configuration

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Add `[bluesky]` section to `config.toml` with `enabled = true`, valid handle, app_password, did, watched_dids, jetstream_url | File saves without syntax errors |
| 1.2 | Run `bun run build` | Type-check passes with no errors |
| 1.3 | Run `bun run start` | Daemon starts, session login confirmation, REPL prompt appears |

## Phase 2: Jetstream Connection and Event Filtering

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | After daemon starts, check stdout/stderr | Bluesky connection log visible, no WebSocket or login errors |
| 2.2 | From watched DID account, create a new post on Bluesky | Daemon logs show event received. Agent processes the event and produces a response |
| 2.3 | From an account NOT in `watched_dids`, create a new post (not a reply to agent) | No event appears in daemon logs. Post is silently filtered |
| 2.4 | From any account, reply to a post authored by the agent's DID | Daemon logs show reply event received and processed, even if replier's DID not in `watched_dids` |

## Phase 3: Agent Processing and Conversation Isolation

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | While daemon is running, type a message in the REPL | Agent responds via REPL as normal |
| 3.2 | Trigger a Bluesky event (post from watched DID) | Agent processes event in separate conversation. REPL not disrupted. Event processing log shows different conversation ID |
| 3.3 | Stop daemon (Ctrl+C), restart, trigger another Bluesky event from same watched DID | Bluesky conversation ID same as before restart. Previous conversation context loaded from database |

## Phase 4: Credential Injection into Sandbox

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | In REPL, ask agent to execute code referencing `BSKY_SERVICE` | Code execution fails with ReferenceError — `BSKY_SERVICE` not defined in REPL context |
| 4.2 | Trigger a Bluesky event where agent decides to use code execution | Sandbox has access to `BSKY_SERVICE`, `BSKY_ACCESS_TOKEN`, `BSKY_REFRESH_TOKEN`, `BSKY_DID`, `BSKY_HANDLE` |

## Phase 5: Template Seeding

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Before first run with Bluesky enabled, query DB for `bluesky:*` blocks | No rows returned |
| 5.2 | Start daemon with `bluesky.enabled = true` | Console outputs "Bluesky templates seeded into archival memory". DB has 3 blocks: `bluesky:post`, `bluesky:reply`, `bluesky:like` |
| 5.3 | Stop and restart daemon | No "Bluesky templates seeded" message on second start (idempotent). DB still has exactly 3 `bluesky:*` blocks |
| 5.4 | Inspect template content via DB query | Each template imports `npm:@atproto/api`, references all 5 `BSKY_*` constants, calls `output()`, uses correct `AtpAgent` methods |
| 5.5 | Set `bluesky.enabled = false`, drop 3 `bluesky:*` rows, restart daemon | No "Bluesky templates seeded" message. Blocks remain absent |

## Phase 6: Resilience and Backpressure

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Set `jetstream_url` to `wss://localhost:1/subscribe` (unreachable), keep `bluesky.enabled = true`. Start daemon | REPL prompt appears and is interactive. stderr shows Bluesky connection failure log. Agent responds normally to REPL input |
| 6.2 | Start daemon with valid config and connected Jetstream. Send SIGINT (Ctrl+C) | Stdout shows "bluesky datasource disconnected" before shutdown. No WebSocket error output |

## End-to-End: Full Pipeline Smoke Test

1. Configure `config.toml` with `bluesky.enabled = true`, valid credentials, one watched DID, production Jetstream URL
2. Start the daemon (`bun run start`)
3. Verify "Bluesky templates seeded" appears on first run (or absent on subsequent runs)
4. Verify REPL responsive (type "ping", expect response)
5. From watched account, post: "Testing constellation bluesky integration"
6. Observe daemon logs: event received, filtered, formatted as `[External Event: bluesky]`, processed by agent
7. Verify agent produces a response (not an error)
8. From non-watched account, reply to agent's DID's post
9. Observe: reply event received and processed (AC1.3 path)
10. Ctrl+C to shut down. Verify clean disconnect
11. Restart, verify Bluesky conversation resumes with same conversation ID

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `source.test.ts` session management | Phase 2, Step 2.1 |
| AC1.2 | `source.test.ts` watched_dids acceptance | Phase 2, Step 2.2 |
| AC1.3 | `source.test.ts` reply detection | Phase 2, Step 2.4 |
| AC1.4 | `source.test.ts` rejection filters | Phase 2, Step 2.3 |
| AC1.5 | `source.test.ts` metadata shape | -- |
| AC1.6 | `source.test.ts` token getters | -- |
| AC2.1 | `agent.test.ts` conversation isolation | Phase 3, Step 3.2 |
| AC2.2 | `agent.test.ts` structured formatting | Phase 3, Step 3.2 |
| AC2.3 | -- | Code review |
| AC2.4 | `agent.test.ts` deterministic ID | Phase 3, Step 3.3 |
| AC3.1 | `executor.test.ts` credential generation | Phase 4, Step 4.2 |
| AC3.2 | `executor.test.ts` REPL no credentials | Phase 4, Step 4.1 |
| AC3.3 | `executor.test.ts` valid TS syntax | -- |
| AC4.1 | `schema.test.ts` full config parse | Phase 1, Step 1.1 |
| AC4.2 | `schema.test.ts` conditional validation | -- |
| AC4.3 | `config.test.ts` BLUESKY_HANDLE override | -- |
| AC4.4 | `config.test.ts` BLUESKY_APP_PASSWORD override | -- |
| AC4.5 | `schema.test.ts` empty watched_dids | -- |
| AC4.6 | `schema.test.ts` disabled by default | -- |
| AC5.1 | `seed.test.ts` template seeding | Phase 5, Step 5.2 |
| AC5.2 | -- | Phase 5, Step 5.4 |
| AC5.3 | -- | Phase 5, Step 5.5 |
| AC5.4 | `seed.test.ts` idempotency | Phase 5, Step 5.3 |
| AC6.1 | -- | End-to-End Smoke Test |
| AC6.2 | `event-queue.test.ts` backpressure | -- |
| AC6.3 | -- | Phase 6, Step 6.1 |
| AC6.4 | -- | Phase 6, Step 6.2 |
| AC6.5 | `index.test.ts` error handling | -- |
