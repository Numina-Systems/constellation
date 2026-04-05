# SpaceMolt Auto-Registration Design

## Summary

SpaceMolt is a browser-based space strategy game that Constellation's agent plays autonomously. Currently, the agent requires pre-configured credentials (`username`/`password`) to connect. This design replaces that with a self-registration flow: on first run, the agent connects to SpaceMolt's MCP server unauthenticated, calls a `register` tool with a one-time registration code (provided via config or environment variable), and receives back a persistent username and 256-bit password. Those credentials are immediately written to a pinned core memory block, making them available to the agent on every subsequent turn without any additional tooling.

On all subsequent runs, the agent reads credentials from memory and calls `login` instead. This memory block is also the credential source for the WebSocket event stream, which connects after the MCP tool provider completes auth — preserving the existing sequential startup ordering. The net result is that operators only need to supply a registration code once; the agent manages its own game identity from that point forward.

## Definition of Done

The SpaceMolt extension uses a registration-code-first auth flow. On first run, the agent connects to the MCP server unauthenticated, calls `register` with a self-chosen username and empire, persists the returned credentials (username + 256-bit password) to a core memory block, then proceeds with normal gameplay. On subsequent runs, the agent reads credentials from memory and calls `login`. The config schema accepts `registration_code` instead of requiring `username`/`password`. The WebSocket source and MCP tool provider both consume credentials from the same memory block. The existing design's session lifecycle (reconnect, sleep/wake) continues to work with memory-sourced credentials.

**Out of scope:** Dashboard/website API integration, manual registration flow, multi-account support.

## Acceptance Criteria

### spacemolt-auto-register.AC1: Config schema accepts registration code
- **spacemolt-auto-register.AC1.1 Success:** Config with `[spacemolt]` section including `enabled = true` and `registration_code` parses successfully
- **spacemolt-auto-register.AC1.2 Success:** `SPACEMOLT_REGISTRATION_CODE` env var overrides config `registration_code`
- **spacemolt-auto-register.AC1.3 Failure:** Config with `enabled = true` but missing `registration_code` is rejected by schema validation
- **spacemolt-auto-register.AC1.4 Success:** Optional `username` and `empire` config hints parse when provided

### spacemolt-auto-register.AC2: Credential memory block read/write
- **spacemolt-auto-register.AC2.1 Success:** `readCredentials` returns null when no `spacemolt:credentials` block exists
- **spacemolt-auto-register.AC2.2 Success:** `writeCredentials` creates a pinned core memory block with username, password, player_id, empire
- **spacemolt-auto-register.AC2.3 Success:** `readCredentials` returns parsed credentials from existing block
- **spacemolt-auto-register.AC2.4 Edge:** `readCredentials` returns null when block content is corrupted (invalid JSON)

### spacemolt-auto-register.AC3: Tool provider register-or-login flow
- **spacemolt-auto-register.AC3.1 Success:** `discover()` with no credentials in memory calls MCP `register` tool and persists returned credentials
- **spacemolt-auto-register.AC3.2 Success:** `discover()` with existing credentials in memory calls MCP `login` tool
- **spacemolt-auto-register.AC3.3 Success:** Registration uses config `username` hint when provided
- **spacemolt-auto-register.AC3.4 Edge:** `username_taken` error triggers retry with modified name (max 3 retries)
- **spacemolt-auto-register.AC3.5 Failure:** Exhausted registration retries throws descriptive error
- **spacemolt-auto-register.AC3.6 Success:** `reconnect()` always uses `login` path (never `register`)

### spacemolt-auto-register.AC4: WebSocket source uses deferred credentials
- **spacemolt-auto-register.AC4.1 Success:** Source authenticates using credentials from `getCredentials()` function
- **spacemolt-auto-register.AC4.2 Failure:** Null credentials from `getCredentials()` throws clear error before sending login message
- **spacemolt-auto-register.AC4.3 Success:** Reconnection re-reads credentials via `getCredentials()`

### spacemolt-auto-register.AC5: Composition root wiring
- **spacemolt-auto-register.AC5.1 Success:** Agent starts with only `registration_code` in config, registers on first run, persists credentials
- **spacemolt-auto-register.AC5.2 Success:** Agent starts with existing credentials in memory, logs in without registration code being consumed
- **spacemolt-auto-register.AC5.3 Success:** WebSocket source connects after tool provider auth completes (sequential startup preserved)

## Glossary

