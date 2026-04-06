# MCP Client Implementation Plan

**Goal:** Add MCP (Model Context Protocol) client support to Constellation, allowing it to connect to external MCP servers and surface their tools and prompts as first-class capabilities.

**Architecture:** Standalone `src/mcp/` module wrapping `@modelcontextprotocol/sdk`. Implements existing `ToolProvider` interface for tool discovery, adds skill adapter for MCP prompts, and wires into the composition root following the Bluesky DataSource lifecycle pattern.

**Tech Stack:** TypeScript 5.7+, Bun, Zod, `@modelcontextprotocol/sdk` v1.29+

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### mcp-client.AC6: Graceful degradation
- **mcp-client.AC6.1 Success:** Agent starts normally when all MCP servers connect
- **mcp-client.AC6.2 Success:** Agent starts normally when no MCP servers are configured
- **mcp-client.AC6.3 Failure:** Agent starts normally when one MCP server fails (others still registered)
- **mcp-client.AC6.4 Failure:** All MCP servers failing doesn't block agent startup

### mcp-client.AC7: Server instructions as context (composition wiring)
- **mcp-client.AC7.1 Success:** Server instructions from getInstructions() are appended to system prompt
- **mcp-client.AC7.2 Edge:** Server with no instructions contributes nothing to system prompt

---

## Phase 5: Composition Root Integration

**Goal:** Wire MCP into Constellation's startup and shutdown in `src/index.ts`, following the existing extension lifecycle patterns.

---

<!-- START_TASK_1 -->
### Task 1: Add MCP startup block to src/index.ts

**Files:**
- Modify: `src/index.ts` (add MCP initialization after skills section, before Bluesky)

**Implementation:**

Add imports at the top of `src/index.ts` (with other imports):
```typescript
import { createMcpClient, createMcpToolProvider, mcpPromptsToSkills, resolveServerConfigEnv } from '@/mcp';
import type { McpClient } from '@/mcp';
```

Add the MCP startup block after the skills section (after line ~649, before the Bluesky DataSource at line ~652). This follows the project pattern of: config check → factory create → connect → register.

The block structure:

```typescript
// --- MCP servers ---
const mcpClients: Array<McpClient> = [];

if (config.mcp?.enabled && Object.keys(config.mcp.servers).length > 0) {
  console.log(`[mcp] connecting to ${Object.keys(config.mcp.servers).length} server(s)...`);

  for (const [serverName, rawServerConfig] of Object.entries(config.mcp.servers)) {
    try {
      // Resolve env vars in config values
      const serverConfig = resolveServerConfigEnv(rawServerConfig, process.env);

      // Create and connect client
      const client = createMcpClient(serverName, serverConfig);
      await client.connect();
      mcpClients.push(client);

      // Discover and register tools
      const provider = createMcpToolProvider(client);
      const toolDefs = await provider.discover();
      for (const def of toolDefs) {
        registry.register({
          definition: def,
          handler: async (params) => provider.execute(def.name, params),
        });
      }
      console.log(`[mcp:${serverName}] registered ${toolDefs.length} tool(s)`);

      // Convert prompts to skills and inject
      if (skillRegistry) {
        const skills = await mcpPromptsToSkills(client);
        if (skills.length > 0) {
          await skillRegistry.injectSkills(skills);
          console.log(`[mcp:${serverName}] injected ${skills.length} skill(s)`);
        }
      }

      // Collect server instructions for context provider
      const instructions = await client.getInstructions();
      if (instructions) {
        contextProviders.push(() => `[MCP: ${serverName}]\n${instructions}`);
      }

    } catch (error) {
      // AC6.3, AC6.4: Failed connection doesn't block startup
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[mcp:${serverName}] failed to connect: ${errorMsg}`);
      console.error(`[mcp] continuing without ${serverName}`);
    }
  }

  if (mcpClients.length > 0) {
    console.log(`[mcp] ${mcpClients.length} server(s) connected`);
  } else {
    console.log('[mcp] no servers connected (all failed or none configured)');
  }
}
```

Key patterns followed:
- **Graceful degradation**: Each server is wrapped in its own try/catch (AC6.3). If all fail, startup continues (AC6.4).
- **Context providers**: Server instructions pushed to the existing `contextProviders` array (AC7.1). If no instructions, nothing is pushed (AC7.2).
- **Tool registration**: Uses the same `registry.register()` pattern as all other tools (lines 523-603).
- **Skill injection**: Uses the new `injectSkills()` method from Phase 4. Only if skills are enabled.
- **Logging**: Uses `console.log("[mcp] ...")` and `console.error("[mcp:serverName] ...")` matching the Bluesky pattern.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/index.ts
git commit -m "feat(mcp): wire MCP client startup into composition root with graceful degradation"
```
<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
### Task 2: Add MCP shutdown to shutdown handler

