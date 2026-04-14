# SpaceMolt Auto-Registration: Test Requirements

Maps each acceptance criterion to specific automated tests or human verification steps.

---

## AC1: Config schema accepts registration code

### AC1.1 Success: Config with `[spacemolt]` section including `enabled = true` and `registration_code` parses successfully

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/config/schema.test.ts` |
| **Description** | Parse a full config object with `spacemolt.enabled = true` and `spacemolt.registration_code = "some-code"`. Assert parse succeeds and all fields (including defaults for `mcp_url`, `ws_url`, `event_queue_capacity`) are present in the output. |

### AC1.2 Success: `SPACEMOLT_REGISTRATION_CODE` env var overrides config `registration_code`

| | |
|---|---|
| **Test type** | Integration |
| **Test file** | `src/config/env-override.test.ts` |
| **Description** | Write a temp TOML config with `registration_code = "config-value"`. Set `SPACEMOLT_REGISTRATION_CODE=env-value` in process.env. Load config. Assert `registration_code` equals `"env-value"`. Secondary test: absent `[spacemolt]` section means env var is not applied (no crash). |

### AC1.3 Failure: Config with `enabled = true` but missing `registration_code` is rejected by schema validation

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/config/schema.test.ts` |
| **Description** | Parse a config with `spacemolt.enabled = true` and no `registration_code`. Assert parse throws a ZodError with an issue referencing `registration_code`. |

### AC1.4 Success: Optional `username` and `empire` config hints parse when provided

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/config/schema.test.ts` |
| **Description** | Parse a config with `spacemolt.enabled = true`, `registration_code`, `username = "my-agent"`, `empire = "voidborn"`. Assert parsed output contains both hint fields. Also verify they are absent from output when omitted from input (optional). |

---

## AC2: Credential memory block read/write

### AC2.1 Success: `readCredentials` returns null when no `spacemolt:credentials` block exists

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/credentials.test.ts` |
| **Description** | Provide a mock `MemoryStore` where `getBlockByLabel("spirit", "spacemolt:credentials")` returns `null`. Call `readCredentials(store)`. Assert result is `null`. |

### AC2.2 Success: `writeCredentials` creates a pinned core memory block with username, password, player_id, empire

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/credentials.test.ts` |
| **Description** | Provide a mock `MemoryStore` where `getBlockByLabel` returns `null` (no existing block). Call `writeCredentials` with test credentials. Capture the `createBlock` call and assert: `tier === "core"`, `pinned === true`, `permission === "readwrite"`, `owner === "spirit"`, `label === "spacemolt:credentials"`, and `content` is valid JSON containing all four credential fields. |

### AC2.3 Success: `readCredentials` returns parsed credentials from existing block

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/credentials.test.ts` |
| **Description** | Provide a mock `MemoryStore` where `getBlockByLabel` returns a block with valid JSON content containing `username`, `password`, `player_id`, `empire`. Call `readCredentials`. Assert returned object matches all four fields. |

### AC2.4 Edge: `readCredentials` returns null when block content is corrupted (invalid JSON)

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/credentials.test.ts` |
| **Description** | Two sub-cases: (a) block content is `"not-json{{"` (unparseable), (b) block content is `'{"username":"x"}'` (valid JSON but missing required fields). Both must return `null`. |

---

## AC3: Tool provider register-or-login flow

### AC3.1 Success: `discover()` with no credentials in memory calls MCP `register` tool and persists returned credentials

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | Mock store returns `null` from `getBlockByLabel` (no credentials). Mock MCP client's `callTool` returns successful register response with `player_id` and `password`. Call `discover()`. Assert: (1) `callTool` was invoked with `name: "register"`, (2) store's `createBlock` was called with `label: "spacemolt:credentials"`, `tier: "core"`, `pinned: true`, and content containing the returned credentials. |

### AC3.2 Success: `discover()` with existing credentials in memory calls MCP `login` tool

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | Mock store returns a block with valid credential JSON from `getBlockByLabel`. Call `discover()`. Assert: (1) `callTool` was invoked with `name: "login"` and the stored username/password, (2) `callTool` was NOT invoked with `name: "register"`. |

### AC3.3 Success: Registration uses config `username` hint when provided

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | Provide `usernameHint: "my-agent"` in options. Mock store returns `null`. Call `discover()`. Assert the `register` call's `arguments.username` equals `"my-agent"`. |

### AC3.4 Edge: `username_taken` error triggers retry with modified name (max 3 retries)

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | Mock MCP client's `callTool` returns `isError: true` with text containing `"username_taken"` on the first call, then succeeds on the second. Call `discover()`. Assert: (1) `callTool` was invoked at least twice with `name: "register"`, (2) the second call's `arguments.username` differs from the first. |

### AC3.5 Failure: Exhausted registration retries throws descriptive error

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | Mock MCP client's `callTool` always returns `isError: true` with `"username_taken"`. Call `discover()`. Assert it throws with message containing `"username taken after 3 retries"`. Assert `callTool` was invoked exactly 3 times with `name: "register"`. |

### AC3.6 Success: `reconnect()` always uses `login` path (never `register`)

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/tool-provider.test.ts` |
| **Description** | First call `discover()` (with store pre-populated so it takes login path). Then trigger `reconnect()` (via session expiry in `execute()` or direct call). Assert: the reconnect's `callTool` invocation uses `name: "login"`. Assert `name: "register"` was never called. |