- **MCP (Model Context Protocol)**: A protocol that exposes structured tools to an AI agent via a server. SpaceMolt's MCP server provides game actions (`register`, `login`, fleet commands, etc.) that the agent calls as if they were function calls.
- **WebSocket source**: The component in the SpaceMolt extension that maintains a persistent WebSocket connection to the game server and translates incoming game events into agent-readable `DataSource` entries.
- **Core memory block**: A memory entry at the `core` tier in Constellation's three-tier memory system. Core blocks are always injected into the system prompt, making their contents visible to the agent on every turn without an explicit recall step.
- **Pinned block**: A memory block flagged so the compaction pipeline never evicts it, regardless of context pressure. Used here to ensure credentials survive summarisation cycles.
- **`MemoryManager`**: Constellation's internal interface for reading and writing memory blocks. The tool provider and WebSocket source both depend on it as an injected dependency.
- **`DataSource`**: Constellation's extension interface for components that push external events into the agent's context — in this case, SpaceMolt game events over WebSocket.
- **`discover()`**: The tool provider method that runs on startup: it authenticates (register or login), then enumerates the available MCP tools so the agent can call them during its loop.
- **`reconnect()`**: The tool provider method called on connection loss. Always uses `login` — registration is a one-time flow.
- **`getCredentials`**: A function injected into the WebSocket source at construction time that reads the `spacemolt:credentials` memory block at connection time, rather than accepting credentials as static constructor arguments. This defers credential resolution until after the tool provider has completed auth.
- **Registration code**: A one-time token issued by SpaceMolt (via its dashboard) that authorises a new account to be created. Analogous to an invite code.
- **`superRefine`**: A Zod validation method used for cross-field validation logic — in this case, enforcing that `registration_code` is present when `enabled = true`.
- **Functional Core / Imperative Shell**: The architectural pattern used throughout Constellation. Pure, side-effect-free logic lives in the "functional core"; I/O and orchestration live in the "imperative shell." The new `credentials.ts` module is functional core; wiring in `index.ts` and `tool-provider.ts` is imperative shell.
- **Composition root**: The application entry point (`src/index.ts`) where all dependencies are instantiated and wired together. The only place where concrete implementations are connected to their interfaces.
- **`seed.ts`**: The SpaceMolt module that writes the `spacemolt:capabilities` core memory block on startup, giving the agent its game knowledge. This design adds a parallel `spacemolt:credentials` block but keeps the two concerns in separate files.

## Architecture

Modification to the existing SpaceMolt integration (see `docs/design-plans/2026-04-04-spacemolt-integration.md`). Replaces the config-driven username/password auth with a registration-code-first flow that lets the agent self-register and persist credentials in memory.

### Auth Flow

Two paths through the same code in `tool-provider.ts`:

**First run (no credentials in memory):**
1. MCP tool provider connects unauthenticated
2. Checks memory for `spacemolt:credentials` block — not found
3. Resolves username (config `username` ?? random generated name) and empire (config `empire` ?? random empire)
4. Calls MCP `register(username, empire, registration_code)` tool
5. Parses response: `player_id` + 256-bit hex password
6. Writes `spacemolt:credentials` core memory block with username, password, player_id, empire
7. Proceeds to tool discovery

**Subsequent runs (credentials in memory):**
1. MCP tool provider connects unauthenticated
2. Checks memory for `spacemolt:credentials` block — found
3. Parses credentials from block content
4. Calls MCP `login(username, password)` tool
5. Proceeds to tool discovery

The WebSocket source connects after the tool provider completes auth. It reads credentials from the same memory block via a `getCredentials` function injected at construction time.

### Config Schema Changes

`[spacemolt]` config section replaces `username`/`password` with `registration_code`:

```typescript
type SpaceMoltConfig = {
  enabled: boolean;
  registration_code?: string;  // required when enabled; env: SPACEMOLT_REGISTRATION_CODE
  username?: string;           // optional hint; if absent, random name generated
  empire?: string;             // optional hint; if absent, random empire selected
  mcp_url: string;             // default: "https://game.spacemolt.com/mcp"
  ws_url: string;              // default: "wss://game.spacemolt.com/ws"
  event_queue_capacity: number; // default: 50
};
```

Env var `SPACEMOLT_REGISTRATION_CODE` overrides config. `SPACEMOLT_USERNAME` and `SPACEMOLT_PASSWORD` removed.

### Credential Memory Block

Core memory block `spacemolt:credentials` stores credentials after registration:

```typescript
{
  owner: 'spirit',
  tier: 'core',
  label: 'spacemolt:credentials',
  permission: 'readwrite',
  pinned: true,
  content: JSON.stringify({
    username: string,
    password: string,    // 256-bit hex from SpaceMolt register response
    player_id: string,
    empire: string,
  }),
}
```

Core tier means the block is always in the system prompt — the agent can reference its own credentials without a tool call. `readwrite` permission allows the agent to update the block if a password reset is needed in the future.

The tool provider writes this block. The seed function (`seed.ts`) continues to only handle the `spacemolt:capabilities` block.

