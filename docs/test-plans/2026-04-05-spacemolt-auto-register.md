# SpaceMolt Auto-Registration Test Plan

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Live SpaceMolt MCP server reachable at the configured `mcp_url`
- A fresh, unused `registration_code` (obtain from SpaceMolt admin)
- `config.toml` with valid `[model]`, `[embedding]`, `[database]` sections
- All automated tests passing:
  ```bash
  bun test src/config/schema.test.ts src/config/env-override.test.ts \
    src/extensions/spacemolt/credentials.test.ts \
    src/extensions/spacemolt/tool-provider.test.ts \
    src/extensions/spacemolt/source.test.ts \
    src/extensions/spacemolt/lifecycle.test.ts \
    src/extensions/spacemolt/wiring.test.ts
  ```

## Phase 1: First-Run Registration (AC5.1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Verify no `spacemolt:credentials` block exists in database: `psql $DATABASE_URL -c "SELECT id, label FROM memory_blocks WHERE label = 'spacemolt:credentials';"` | Empty result set (0 rows) |
| 2 | Add to `config.toml`: `[spacemolt]` section with `enabled = true` and `registration_code = "<fresh-code>"`. Omit `username` and `empire`. | Config file saved |
| 3 | Run `bun run start` | Agent starts without errors |
| 4 | Observe console output during startup | Log lines show: (a) MCP connection to SpaceMolt, (b) registration attempt, (c) successful registration with player ID, (d) WebSocket connection established after MCP auth |
| 5 | Query database: `psql $DATABASE_URL -c "SELECT label, tier, pinned, owner, permission, content FROM memory_blocks WHERE label = 'spacemolt:credentials';"` | One row: `tier = 'core'`, `pinned = true`, `owner = 'spirit'`, `permission = 'readwrite'`, `content` is valid JSON with `username`, `password`, `player_id`, `empire` fields |
| 6 | In the REPL, type a message referencing SpaceMolt (e.g., "what's my game status?") | Agent responds using `spacemolt:` tools. Tool calls appear in output. |

## Phase 2: Restart with Existing Credentials (AC5.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Stop the agent (Ctrl+C) | Clean shutdown |
| 2 | Run `bun run start` again with the same `config.toml` | Agent starts without errors |
| 3 | Observe console output during startup | Log lines show: (a) MCP connection, (b) **login** (not registration), (c) WebSocket connection after login |
| 4 | Verify the `registration_code` was not consumed again by checking SpaceMolt admin (if available) or observing no "register" in logs | No registration attempt logged |
| 5 | In the REPL, interact with the game | Agent responds normally with SpaceMolt tools |

## Phase 3: Sequential Startup Ordering (AC5.3 -- end-to-end)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add `DEBUG=spacemolt:*` or equivalent log level to observe timing | Debug logging enabled |
| 2 | Run `bun run start` | Agent starts |
| 3 | Observe log timestamps for MCP `discover()` completion vs WebSocket `connect()` initiation | `discover()` completes (tools listed) before `connect()` begins (WebSocket opened). No interleaving. |

## End-to-End: Registration with Username Hint

**Purpose:** Validates that the optional `username` config hint flows through to the MCP register call and appears in persisted credentials.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Clear existing credentials: `psql $DATABASE_URL -c "DELETE FROM memory_blocks WHERE label = 'spacemolt:credentials';"` | 1 row deleted (or 0 if already clean) |
| 2 | Set `config.toml` `[spacemolt]` with `username = "test-agent-42"` and `empire = "voidborn"` and a fresh `registration_code` | Config saved |
| 3 | Run `bun run start` | Agent registers successfully |
| 4 | Query credentials: `psql $DATABASE_URL -c "SELECT content FROM memory_blocks WHERE label = 'spacemolt:credentials';"` | JSON content's `username` field matches or starts with `"test-agent-42"` (may have suffix if name was taken). `empire` field is populated. |

## End-to-End: Env Var Override for Registration Code

**Purpose:** Validates that `SPACEMOLT_REGISTRATION_CODE` env var takes precedence over `config.toml` value in a real startup.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Clear existing credentials block from database | Clean slate |
| 2 | Set `config.toml` `[spacemolt]` with `registration_code = "dummy-will-fail"` | Config saved with intentionally wrong code |
| 3 | Run `SPACEMOLT_REGISTRATION_CODE=<valid-code> bun run start` | Agent registers successfully using the env var value, not the dummy config value |

## End-to-End: Session Expiry Recovery

**Purpose:** Validates that when the MCP session expires mid-game, the tool provider automatically re-authenticates and retries the failed tool call.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start agent with existing credentials (normal login path) | Agent running, SpaceMolt tools available |
| 2 | Wait for session to expire naturally, or if possible, invalidate the session server-side | Session becomes invalid |
| 3 | In the REPL, issue a SpaceMolt tool command (e.g., "mine some resources") | Agent's first tool call fails with `session_invalid`, then automatically re-logs-in and retries. Final output shows successful tool result. |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC5.1 -- First-run registration | Requires live MCP server, valid one-time registration code, real database. Mocking would duplicate AC3.1 unit tests. | Phase 1 above (steps 1-6) |
| AC5.2 -- Restart with existing credentials | Requires real database state from prior registration plus live MCP server. Login-vs-register distinction is unit-tested in AC3.2 but needs end-to-end confirmation. | Phase 2 above (steps 1-5) |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `schema.test.ts` -- "AC1.1: Parse spacemolt config" | -- |
| AC1.2 | `env-override.test.ts` -- "AC1.2: SPACEMOLT_REGISTRATION_CODE env override" | End-to-End: Env Var Override |
| AC1.3 | `schema.test.ts` -- "AC1.3: Reject enabled without registration_code" | -- |
| AC1.4 | `schema.test.ts` -- "AC1.4: Optional username and empire hints" | End-to-End: Username Hint |
| AC2.1 | `credentials.test.ts` -- "AC2.1: Returns null when no block exists" | -- |
| AC2.2 | `credentials.test.ts` -- "AC2.2: Creates pinned core block" | Phase 1, step 5 |
| AC2.3 | `credentials.test.ts` -- "AC2.3: Returns parsed credentials" | -- |
| AC2.4 | `credentials.test.ts` -- "AC2.4: Returns null on corrupted JSON" | -- |
| AC3.1 | `tool-provider.test.ts` -- "AC3.1: discover() calls register" | Phase 1, steps 3-5 |
| AC3.2 | `tool-provider.test.ts` -- "AC3.2: discover() calls login" | Phase 2, step 3 |
| AC3.3 | `tool-provider.test.ts` -- "AC3.3: usernameHint" | End-to-End: Username Hint |
| AC3.4 | `tool-provider.test.ts` -- "AC3.4: username_taken retry" | -- |
| AC3.5 | `tool-provider.test.ts` -- "AC3.5: exhausted retries" | -- |
| AC3.6 | `tool-provider.test.ts` -- "AC3.6: reconnect() uses login" | End-to-End: Session Expiry |
| AC4.1 | `source.test.ts` -- "connects and authenticates via login message" | Phase 1, step 4 |
| AC4.2 | `source.test.ts` -- "AC4.2: throws when getCredentials returns null" | -- |
| AC4.3 | `source.test.ts` -- "AC4.3: getCredentials called on reconnection" | -- |
| AC5.1 | -- | Phase 1 (full) |
| AC5.2 | -- | Phase 2 (full) |
| AC5.3 | `lifecycle.test.ts` + `wiring.test.ts` | Phase 3 |