---

## AC4: WebSocket source uses deferred credentials

### AC4.1 Success: Source authenticates using credentials from `getCredentials()` function

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/source.test.ts` |
| **Description** | Provide `getCredentials` returning `{ username: "testuser", password: "testpass" }`. Create source, connect, simulate `welcome` message from mock WebSocket. Assert the `login` message sent on the WebSocket contains `username: "testuser"` and `password: "testpass"`. |

### AC4.2 Failure: Null credentials from `getCredentials()` throws clear error before sending login message

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/source.test.ts` |
| **Description** | Provide `getCredentials` returning `null`. Create source, connect, simulate `welcome` message. Assert `connect()` promise rejects with error message containing `"credentials not available"`. Assert no `login` message was sent on the WebSocket. |

### AC4.3 Success: Reconnection re-reads credentials via `getCredentials()`

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/source.test.ts` |
| **Description** | Provide `getCredentials` as a tracking function that counts invocations. Connect, authenticate, then simulate unexpected close triggering reconnection. After reconnection completes the welcome/login cycle, assert `getCredentials` was called at least twice (initial + reconnect). |

---

## AC5: Composition root wiring

### AC5.1 Success: Agent starts with only `registration_code` in config, registers on first run, persists credentials

| | |
|---|---|
| **Verification** | Human |
| **Justification** | Full first-run registration requires a live SpaceMolt MCP server, a valid one-time registration code, and database-backed memory. The composition root orchestrates real I/O across multiple subsystems (MCP transport, PostgreSQL, embedding provider). Mocking all of these would duplicate the unit tests from AC3.1 without adding confidence. |
| **Approach** | Configure `config.toml` with `[spacemolt] enabled = true` and a fresh `registration_code`. Ensure no `spacemolt:credentials` block exists in the database. Start the agent with `bun run start`. Verify: (1) console logs show registration succeeded, (2) `spacemolt:credentials` core memory block exists in the database with valid JSON credentials, (3) agent proceeds to normal operation with SpaceMolt tools available. |

### AC5.2 Success: Agent starts with existing credentials in memory, logs in without registration code being consumed

| | |
|---|---|
| **Verification** | Human |
| **Justification** | Same rationale as AC5.1 — requires live MCP server and database state from a previous registration. The login-not-register distinction is verified in AC3.2's unit test; this confirms it works end-to-end with real infrastructure. |
| **Approach** | After AC5.1 succeeds, restart the agent with the same config (same `registration_code`). Verify: (1) console logs show login (not registration), (2) the registration code was not consumed again, (3) agent proceeds normally. |

### AC5.3 Success: WebSocket source connects after tool provider auth completes (sequential startup preserved)

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/lifecycle.test.ts` |
| **Description** | Track call ordering with an array. Mock source's `connect()` pushes `"connect"`, mock tool provider's `discover()` pushes `"discover"`. Call `lifecycle.start()`. Assert call order is `["discover", "connect"]`. |

Additionally verified in:

| | |
|---|---|
| **Test type** | Unit |
| **Test file** | `src/extensions/spacemolt/wiring.test.ts` |
| **Description** | Update existing wiring test to confirm the composition passes `getCredentials` (a function) to the source options rather than static `username`/`password` strings. Verify tool provider receives `registrationCode`, `store`, and `embedding` in its options. |

---

## Summary

| AC | Automated Tests | Human Verification |
|----|---|---|
| AC1.1 | 1 unit (schema.test.ts) | -- |
| AC1.2 | 1 integration (env-override.test.ts) | -- |
| AC1.3 | 1 unit (schema.test.ts) | -- |
| AC1.4 | 1 unit (schema.test.ts) | -- |
| AC2.1 | 1 unit (credentials.test.ts) | -- |
| AC2.2 | 1 unit (credentials.test.ts) | -- |
| AC2.3 | 1 unit (credentials.test.ts) | -- |
| AC2.4 | 2 unit (credentials.test.ts) | -- |
| AC3.1 | 1 unit (tool-provider.test.ts) | -- |
| AC3.2 | 1 unit (tool-provider.test.ts) | -- |
| AC3.3 | 1 unit (tool-provider.test.ts) | -- |
| AC3.4 | 1 unit (tool-provider.test.ts) | -- |
| AC3.5 | 1 unit (tool-provider.test.ts) | -- |
| AC3.6 | 1 unit (tool-provider.test.ts) | -- |
| AC4.1 | 1 unit (source.test.ts) | -- |
| AC4.2 | 1 unit (source.test.ts) | -- |
| AC4.3 | 1 unit (source.test.ts) | -- |
| AC5.1 | -- | Manual first-run with live MCP |
| AC5.2 | -- | Manual restart with existing creds |
| AC5.3 | 2 unit (lifecycle.test.ts + wiring.test.ts) | -- |

**Totals:** 19 automated tests across 6 test files, 2 human verification steps.