### WebSocket Source Contract Change

The source factory signature changes from direct credentials to a credential-reader function:

```typescript
// Before
type SpaceMoltSourceOptions = {
  wsUrl: string;
  username: string;
  password: string;
  gameStateManager: GameStateManager;
  eventQueueCapacity: number;
};

// After
type SpaceMoltSourceOptions = {
  wsUrl: string;
  getCredentials: () => Promise<{ username: string; password: string } | null>;
  gameStateManager: GameStateManager;
  eventQueueCapacity: number;
};
```

On connect, after receiving `welcome`, the source calls `getCredentials()`. Returns credentials → sends `login` message. Returns null → throws (tool provider guarantees credentials exist before source connects).

### Tool Provider Contract Change

The tool provider factory signature changes from direct credentials to registration-capable options:

```typescript
// Before
type SpaceMoltToolProviderOptions = {
  mcpUrl: string;
  username: string;
  password: string;
};

// After
type SpaceMoltToolProviderOptions = {
  mcpUrl: string;
  registrationCode: string;
  usernameHint?: string;     // from config, fallback to random
  empireHint?: string;       // from config, fallback to random
  memory: MemoryManager;     // for reading/writing credentials
};
```

The `discover()` method handles the register-or-login decision internally. The `reconnect()` path always uses `login` since credentials are guaranteed to exist after first run.

### Startup Sequence

The composition root enforces ordering:

1. Create `MemoryManager` (existing)
2. Create `SpaceMoltToolProvider` with `registrationCode`, hints, and `memory`
3. `await toolProvider.discover()` — registers or logs in, discovers tools
4. Create `SpaceMoltSource` with `getCredentials` reading from memory
5. `await source.connect()` — credentials guaranteed to exist, sends `login`
6. Register with DataSource registry

Steps 3-5 are sequential (same as current code — `discover()` is awaited before source creation).

### Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Registration code already used | Throw descriptive error. SpaceMolt disabled for session. Human must check dashboard. |
| Username taken | Retry with modified name (append random suffix). Max 3 retries before throwing. |
| Auth failed on login (password reset externally) | Log error, disable SpaceMolt for session. Human must delete `spacemolt:credentials` block or update password. |
| Corrupted credentials block (JSON parse failure) | Treat as "no credentials". Re-register, overwrite block. |
| Rate limiting on registration | Surface error clearly. Not a practical concern for single agent. |

Cases requiring human intervention (used registration code, externally reset password) are rare edge cases that surface clear error messages.

## Existing Patterns

This design modifies the existing SpaceMolt integration, following patterns already established:

- **Memory block storage**: Follows `spacemolt:capabilities` seeding pattern in `src/extensions/spacemolt/seed.ts` — idempotent check by label, core/working tier blocks with pinning
- **Factory function options**: Matches existing `createSpaceMoltSource()` and `createSpaceMoltToolProvider()` patterns — options object with injected dependencies
- **Composition root ordering**: Follows existing sequential startup in `src/index.ts` — tool provider auth before source connection
- **Config env overrides**: Matches existing credential override pattern (e.g., `SPACEMOLT_PASSWORD` → `SPACEMOLT_REGISTRATION_CODE`)

**Divergence from existing patterns:**

- **Secrets in memory blocks**: No existing pattern for storing secrets in memory. All other credentials live in config/env vars. This is a deliberate choice for agent autonomy — the agent manages its own game credentials. The security surface is acceptable because SpaceMolt credentials only grant access to a game account, not infrastructure.
- **Deferred credential resolution**: The WebSocket source currently receives credentials at construction. The new `getCredentials` function defers resolution to connection time. This is a minor pattern change but keeps the source decoupled from the tool provider.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Config Schema Change
**Goal:** Replace `username`/`password` with `registration_code` in the SpaceMolt config schema.

**Components:**
- `src/config/schema.ts` — replace `username`/`password` fields with `registration_code`, add optional `empire` field, update superRefine validation
- `src/config/config.ts` — replace `SPACEMOLT_PASSWORD`/`SPACEMOLT_USERNAME` env overrides with `SPACEMOLT_REGISTRATION_CODE`

**Dependencies:** None (first phase)

**Done when:** Config with `registration_code` parses successfully. Missing `registration_code` when enabled is rejected. Env override works. Existing config tests updated. `bun run build` succeeds.

**Covers:** `spacemolt-auto-register.AC1.1`, `spacemolt-auto-register.AC1.2`, `spacemolt-auto-register.AC1.3`, `spacemolt-auto-register.AC1.4`
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Credential Memory Block
**Goal:** Create the credential storage and retrieval mechanism in core memory.