**Files:**
- Modify: `src/index.ts` (update `createShutdownHandler` and its call site)

**Implementation:**

**2a: Update createShutdownHandler signature** (line ~224)

Add a new optional parameter to `createShutdownHandler`:

```typescript
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  dataSourceRegistry?: DataSourceRegistry | null,
  scheduler?: { stop(): void } | null,
  activityManager?: ActivityManager | null,
  mcpClients?: ReadonlyArray<McpClient>,  // NEW
): () => Promise<void> {
```

**2b: Add MCP disconnect to shutdown body** (after data sources disconnect, before activity manager)

```typescript
// Disconnect MCP servers
if (mcpClients && mcpClients.length > 0) {
  await Promise.allSettled(
    mcpClients.map(async (client) => {
      try {
        await client.disconnect();
      } catch (error) {
        console.error(`[mcp:${client.serverName}] error disconnecting:`, error);
      }
    }),
  );
  console.log(`[mcp] ${mcpClients.length} server(s) disconnected`);
}
```

**2c: Pass mcpClients to shutdown handler** (line ~1080)

Update the `createShutdownHandler` call to pass the `mcpClients` array:

```typescript
const shutdownHandler = createShutdownHandler(
  rl,
  persistence,
  dataSourceRegistry,
  schedulerWrapper,
  activityManager,
  mcpClients,  // NEW
);
```

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

Run:
```bash
bun test
```

Expected: All existing tests pass.

**Commit:**

```bash
git add src/index.ts
git commit -m "feat(mcp): add MCP server disconnect to shutdown handler"
```
<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
### Task 3: Update MCP barrel export for composition root convenience

**Files:**
- Modify: `src/mcp/index.ts` (ensure all public API is exported)

**Implementation:**

Verify that `src/mcp/index.ts` re-exports everything the composition root needs:

Types (type re-exports):
- All types from `./types.ts` (`McpStdioServerConfig`, `McpHttpServerConfig`, `McpServerConfig`, `McpConfig`, `McpToolInfo`, `McpPromptInfo`, `McpPromptResult`, `McpClient`)

Values (runtime re-exports):
- `McpConfigSchema`, `McpServerConfigSchema` from `./schema.ts`
- `createMcpClient` from `./client.ts`
- `createMcpToolProvider` from `./provider.ts`
- `mcpPromptToSkill`, `mcpPromptsToSkills` from `./skill-adapter.ts`
- `resolveEnvVars`, `resolveServerConfigEnv` from `./env.ts`
- `mapInputSchemaToParameters` from `./schema-mapper.ts`

If any exports are missing, add them.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes. All imports from `@/mcp` in `src/index.ts` resolve.

**Commit:**

```bash
git add src/mcp/index.ts
git commit -m "chore(mcp): ensure barrel export covers full public API"
```
<!-- END_TASK_3 -->

---

<!-- START_TASK_4 -->
### Task 4: Integration verification — startup with no MCP config

**Verifies:** mcp-client.AC6.2

**Files:** None (verification only)

**Step 1: Verify existing config has no [mcp] section**

Check that the existing `config.toml` (or `config.toml.example`) has no `[mcp]` section. The `McpConfigSchema.default({})` means the field defaults to `{ enabled: false, servers: {} }`, so the agent should start normally without any MCP configuration.

**Step 2: Run type-check**

Run:
```bash
bun run build
```

Expected: Passes cleanly.

**Step 3: Run all tests**

Run:
```bash
bun test
```

Expected: All tests pass. No regressions from the MCP integration.

No commit needed (verification only).
<!-- END_TASK_4 -->

---

<!-- START_TASK_5 -->
### Task 5: Add config.toml example for MCP servers

**Files:**
- Modify: `config.toml.example` (if exists) or document in a comment

**Implementation:**

If `config.toml.example` exists, add an `[mcp]` section at the end:

```toml
# --- MCP Server Integration ---
# Connect to external MCP servers for additional tools and prompts.
# [mcp]
# enabled = true
#
# [mcp.servers.filesystem]
# transport = "stdio"
# command = "npx"
# args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
#
# [mcp.servers.github]
# transport = "stdio"
# command = "npx"
# args = ["-y", "@modelcontextprotocol/server-github"]
# env = { GITHUB_TOKEN = "${GITHUB_TOKEN}" }
#
# [mcp.servers.remote-tools]
# transport = "http"
# url = "http://localhost:3001/mcp"
```

If `config.toml.example` doesn't exist, skip this task and add a comment in `src/mcp/schema.ts` documenting the expected config format.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes (TOML example is just documentation).

**Commit:**

```bash
git add config.toml.example  # or src/mcp/schema.ts
git commit -m "docs(mcp): add MCP server configuration example"
```
<!-- END_TASK_5 -->

---

<!-- START_SUBCOMPONENT_A (tasks 6-7) -->
<!-- START_TASK_6 -->
### Task 6: Create MCP composition root helper functions

**Files:**
- Create: `src/mcp/startup.ts`
- Modify: `src/mcp/index.ts` (add re-export)

**Implementation:**

Mark as `// pattern: Functional Core` (pure functions for building context providers and formatting).

Extract the following testable pure functions from the composition root wiring logic:

```typescript
function createMcpInstructionsProvider(
  serverName: string,
  instructions: string,
): () => string | undefined
```

Returns a context provider function that formats instructions as `[MCP: ${serverName}]\n${instructions}`.

```typescript
function formatMcpStartupSummary(
  connected: ReadonlyArray<string>,
  failed: ReadonlyArray<{ name: string; error: string }>,
): string
```

Returns a summary string for logging (e.g., "2 server(s) connected, 1 failed: bad-server").

Export both functions. Add re-exports to `src/mcp/index.ts`.

These helpers make the composition root's MCP logic testable without starting the full agent.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/startup.ts src/mcp/index.ts
git commit -m "feat(mcp): extract testable helper functions for composition root wiring"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Tests for MCP composition root helpers and graceful degradation

**Verifies:** mcp-client.AC6.1, mcp-client.AC6.3, mcp-client.AC6.4, mcp-client.AC7.1, mcp-client.AC7.2

**Files:**
- Create: `src/mcp/startup.test.ts`

**Testing:**

**Context provider tests (AC7.1, AC7.2):**

- mcp-client.AC7.1 (instructions provider): Create a provider via `createMcpInstructionsProvider('github', 'Use the tools to...')`. Call the returned function. Verify it returns a string containing `[MCP: github]` and the instructions text.
- mcp-client.AC7.2 (no instructions): Verify that when `getInstructions()` returns `undefined` on a mock client, no context provider is created (test the composition logic: the provider is only pushed if instructions are non-null).

**Graceful degradation tests (AC6.1, AC6.3, AC6.4):**

Create a mock `McpClient` factory for these tests:
```typescript
function createMockMcpClient(options?: {
  shouldFailConnect?: boolean;
  tools?: Array<McpToolInfo>;
  instructions?: string;
}): McpClient
```

The mock throws from `connect()` if `shouldFailConnect` is true, otherwise succeeds.

- mcp-client.AC6.1 (all servers connect): Create 2 mock clients that succeed. Simulate the composition root loop (iterate, connect, register). Verify both clients' tools are collected and no errors thrown.
- mcp-client.AC6.3 (one fails, others ok): Create 3 mock clients where the second throws on `connect()`. Simulate the composition root loop with try/catch per server. Verify clients 1 and 3 are in the connected array, client 2 is not. Verify no exception propagates.
- mcp-client.AC6.4 (all fail): Create 2 mock clients that both throw on `connect()`. Simulate the loop. Verify the connected array is empty. Verify no exception propagates (startup continues).

**Startup summary tests:**

- Test `formatMcpStartupSummary(['github', 'fs'], [])` produces appropriate summary.
- Test `formatMcpStartupSummary([], [{ name: 'bad', error: 'timeout' }])` mentions the failure.

**Verification:**

Run:
```bash
bun test src/mcp/startup.test.ts
```

Expected: All tests pass.

Run:
```bash
bun test
```

Expected: All tests pass (no regressions).

**Commit:**

```bash
git add src/mcp/startup.test.ts
git commit -m "test(mcp): add composition root helper and graceful degradation tests covering AC6.1, AC6.3, AC6.4, AC7.1, AC7.2"
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_A -->