**Components:**
- `src/extensions/spacemolt/credentials.ts` — pure functions: `readCredentials(memory): Promise<Credentials | null>`, `writeCredentials(memory, credentials): Promise<void>`, `Credentials` type definition. Reads/writes `spacemolt:credentials` core memory block by label.

**Dependencies:** Phase 1 (config schema — for `Credentials` type alignment)

**Done when:** `readCredentials` returns null when block doesn't exist, returns parsed credentials when it does. `writeCredentials` creates a pinned core block. Writing twice is idempotent (updates existing block). Corrupted JSON returns null. Tests cover all cases.

**Covers:** `spacemolt-auto-register.AC2.1`, `spacemolt-auto-register.AC2.2`, `spacemolt-auto-register.AC2.3`, `spacemolt-auto-register.AC2.4`
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Tool Provider Auth Refactor
**Goal:** Replace hardcoded login in tool provider with register-or-login flow using credential memory.

**Components:**
- `src/extensions/spacemolt/tool-provider.ts` — change factory options from `username`/`password` to `registrationCode`/`usernameHint`/`empireHint`/`memory`. Refactor `discover()` to check memory → register or login. Add `register` call with username generation fallback. `reconnect()` uses `login` only.

**Dependencies:** Phase 2 (credential read/write functions)

**Done when:** First call to `discover()` with no credentials in memory calls `register` and persists credentials. Subsequent calls with existing credentials call `login`. Username-taken triggers retry with suffix. Registration code error surfaces clearly. `reconnect()` always uses `login`. Tests cover both paths, retries, and error cases.

**Covers:** `spacemolt-auto-register.AC3.1`, `spacemolt-auto-register.AC3.2`, `spacemolt-auto-register.AC3.3`, `spacemolt-auto-register.AC3.4`, `spacemolt-auto-register.AC3.5`, `spacemolt-auto-register.AC3.6`
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: WebSocket Source Auth Refactor
**Goal:** Replace direct credential injection with deferred credential reading.

**Components:**
- `src/extensions/spacemolt/source.ts` — change factory options from `username`/`password` to `getCredentials` function. Auth flow calls `getCredentials()` after `welcome`, throws if null.

**Dependencies:** Phase 2 (credential reader used to implement `getCredentials`)

**Done when:** Source connects and authenticates using credentials from `getCredentials()`. Null credentials throw clear error. Reconnection re-reads credentials from memory. Tests cover success and null-credential paths.

**Covers:** `spacemolt-auto-register.AC4.1`, `spacemolt-auto-register.AC4.2`, `spacemolt-auto-register.AC4.3`
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Composition Root Wiring
**Goal:** Wire the new auth flow into the startup sequence.

**Components:**
- `src/index.ts` — update SpaceMolt initialization: pass `registrationCode`, hints, and `memory` to tool provider; pass `getCredentials` (backed by `readCredentials`) to source; remove `username`/`password` config reads
- `src/extensions/spacemolt/index.ts` — export new credential functions

**Dependencies:** Phase 3 (tool provider refactor), Phase 4 (source refactor)

**Done when:** Agent starts with only `registration_code` in config. First run registers and persists credentials. Second run logs in from memory. WebSocket connects after tool provider auth succeeds. Existing wiring tests updated. `bun run build` succeeds.

**Covers:** `spacemolt-auto-register.AC5.1`, `spacemolt-auto-register.AC5.2`, `spacemolt-auto-register.AC5.3`
<!-- END_PHASE_5 -->

## Additional Considerations

**Credential visibility in system prompt:** The `spacemolt:credentials` block is core tier, so the 256-bit hex password appears in the system prompt every turn. This is acceptable because: (a) SpaceMolt credentials grant access to a game account, not infrastructure, (b) the agent needs to read its own credentials for reconnection, and (c) the `spacemolt:capabilities` seed block already instructs the agent never to share credentials. If this becomes a concern, a future change could move credentials to a working-tier block that's excluded from the prompt and accessed via `memory_read`.

**Username generation:** When no `username` config hint is provided, the tool provider generates a random spacey name (e.g., `Spirit-7X`, `Void-Runner-42`). The naming pattern should feel in-character for a space game. The exact generation logic is an implementation detail.

**Empire selection:** When no `empire` config hint is provided, a random empire is selected from the five options (solarian, voidborn, crimson, nebula, outerrim). No weighting — uniform random.

**Relationship to parent design:** This design modifies acceptance criteria from `docs/design-plans/2026-04-04-spacemolt-integration.md`. Specifically: AC1 (config schema), AC4.1 (WebSocket auth), AC5.1 (session creation), and the "Out of scope" line removing "agent self-registration" from exclusions. The parent design's other phases (game state, tool filter, tool cycling, memory seeding, event classification) are unaffected.
